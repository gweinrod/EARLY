import {
  createSpeechRecognition,
  eventHasFinalTranscript,
  fullTranscriptFromEvent,
} from './asr';
import { APP_VERSION } from './version';
import {
  autoConfirmAsrPass,
  initCollectorPanel,
  promptTeacherJudgment,
  setCloudRefreshHandler,
  setJudgmentCompleteHandler,
  syncStudentIdField,
} from './collector-ui';
import {
  type CurriculumItem,
  type CurriculumStageId,
  getStage,
  pickRandomItem,
  STAGE_ORDER,
  transcriptMatchesItem,
  transcriptMatchesItemForAutoStop,
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
import {
  flushCloudQueue,
  formatCloudSyncLine,
  refreshCloudStats,
  subscribeCloudSync,
  uploadCalibrationSample,
} from './cloud-calibration';
import { refreshLocalTrainingStatus } from './local-training-stats';
import {
  flushVoiceBankQueue,
  getVoiceBankQueueLength,
  syncLocalVoiceBankToCloud,
} from './cloud-voice-bank';
import { isTfReady, trainCalibrationSample, type TfInitResult } from './tf-phoneme';
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
  setModelLoadStatus,
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
let endingTake = false;
let takeSessionId = 0;
let takeStartedAt = 0;
let maxTakeTimer: ReturnType<typeof setTimeout> | null = null;
let asrPauseTimer: ReturnType<typeof setTimeout> | null = null;
let listening = false;
let asrRestartsThisTake = 0;
/** End take after speech pauses (post-speech tail). */
const ASR_PAUSE_MS = 1400;
/** Brief floor so auto-stop does not fire on the first syllable. */
const MIN_TAKE_MS = 350;
/** Chrome ends continuous ASR often; restart in the same take (not a second tap). */
const ASR_MAX_RESTARTS_PER_TAKE = 24;
let stopWave: (() => void) | null = null;
let lastDsp: DspPrediction | null = null;
let pendingHeard: string | null = null;
let pendingAsrPass: boolean | null = null;
let lastLoggedAttemptId: string | null = null;

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

function resetListenUi(): void {
  listening = false;
  $('btnRec').classList.remove('on');
  $('btnLbl').textContent = 'tap to speak';
  stopWave?.();
  stopWave = null;
}

function resetTakeState(): void {
  attemptFinalized = false;
  dspProcessed = false;
  asrEnded = false;
  endingTake = false;
  asrRestartsThisTake = 0;
  clearAsrWait();
  pendingHeard = null;
  pendingAsrPass = null;
  if (maxTakeTimer) {
    clearTimeout(maxTakeTimer);
    maxTakeTimer = null;
  }
  if (asrPauseTimer) {
    clearTimeout(asrPauseTimer);
    asrPauseTimer = null;
  }
}

function setAsrWaitStatus(msg: string): void {
  $('btnLbl').textContent = msg;
}

function clearAsrPauseTimer(): void {
  if (asrPauseTimer) {
    clearTimeout(asrPauseTimer);
    asrPauseTimer = null;
  }
}

/** Stop recorder after ASR has time to deliver late transcripts. */
function scheduleMediaStop(): void {
  clearAsrWait();
  const hasTranscript = pendingHeard !== null && pendingHeard.length > 0;
  if (!hasTranscript) setAsrWaitStatus('checking speech…');

  const ms = hasTranscript ? 650 : 2800;
  asrWaitTimer = setTimeout(() => {
    asrWaitTimer = null;
    if (pendingHeard === null) {
      pendingHeard = '';
      pendingAsrPass = false;
    }
    if (mediaRec && mediaRec.state !== 'inactive') mediaRec.stop();
    else if (dspProcessed) scheduleAttemptFinalize();
  }, ms);
}

function markAsrEnded(): void {
  if (asrEnded) return;
  asrEnded = true;
  scheduleMediaStop();
}

function releaseMic(): void {
  if (recStream) {
    recStream.getTracks().forEach((t) => t.stop());
    recStream = null;
  }
  activeRecognition = null;
  endingTake = false;
}

function scheduleAttemptFinalize(): void {
  if (attemptFinalized) return;

  if (pendingHeard !== null && pendingAsrPass !== null) {
    finalizeAttempt();
    return;
  }

  if (!dspProcessed || !endingTake) return;

  clearAsrWait();

  if (!asrEnded) {
    asrWaitTimer = setTimeout(() => {
      asrWaitTimer = null;
      asrEnded = true;
      scheduleAttemptFinalize();
    }, 2500);
    return;
  }

  if (pendingHeard === null) {
    pendingHeard = '';
    pendingAsrPass = false;
  }

  finalizeAttempt();
}

/** End speech recognition; keep recorder running until ASR transcript is collected. */
function endTake(): void {
  if (maxTakeTimer) {
    clearTimeout(maxTakeTimer);
    maxTakeTimer = null;
  }
  clearAsrPauseTimer();

  if (endingTake) {
    if (listening) resetListenUi();
    markAsrEnded();
    return;
  }

  endingTake = true;
  resetListenUi();

  if (activeRecognition) {
    try {
      activeRecognition.stop();
    } catch {
      markAsrEnded();
    }
  } else {
    markAsrEnded();
  }
}

function finalizeAttempt(): void {
  if (attemptFinalized) return;
  attemptFinalized = true;
  dspProcessed = false;
  asrEnded = false;
  clearAsrWait();
  resetListenUi();
  releaseMic();

  const heard = pendingHeard ?? '';
  const asrPass = pendingAsrPass ?? false;
  pendingHeard = null;
  pendingAsrPass = null;

  finishAttempt(heard, asrPass);
}

function applyAsrTranscript(heard: string): void {
  if (!heard.trim()) return;
  pendingHeard = heard;
  pendingAsrPass = transcriptMatchesItem(curStageId, heard, curItem);
  if (listening) $('btnLbl').textContent = `heard: ${heard}`;
  if (endingTake) scheduleMediaStop();
  else if (!listening) scheduleAttemptFinalize();
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
    lastLoggedAttemptId = attempt.id;
    if (asrPass && heard.trim() && dsp.dspPass) {
      const judgment = autoConfirmAsrPass(attempt, curStageId, heard, { dspFailed: false });
      addFB(
        {
          t: 'pass',
          s: `DSP and ASR agree on “${heard}” — saved for training.`,
        },
        true,
      );
      void onTeacherJudgment(judgment);
    } else if (asrPass && heard.trim() && !dsp.dspPass) {
      const judgment = autoConfirmAsrPass(attempt, curStageId, heard, { dspFailed: true });
      addFB(
        {
          t: 'pass',
          s: `ASR correct, DSP missed — pass; saved for training.`,
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

  const meta = getSessionMeta();
  void uploadCalibrationSample({
    stageId: curStageId,
    targetKey: curItem.key,
    teacherHeardKey: j.teacherHeardKey,
    embedding: lastDsp.embedding,
    agrees: j.agrees,
    asrWrong: j.asrWrong,
    dspWrong: j.dspWrong,
    studentId: meta.studentId || undefined,
    attemptId: lastLoggedAttemptId ?? undefined,
  }).then(() => {
    void flushCloudQueue().then(() => flushVoiceBankQueue());
  });
}

function applyModelLoadStatus(load: TfInitResult): void {
  if (load.publishLoadFailed && load.availablePublishVersion != null) {
    setModelLoadStatus(
      `Could not load shared model v${load.availablePublishVersion} — using local`,
      'warn',
    );
    return;
  }
  if (!isTfReady()) {
    setModelLoadStatus('Neural model not loaded (heuristics only)', 'warn');
    return;
  }
  if (load.source === 'published_fresh' && load.publishedVersion != null) {
    setModelLoadStatus(`Shared classroom model loaded (v${load.publishedVersion})`, 'ok');
    return;
  }
  if (load.source === 'published_cached' && load.publishedVersion != null) {
    setModelLoadStatus(`Shared classroom model (v${load.publishedVersion})`, 'ok');
    return;
  }
  if (load.source === 'bootstrap') {
    setModelLoadStatus('Local model (teacher voice seed)', 'neutral');
    return;
  }
  setModelLoadStatus('Local neural model', 'neutral');
}

async function prepareStage(stageId: CurriculumStageId): Promise<void> {
  resetMelFilterbank();
  setModelLoadStatus('Loading classroom model…', 'neutral');
  $('netTxt').textContent = 'Loading classroom model…';
  const load = await ensureDspEngine(stageId);

  nextItem();
  applyModelLoadStatus(load);

  if (isTfReady()) {
    const shared =
      load.publishedVersion != null &&
      (load.source === 'published_fresh' || load.source === 'published_cached');
    const sharedTag = shared ? ` · shared v${load.publishedVersion}` : '';
    $('netTxt').textContent = `TensorFlow.js WASM · ${getStage(stageId).label}${sharedTag}`;
  } else {
    $('netTxt').textContent = 'Heuristics only — publish or record teacher voice seed';
  }

  void refreshCloudStats(stageId, getVoiceBankQueueLength());
  refreshLocalTrainingStatus(stageId);
}

async function switchStage(stageId: CurriculumStageId): Promise<void> {
  curStageId = stageId;
  settings.curriculumStage = stageId;
  saveSettings(settings);
  await prepareStage(stageId);
}

function onVoiceBootstrapComplete(): void {
  void (async () => {
    await ensureDspEngine(curStageId);
    if (settings.collectorMode) {
      await syncLocalVoiceBankToCloud(curStageId);
    }
    await prepareStage(curStageId);
  })();
}

async function toggleRec(): Promise<void> {
  if (listening) {
    endTake();
    return;
  }

  if (activeRecognition) {
    try {
      activeRecognition.abort();
    } catch {
      /* previous session */
    }
    activeRecognition = null;
  }

  const session = ++takeSessionId;
  resetTakeState();

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

    listening = true;
    takeStartedAt = Date.now();
    $('btnRec').classList.add('on');
    $('btnLbl').textContent = 'listening...';
    clearFB();
    hide('hmWrap');
    hide('pbWrap');
    hide('resultBanner');
    stopWave = drawWave(an, () => listening && session === takeSessionId);

    maxTakeTimer = setTimeout(() => {
      maxTakeTimer = null;
      if (listening && session === takeSessionId) endTake();
    }, 12000);

    activeRecognition = createSpeechRecognition();
    if (activeRecognition) {
      const recognition = activeRecognition;
      recognition.onresult = (e: SpeechRecognitionEvent) => {
        if (session !== takeSessionId || endingTake) return;
        const heard = fullTranscriptFromEvent(e);
        if (!heard) return;
        const isFinal = eventHasFinalTranscript(e);

        applyAsrTranscript(heard);
        if (!listening) return;

        if (
          Date.now() - takeStartedAt >= MIN_TAKE_MS &&
          transcriptMatchesItemForAutoStop(curStageId, heard, curItem, isFinal)
        ) {
          clearAsrPauseTimer();
          endTake();
          return;
        }

        clearAsrPauseTimer();
        asrPauseTimer = setTimeout(() => {
          asrPauseTimer = null;
          if (listening && session === takeSessionId && !endingTake && pendingHeard) {
            endTake();
          }
        }, ASR_PAUSE_MS);
      };
      recognition.onerror = (e: SpeechRecognitionErrorEvent) => {
        if (session !== takeSessionId) return;
        if (e.error === 'no-speech' || e.error === 'aborted') return;
      };
      recognition.onend = () => {
        if (session !== takeSessionId) return;
        if (endingTake) {
          markAsrEnded();
          return;
        }
        if (!listening) return;
        // Chrome stops continuous sessions constantly; restart in the SAME take (user does not tap again).
        if (asrRestartsThisTake < ASR_MAX_RESTARTS_PER_TAKE) {
          asrRestartsThisTake++;
          try {
            recognition.start();
            return;
          } catch {
            /* fall through */
          }
        }
        if (pendingHeard && !asrPauseTimer) {
          asrPauseTimer = setTimeout(() => {
            asrPauseTimer = null;
            if (listening && session === takeSessionId && !endingTake) endTake();
          }, 400);
        }
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

    if (mediaRec && mediaRec.state === 'inactive') {
      mediaRec.start(100);
    }
  } catch (e) {
    resetListenUi();
    showErr(`Mic denied — ${e instanceof Error ? e.message : String(e)}`);
  }
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
    setCloudRefreshHandler(() => {
      void refreshCloudStats(curStageId, getVoiceBankQueueLength(), { force: true });
    });
    const meta = getSessionMeta();
    syncStudentIdField(meta.studentId);
    subscribeCloudSync((s) => {
      $('cloudSyncStatus').textContent = formatCloudSyncLine(s);
      refreshLocalTrainingStatus(curStageId);
    });
    refreshLocalTrainingStatus(curStageId);
    void flushCloudQueue()
      .then(() => flushVoiceBankQueue())
      .then(async () => {
        if (settings.collectorMode && isVoiceBankComplete(curStageId)) {
          await syncLocalVoiceBankToCloud(curStageId);
        }
        await refreshCloudStats(curStageId, getVoiceBankQueueLength(), { force: true });
      });
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

  void prepareStage(curStageId);
}

init();
