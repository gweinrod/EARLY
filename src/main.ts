import { createSpeechRecognition, transcriptMatchesTarget } from './asr';
import { initCollectorPanel, promptTeacherJudgment, syncStudentIdField } from './collector-ui';
import { GROUP_KEYS, GROUPS, W2C } from './data';
import { extractFrames, extractNucleusMfcc, resetMelFilterbank } from './dsp';
import { heuristicFeedback, type FeedbackItem } from './feedback';
import { generateNonsenseWord, pickCurriculumWord } from './phonemes/generator';
import { analyzeReferenceCatalog } from './reference-offline';
import { buildRecordingBlob, createMediaRecorder } from './recorder';
import { oneHot, trainingBuffer, vowelNet } from './net';
import { applySettingsToDocument, loadSettings, saveSettings, type AppSettings } from './settings';
import {
  flagsFromFeedback,
  getSessionMeta,
  logAttempt,
  setStudentId,
} from './session-log';
import { deriveAppPass } from './scoring';
import { acousticStudentMessage, toStudentFeedback } from './student-feedback';
import {
  $,
  addFB,
  addHistory,
  clearFB,
  drawHeatmap,
  drawWave,
  hide,
  show,
  showErr,
  showProbBars,
  showResultBanner,
  updateNetBadge,
  updateScores,
} from './ui';

const REFERENCE_AUDIO_PATHS: string[] = [];

let settings: AppSettings = loadSettings();
let audioCtx: AudioContext | null = null;
let recChunks: Blob[] = [];
let mediaRec: MediaRecorder | null = null;
let recStream: MediaStream | null = null;
let listening = false;
let stopWave: (() => void) | null = null;
let lastNuc: number[] | null = null;
let lastHeuristicItems: FeedbackItem[] = [];
let pendingHeard: string | null = null;
let pendingAsrPass: boolean | null = null;

let correct = 0;
let total = 0;
const history: { w: string; h: string; pass: boolean }[] = [];

let curGroup = GROUP_KEYS[0];
let curWord = '';

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audioCtx = new Ctx();
  }
  return audioCtx;
}

function setTargetWord(display: string, phonLabel: string): void {
  curWord = display;
  $('tWord').textContent = display;
  $('tPhon').textContent = phonLabel;
  clearFB();
  hide('hmWrap');
  hide('pbWrap');
  hide('resultBanner');
}

function nextWord(): void {
  if (settings.useNonsenseWords) {
    const gen = generateNonsenseWord(curGroup);
    setTargetWord(gen.display, `focus: ${gen.phonemeFocus}`);
  } else {
    const pick = pickCurriculumWord(curGroup);
    setTargetWord(pick.display, pick.phonemeFocus);
  }
}

/** Run vowel net silently for training data; optional debug UI. */
function runVowelNet(frames: ReturnType<typeof extractFrames>): number | null {
  const gtype = GROUPS[curGroup]?.type;
  if (gtype !== 'vowel') return null;

  lastNuc = extractNucleusMfcc(frames);
  if (!lastNuc) return null;

  const t0 = performance.now();
  const probs = vowelNet.predict(lastNuc);
  const ms = (performance.now() - t0).toFixed(2);

  if (settings.showMlDebug) {
    showProbBars(probs, ms);
    let top = 0;
    for (let i = 1; i < probs.length; i++) if (probs[i] > probs[top]) top = i;
    const exp = W2C[curWord];
    const conf = Math.round(probs[top] * 100);
    const n = trainingBuffer.X.length;
    if (n < 8) {
      addFB({
        t: 'info',
        s: `Neural net: model cold — need ~10 correct vowel attempts (have ${n})`,
      });
    } else if (top === exp) {
      addFB({ t: 'pass', s: `Neural net: class ${top} ✓ (${conf}% · ${ms}ms)` });
    } else {
      addFB({ t: 'fail', s: `Neural net: predicted ${top}, expected ${exp ?? '?'}` });
    }
  }

  return W2C[curWord] ?? null;
}

