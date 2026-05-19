import { createSpeechRecognition, transcriptMatchesTarget } from './asr';
import {
  initCollectorPanel,
  promptTeacherJudgment,
  setJudgmentCompleteHandler,
  showDspVerdict,
  syncStudentIdField,
} from './collector-ui';
import { GROUP_KEYS, GROUPS, W2C } from './data';
import { ensureDspEngine, runDspPrediction, type DspPrediction } from './dsp-predict';
import { extractFrames, resetMelFilterbank } from './dsp';
import { generateNonsenseWord, pickCurriculumWord } from './phonemes/generator';
import { analyzeReferenceCatalog } from './reference-offline';
import { buildRecordingBlob, createMediaRecorder } from './recorder';
import { applySettingsToDocument, loadSettings, saveSettings, type AppSettings } from './settings';
import {
  flagsFromFeedback,
  getSessionMeta,
  logAttempt,
  setStudentId,
} from './session-log';
import { deriveAppPass } from './scoring';
import { acousticStudentMessage, toStudentFeedback } from './student-feedback';
import { trainOnCalibrationSample } from './tf-phoneme';
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
  showTfWordBars,
  showResultBanner,
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
let lastDsp: DspPrediction | null = null;
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

function displayFeedback(items: ReturnType<typeof runDspPrediction>['heuristicItems']): void {
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

    lastDsp = runDspPrediction(frames, curWord, curGroup);
    displayFeedback(lastDsp.heuristicItems);

    if (settings.showMlDebug && lastDsp.tf) {
      showTfWordBars(lastDsp.tf.top3, lastDsp.tf.confidence);
    }

    if (settings.collectorMode) {
      showDspVerdict(lastDsp.summary, lastDsp.guessedWord, curWord);
    }
  } catch {
    displayFeedback([{ t: 'warn', s: 'Could not decode audio' }]);
    pendingHeard = null;
    lastDsp = null;
    return;
  }

  if (pendingHeard !== null && pendingAsrPass !== null) {
    finishAttempt(pendingHeard, pendingAsrPass);
    pendingHeard = null;
    pendingAsrPass = null;
  }
}

function finishAttempt(heard: string, asrPass: boolean): void {
  const dsp =
    lastDsp ??
    ({
      embedding: null,
      heuristicItems: [],
      heuristicPass: null,
      tf: null,
      guessedWord: null,
      guessConfidence: 0,
      targetProbability: 0,
      summary: 'DSP not run',
      dspPass: false,
    } satisfies DspPrediction);

  const { appPass, basis } = deriveAppPass(asrPass, dsp, curWord);

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
          `app ${appPass ? 'pass' : 'fail'} (${basis}) · DSP “${dsp.guessedWord ?? '—'}” · ` +
          `ASR “${heard}”`,
      };
  addFB(studentMsg, true);

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
      heuristicFlags: flagsFromFeedback(dsp.heuristicItems),
      nucleusMfcc: dsp.embedding,
      vowelClassIndex: W2C[curWord] ?? null,
      dspGuessWord: dsp.guessedWord,
      dspGuessConfidence: dsp.guessConfidence,
      dspTargetProbability: dsp.targetProbability,
      dspPass: dsp.dspPass,
      dspSummary: dsp.summary,
      teacherAgrees: null,
      asrTranscriptWrong: null,
      dspGuessWrong: null,
    });
    promptTeacherJudgment(attempt);
  }

  stopRec();
}

async function onTeacherJudgment(agrees: boolean, asrWrong: boolean, dspWrong: boolean): Promise<void> {
  if (!lastDsp?.embedding) return;
  if (agrees && !asrWrong && !dspWrong) {
    await trainOnCalibrationSample(lastDsp.embedding, curWord);
  }
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
    setJudgmentCompleteHandler((j) => {
      void onTeacherJudgment(j.agrees, j.asrWrong, j.dspWrong);
    });
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

  void ensureDspEngine().then(() => {
    $('netTxt').textContent = 'TensorFlow.js WASM · word classifier ready';
    show('netBadge');
  });

  nextWord();

  if (REFERENCE_AUDIO_PATHS.length > 0) {
    void analyzeReferenceCatalog(REFERENCE_AUDIO_PATHS);
  }
}

init();
