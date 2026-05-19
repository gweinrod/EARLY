import { createSpeechRecognition, transcriptFromEvent } from './asr';
import { APP_VERSION } from './version';
import {
  autoConfirmAsrPass,
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
import { isVoiceBankComplete } from './voice-bank';
import {
  initVoiceBootstrapUi,
  isVoiceBootstrapActive,
  startVoiceBootstrap,
} from './voice-bootstrap-ui';
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
let activeRecognition: SpeechRecognition | null = null;
let asrWaitTimer: ReturnType<typeof setTimeout> | null = null;
let attemptFinalized = false;
let dspProcessed = false;
let asrEnded = false;
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
      pendingAsrPass = null;
      attemptFinalized = true;
      dspProcessed = false;
      clearAsrWait();
      releaseMic();
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
    pendingAsrPass = null;
    lastDsp = null;
    attemptFinalized = true;
    dspProcessed = false;
    clearAsrWait();
    releaseMic();
    return;
  }

  dspProcessed = true;
  scheduleAttemptFinalize();
}

function clearAsrWait(): void {
  if (asrWaitTimer) {
    clearTimeout(asrWaitTimer);
    asrWaitTimer = null;
  }
}

function releaseMic(): void {
  if (recStream) {
    recStream.getTracks().forEach((t) => t.stop());
    recStream = null;
  }
  activeRecognition = null;
}

function scheduleAttemptFinalize(): void {
  if (attemptFinalized) return;

  if (pendingHeard !== null && pendingAsrPass !== null) {
    finalizeAttempt();
    return;
  }

  if (!dspProcessed) return;

  if (activeRecognition && !asrEnded) return;

  clearAsrWait();
  const graceMs = pendingHeard !== null ? 80 : 3500;
  asrWaitTimer = setTimeout(() => {
    asrWaitTimer = null;
    finalizeAttempt();
  }, graceMs);
}

function finalizeAttempt(): void {
  if (attemptFinalized) return;
  attemptFinalized = true;
  dspProcessed = false;
  asrEnded = false;
  clearAsrWait();
  releaseMic();

  const heard = pendingHeard ?? '';
  const asrPass = pendingAsrPass ?? false;
  pendingHeard = null;
  pendingAsrPass = null;

  finishAttempt(heard, asrPass);
}

function applyAsrTranscript(heard: string): void {
  pendingHeard = heard;
  pendingAsrPass = transcriptMatchesItem(curStageId, heard, curItem);
  if (!listening) scheduleAttemptFinalize();
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
    if (asrPass && heard.trim()) {
      const judgment = autoConfirmAsrPass(attempt, curStageId, heard);
      addFB(
        {
          t: 'pass',
          s: `ASR heard “${heard}” — student correct; saved for training.`,
        },
        true,
      );
      void onTeacherJudgment(judgment);
    } else {
      promptTeacherJudgment(attempt, curStageId);
    }
  }
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
  if (!isVoiceBankComplete(stageId)) {
    await startVoiceBootstrap(stageId);
    return;
  }
  $('netTxt').textContent = `TensorFlow.js WASM · ${getStage(stageId).label}`;
  nextItem();
}

function onVoiceBootstrapComplete(): void {
  $('netTxt').textContent = `TensorFlow.js WASM · ${getStage(curStageId).label}`;
  setTargetItem(pickRandomItem(curStageId));
}

async function toggleRec(): Promise<void> {
  if (listening) {
    stopRec();
    return;
  }

  attemptFinalized = false;
  dspProcessed = false;
  asrEnded = false;
  clearAsrWait();
  pendingHeard = null;
  pendingAsrPass = null;

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

    activeRecognition = createSpeechRecognition();
    if (activeRecognition) {
      const recognition = activeRecognition;
      recognition.onresult = (e: SpeechRecognitionEvent) => {
        const { text: heard, isFinal } = transcriptFromEvent(e);
        if (!heard) return;
        applyAsrTranscript(heard);
        const matched = transcriptMatchesItem(curStageId, heard, curItem);
        if (listening && (isFinal || matched)) stopRec();
      };
      recognition.onerror = (e: SpeechRecognitionErrorEvent) => {
        asrEnded = true;
        if (e.error !== 'aborted' && pendingHeard === null) {
          pendingHeard = '';
          pendingAsrPass = false;
        }
        if (listening) stopRec();
        else scheduleAttemptFinalize();
      };
      recognition.onend = () => {
        asrEnded = true;
        if (listening) stopRec();
        else scheduleAttemptFinalize();
      };
      try {
        recognition.start();
      } catch {
        activeRecognition = null;
        asrEnded = true;
      }
    } else {
      asrEnded = true;
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
  stopWave?.();
  stopWave = null;
  $('btnRec').classList.remove('on');
  $('btnLbl').textContent = 'tap to speak';

  if (activeRecognition) {
    try {
      activeRecognition.stop();
    } catch {
      asrEnded = true;
    }
  }

  if (mediaRec && mediaRec.state !== 'inactive') mediaRec.stop();
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
  $('appTitle').textContent = 'EARLY';
  $('appVersion').textContent = `v${APP_VERSION}`;

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

  initVoiceBootstrapUi({
    getAudioContext,
    onComplete: onVoiceBootstrapComplete,
  });

  $('btnRec').addEventListener('click', () => {
    if (isVoiceBootstrapActive()) return;
    void toggleRec();
  });
  $('btnNext').addEventListener('click', () => {
    if (isVoiceBootstrapActive()) return;
    nextItem();
  });

  $('debugMode').addEventListener('change', (e) => {
    settings.showMlDebug = (e.target as HTMLInputElement).checked;
    saveSettings(settings);
    applySettingsUi();
  });

  if (!navigator.mediaDevices?.getUserMedia) {
    showErr('Microphone needs HTTPS or localhost (e.g. https://early-sigma.vercel.app or npm run dev).');
  }

  void ensureDspEngine(curStageId).then(async () => {
    if (!isVoiceBankComplete(curStageId)) {
      $('netTxt').textContent = 'Voice setup required';
      await startVoiceBootstrap(curStageId);
      return;
    }
    $('netTxt').textContent = `TensorFlow.js WASM · ${getStage(curStageId).label}`;
    setTargetItem(pickRandomItem(curStageId));
  });
}

init();