function trainVowelNetSilently(): void {
  if (!lastNuc) return;
  const ci = W2C[curWord];
  if (ci === undefined) return;
  trainingBuffer.X.push(lastNuc.slice());
  trainingBuffer.Y.push(oneHot(ci, 6));
  const loss = vowelNet.train(trainingBuffer.X, trainingBuffer.Y);
  if (settings.showMlDebug) {
    updateNetBadge(trainingBuffer.X.length, loss);
  }
}

function displayFeedback(items: FeedbackItem[]): void {
  const shown = settings.collectorMode && !settings.showMlDebug ? toStudentFeedback(items) : items;
  for (const fb of shown) addFB(fb);
}

async function processAudio(): Promise<void> {
  if (!recChunks.length || !audioCtx) return;
  const blob = buildRecordingBlob(recChunks);
  const ab = await blob.arrayBuffer();

  try {
    const aB = await audioCtx.decodeAudioData(ab.slice(0));
    const audio = Array.from(aB.getChannelData(0));
    const frames = extractFrames(audio, aB.sampleRate);

    if (frames.length < 4) {
      displayFeedback([{ t: 'warn', s: 'Recording too short — try again' }]);
      pendingHeard = null;
      return;
    }

    if (settings.showMlDebug) drawHeatmap(frames);

    lastNuc = null;
    lastHeuristicItems = heuristicFeedback(frames, curWord, curGroup);
    runVowelNet(frames);
    displayFeedback(lastHeuristicItems);
  } catch {
    displayFeedback([{ t: 'warn', s: 'Could not decode audio' }]);
    pendingHeard = null;
    return;
  }

  if (pendingHeard !== null && pendingAsrPass !== null) {
    finishAttempt(pendingHeard, pendingAsrPass);
    pendingHeard = null;
    pendingAsrPass = null;
  }
}

function finishAttempt(heard: string, asrPass: boolean): void {
  const { appPass, basis } = deriveAppPass(asrPass, lastHeuristicItems);

  total++;
  if (appPass) correct++;
  updateScores(correct, total);
  addHistory(curWord, heard, appPass, history);
  showResultBanner(appPass);

  const studentMsg = settings.collectorMode && !settings.showMlDebug
    ? acousticStudentMessage(appPass)
    : {
        t: appPass ? ('pass' as const) : ('fail' as const),
        s:
          `app ${appPass ? 'pass' : 'fail'} (${basis}) · speech-to-text: “${heard}” — ` +
          `${asrPass ? 'matches target' : `expected “${curWord}”`}`,
      };
  addFB(studentMsg, true);

  if (appPass) trainVowelNetSilently();

  if (settings.collectorMode) {
    const sidInput = $('studentId') as HTMLInputElement;
    if (sidInput.value.trim()) setStudentId(sidInput.value);
    const meta = getSessionMeta();
    const attempt = logAttempt({
      studentId: meta.studentId,
      group: curGroup,
      word: curWord,
      heard,
      asrPass,
      appPass,
      scoringBasis: basis,
      heuristicFlags: flagsFromFeedback(lastHeuristicItems),
      asrTranscriptWrong: null,
      nucleusMfcc: lastNuc,
      vowelClassIndex: W2C[curWord] ?? null,
      teacherAgrees: null,
    });
    promptTeacherJudgment(attempt);
  }

  stopRec();
}

