import { createSpeechRecognition } from './asr';
import {
  initCollectorPanel,
  promptTeacherJudgment,
  setJudgmentCompleteHandler,
  showDspVerdict,
  syncStudentIdField,
} from './collector-ui';
import {
  type CurriculumItem,
  type CurriculumStageId,
  getStage,
  pickRandomItem,
  STAGE_ORDER,
  transcriptMatchesItem,
} from './curriculum';
import { ensureDspEngine, runDspPrediction, type DspPrediction } from './dsp-predict';
import { extractFrames, resetMelFilterbank } from './dsp';
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
import { trainCalibrationSample } from './tf-phoneme';
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

let curStageId: CurriculumStageId = settings.curriculumStage;
let curItem: CurriculumItem = getStage(curStageId).items[0];

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audioCtx = new Ctx();
  }
  return audioCtx;
}

function setTargetItem(item: CurriculumItem): void {
  curItem = item;
  const stage = getStage(curStageId);
  $('tWord').textContent = item.display;
  $('tPhon').textContent = `say: ${item.spokenName} · ${item.phonemeNote}`;
  $('stageSubtitle').textContent = stage.subtitle;
  clearFB();
  hide('hmWrap');
  hide('pbWrap');
  hide('resultBanner');
}

function nextItem(): void {
  setTargetItem(pickRandomItem(curStageId, curItem.key));
}

function displayFeedback(items: DspPrediction['heuristicItems']): void {
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

    lastDsp = runDspPrediction(frames, curItem.key, curStageId);
    displayFeedback(lastDsp.heuristicItems);

    if (settings.showMlDebug && lastDsp.tf) {
      showTfWordBars(lastDsp.tf.top3, lastDsp.tf.confidence);
    }

    if (settings.collectorMode) {
      showDspVerdict(
        lastDsp.summary,
        lastDsp.tf?.guessedKey ?? null,
        curItem.display,
        curItem.key,
        lastDsp.guessConfidence,
        lastDsp.targetProbability,
      );
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

  const { appPass, basis } = deriveAppPass(
    asrPass,
    { ...dsp, guessedKey: dsp.tf?.guessedKey },
    curItem.key,
    curStageId,
  );

  total++;
  if (appPass) correct++;
  updateScores(correct, total);
  addHistory(curItem.display, heard, appPass, history);
  showResultBanner(appPass);

  const studentMsg = settings.collectorMode && !settings.showMlDebug
    ? acousticStudentMessage(appPass)
    : {
        t: appPass ? ('pass' as const) : ('fail' as const),
        s:
          `app ${appPass ? 'pass' : 'fail'} (${basis}) · DSP “${dsp.tf?.guessedKey ?? '—'}” · ` +
          `ASR “${heard}”`,
      };
  addFB(studentMsg, true);

  if (settings.collectorMode) {
    const sidInput = $('studentId') as HTMLInputElement;
    if (sidInput.value.trim()) setStudentId(sidInput.value);
    const meta = getSessionMeta();
    const attempt = logAttempt({
      studentId: meta.studentId,
      group: getStage(curStageId).label,
      word: curItem.display,
      targetKey: curItem.key,
      heard,
      asrPass,
      appPass,
      scoringBasis: basis,
      heuristicFlags: flagsFromFeedback(dsp.heuristicItems),
      nucleusMfcc: dsp.embedding,
      vowelClassIndex: null,
      dspGuessWord: dsp.tf?.guessedKey ?? null,
      dspGuessConfidence: dsp.guessConfidence,
      dspTargetProbability: dsp.targetProbability,
      dspPass: dsp.dspPass,
      dspSummary: dsp.summary,
      teacherAgrees: null,
      asrTranscriptWrong: null,
      dspGuessWrong: null,
      teacherHeard: null,
      teacherHeardKey: null,
      curriculumStage: curStageId,
    });
    promptTeacherJudgment(attempt, curStageId);
  }

  stopRec();
}

async function onTeacherJudgment(j: {
  agrees: boolean;
  asrWrong: boolean;
  dspWrong: boolean;
  teacherHeard: string;
  teacherHeardKey: string | null;
}): Promise<void> {
  if (!lastDsp?.embedding) return;
  await trainCalibrationSample({
    embedding: lastDsp.embedding,
    targetKey: curItem.key,
    teacherHeardKey: j.teacherHeardKey,
    agrees: j.agrees,
    asrWrong: j.asrWrong,
    dspWrong: j.dspWrong,
  });
}

async function switchStage(stageId: CurriculumStageId): Promise<void> {
  curStageId = stageId;
  settings.curriculumStage = stageId;
  saveSettings(settings);
  resetMelFilterbank();
  $('netTxt').textContent = 'Loading TensorFlow model…';
  await ensureDspEngine(stageId);
  $('netTxt').textContent = `TensorFlow.js WASM · ${getStage(stageId).label}`;
  nextItem();
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
        pendingAsrPass = transcriptMatchesItem(curStageId, heard, curItem);
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

function initStagePills(): void {
  const container = $('pillGroup');
  container.innerHTML = '';
  for (const stageId of STAGE_ORDER) {
    if (stageId === 'legacy-cvc') continue;
    const stage = getStage(stageId);
    if (!stage.items.length) continue;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pill' + (stageId === curStageId ? ' on' : '');
    btn.textContent = stage.label.replace('Stage ', 'S');
    btn.title = stage.subtitle;
    btn.addEventListener('click', () => {
      document.querySelectorAll('.pill').forEach((p) => p.classList.remove('on'));
      btn.classList.add('on');
      void switchStage(stageId);
    });
    container.appendChild(btn);
  }
}

function applySettingsUi(): void {
  applySettingsToDocument(settings);
  const debugToggle = $('debugMode') as HTMLInputElement;
  debugToggle.checked = settings.showMlDebug;
  const legacyToggles = $('legacyToggles');
  if (curStageId === 'legacy-cvc') show('legacyToggles');
  else hide('legacyToggles');

  if (settings.collectorMode) show('collectorPanel');
  else hide('collectorPanel');
  show('netBadge');
}

function init(): void {
  settings = loadSettings();
  curStageId = settings.curriculumStage;
  applySettingsUi();
  initStagePills();
  if (settings.collectorMode) {
    initCollectorPanel();
    setJudgmentCompleteHandler((j) => {
      void onTeacherJudgment(j);
    });
    const meta = getSessionMeta();
    syncStudentIdField(meta.studentId);
  }

  $('btnRec').addEventListener('click', () => {
    void toggleRec();
  });
  $('btnNext').addEventListener('click', nextItem);

  $('debugMode').addEventListener('change', (e) => {
    settings.showMlDebug = (e.target as HTMLInputElement).checked;
    saveSettings(settings);
    applySettingsUi();
  });

  if (!navigator.mediaDevices?.getUserMedia) {
    showErr('Microphone needs HTTPS or localhost — use Safari on iPad after deploying to Vercel.');
  }

  void ensureDspEngine(curStageId).then(() => {
    $('netTxt').textContent = `TensorFlow.js WASM · ${getStage(curStageId).label}`;
    setTargetItem(pickRandomItem(curStageId));
  });
}

init();