async function toggleRec(): Promise<void> {
  if (listening) {
    stopRec();
    return;
  }

  const ctx = getAudioContext();
  if (ctx.state === 'suspended') await ctx.resume();

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    recStream = stream;
    const src = ctx.createMediaStreamSource(stream);
    const an = ctx.createAnalyser();
    an.fftSize = 2048;
    src.connect(an);

    recChunks = [];
    mediaRec = createMediaRecorder(stream);
    mediaRec.ondataavailable = (e) => {
      if (e.data.size > 0) recChunks.push(e.data);
    };
    mediaRec.onstop = () => {
      void processAudio();
    };
    mediaRec.start(100);

    // iOS: fresh SpeechRecognition per tap, started only inside user gesture
    const recognition = createSpeechRecognition();
    if (recognition) {
      recognition.onresult = (e: SpeechRecognitionEvent) => {
        const heard = e.results[0][0].transcript.trim().toLowerCase();
        pendingHeard = heard;
        pendingAsrPass = transcriptMatchesTarget(heard, curWord);
        stopRec();
      };
      recognition.onerror = () => {
        pendingHeard = '';
        pendingAsrPass = false;
        stopRec();
      };
      recognition.onend = () => {
        if (listening) stopRec();
      };
      try {
        recognition.start();
      } catch {
        /* already started */
      }
    }

    listening = true;
    $('btnRec').classList.add('on');
    $('btnLbl').textContent = 'listening...';
    clearFB();
    hide('hmWrap');
    hide('pbWrap');
    hide('resultBanner');
    stopWave = drawWave(an, () => listening);
  } catch (e) {
    showErr(`Mic denied — ${e instanceof Error ? e.message : String(e)}`);
  }
}

function stopRec(): void {
  if (!listening) return;
  listening = false;
  if (mediaRec && mediaRec.state !== 'inactive') mediaRec.stop();
  if (recStream) recStream.getTracks().forEach((t) => t.stop());
  stopWave?.();
  stopWave = null;
  $('btnRec').classList.remove('on');
  $('btnLbl').textContent = 'tap to speak';
}

function initPills(): void {
  const container = $('pillGroup');
  GROUP_KEYS.forEach((g, idx) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pill' + (idx === 0 ? ' on' : '');
    btn.textContent = g;
    btn.addEventListener('click', () => {
      document.querySelectorAll('.pill').forEach((p) => p.classList.remove('on'));
      btn.classList.add('on');
      curGroup = g;
      resetMelFilterbank();
      nextWord();
    });
    container.appendChild(btn);
  });
}

function applySettingsUi(): void {
  applySettingsToDocument(settings);
  const nonsenseToggle = $('nonsenseMode') as HTMLInputElement;
  nonsenseToggle.checked = settings.useNonsenseWords;
  const debugToggle = $('debugMode') as HTMLInputElement;
  debugToggle.checked = settings.showMlDebug;

  if (settings.showMlDebug) show('netBadge');
  else hide('netBadge');

  const collectorPanel = $('collectorPanel');
  if (settings.collectorMode) show('collectorPanel');
  else hide('collectorPanel');
}

function init(): void {
  settings = loadSettings();
  applySettingsUi();
  initPills();
  if (settings.collectorMode) {
    initCollectorPanel();
    const meta = getSessionMeta();
    syncStudentIdField(meta.studentId);
  }

  $('btnRec').addEventListener('click', () => {
    void toggleRec();
  });
  $('btnNext').addEventListener('click', nextWord);

  $('nonsenseMode').addEventListener('change', (e) => {
    settings.useNonsenseWords = (e.target as HTMLInputElement).checked;
    saveSettings(settings);
    nextWord();
  });

  $('debugMode').addEventListener('change', (e) => {
    settings.showMlDebug = (e.target as HTMLInputElement).checked;
    saveSettings(settings);
    applySettingsUi();
  });

  if (!navigator.mediaDevices?.getUserMedia) {
    showErr('Microphone needs HTTPS or localhost — use Safari on iPad after deploying to Vercel.');
  }

  if (settings.showMlDebug) updateNetBadge(0);
  nextWord();

  if (REFERENCE_AUDIO_PATHS.length > 0) {
    void analyzeReferenceCatalog(REFERENCE_AUDIO_PATHS);
  }
}

init();
