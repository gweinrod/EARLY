import { asrLog, asrWarn, dumpSpeechResultEvent, formatAsrLogTail } from './asr-debug';
import {
  createSpeechRecognition,
  eventHasFinalTranscript,
  fullTranscriptFromEvent,
  getSpeechRecognitionProfile,
  isChromiumSpeechRecognition,
  isSafariSpeechRecognition,
  mergeTakeTranscript,
  speechResultEventHasContent,
  type SpeechRecognitionProfile,
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
  pickNextItemInOrder,
  STAGE_ORDER,
  transcriptMatchesItem,
  transcriptMatchesItemForAutoStop,
  transcriptMatchesItemForScoring,
  transcriptMatchesItemForSessionEnd,
  isIncompleteLetterNamePrefix,
  letterNameNeedsAsrRecovery,
  normalizeHeardLabel,
  remapAsrMishearForItem,
  resolveHeardForEeChromeTail,
} from './curriculum';
import {
  ensureDspEngine,
  formatDspGuessForSummary,
  runDspPrediction,
  type DspPrediction,
} from './dsp-predict';
import { extractFrames, resetMelFilterbank } from './dsp';
import { buildRecordingBlob, createMediaRecorder } from './recorder';
import { applySettingsToDocument, loadSettings, saveSettings, type AppSettings } from './settings';
import {
  flagsFromFeedback,
  getSessionMeta,
  loadAttempts,
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
  renderHistory,
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
/** Cumulative ASR text across Chrome recognition restarts within one tap. */
let takeAsrAccum = '';
/** Chrome onend fired while heard was an incomplete bee/dee prefix (consonant only). */
let sawIncompleteEeOnEnd = false;
/** ASR result locked when ee-tail autofill ends take (survives short-recording clear). */
let lockedEeTailAsr: { heard: string; pass: boolean } | null = null;
let mediaProcessInFlight = false;
/** Heard/asrPass after immediate ee-tail finalize; DSP backfill may add collector training lines. */
let eeTailBackfill: { heard: string; asrPass: boolean } | null = null;
/** End take after speech pauses (post-speech tail). */
const ASR_PAUSE_MS = 1400;
/** Extra wait when Chrome only heard the consonant of bee/dee before onend. */
const ASR_EE_TAIL_MS = 900;
/** Extra time to collect ASR when the mic heard speech but transcript is still empty. */
const ASR_EMPTY_WAIT_MS = 2200;
/** Brief floor so auto-stop does not fire on the first syllable. */
const MIN_TAKE_MS = 350;
/** Min time for full "bee" before ee-tail autofill ends the take (one utterance). */
const EE_TAIL_MIN_TAKE_MS = 850;
/** Chrome ends continuous ASR often; restart in the same take (not a second tap). */
const ASR_MAX_RESTARTS_PER_TAKE = 24;
/** Hard cap per tap (was 12s " too long when Chrome never returns onresult). */
const MAX_TAKE_MS = 4000;
/** Ignore phantom ASR / auto-end until the mic has been open this long. */
const MIN_RECORDING_MS = 600;
/** Analyser RMS above this counts as the student actually speaking (not room noise). */
const SPEECH_RMS_THRESHOLD = 0.028;
let stopWave: (() => void) | null = null;
let speechCheckInterval: ReturnType<typeof setInterval> | null = null;
/** Set when mic energy exceeds threshold " lone "b" ASR is ignored until then. */
let speechDetectedThisTake = false;
/** SpeechRecognition session is running (do not call start() again until onend). */
let recognitionListening = false;
/** MediaRecorder started for this tap (Chrome defers until first ASR). */
let takeRecorderStarted = false;
let takeMicTracks: MediaStreamTrack[] = [];
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
  $('tPhon').textContent = `say: ${item.spokenName} | ${item.phonemeNote}`;
  $('stageSubtitle').textContent = stage.subtitle;
  clearFB();
  hide('hmWrap');
  hide('pbWrap');
  hide('resultBanner');
}

function nextItem(): void {
  setTargetItem(pickNextItemInOrder(curStageId, curItem.key));
}

function displayFeedback(items: DspPrediction['heuristicItems']): void {
  const shown = settings.collectorMode && !settings.showMlDebug ? toStudentFeedback(items) : items;
  for (const fb of shown) addFB(fb);
}

async function processAudio(dspBackfill = false): Promise<void> {
  if (mediaProcessInFlight) {
    return;
  }
  if (dspBackfill) {
    if (!attemptFinalized) {
      return;
    }
  } else if (attemptFinalized) {
    return;
  }
  mediaProcessInFlight = true;
  const ctx = getAudioContext();
  if (ctx.state === 'suspended') {
    try {
      await ctx.resume();
    } catch {
      /* continue */
    }
  }
  if (!recChunks.length || !audioCtx) {
    mediaProcessInFlight = false;
    return;
  }
  const blob = buildRecordingBlob(recChunks);
  const ab = await blob.arrayBuffer();

  try {
    const aB = await audioCtx.decodeAudioData(ab.slice(0));
    const audio = Array.from(aB.getChannelData(0));
    const frames = extractFrames(audio, aB.sampleRate);

    if (frames.length < 4) {
      if (!lockedEeTailAsr) {
        displayFeedback([{ t: 'warn', s: 'Recording too short - try again' }]);
        pendingHeard = null;
        pendingAsrPass = null;
        attemptFinalized = true;
        clearAsrWait();
        releaseMic();
      }
      dspProcessed = false;
      mediaProcessInFlight = false;
      return;
    }

    if (settings.showMlDebug) drawHeatmap(frames);

    lastDsp = runDspPrediction(frames, curItem.key, curStageId);
    displayFeedback(lastDsp.heuristicItems);

    if (settings.showMlDebug && lastDsp.tf) {
      showTfWordBars(lastDsp.tf.top3, lastDsp.tf.confidence);
    }

  } catch {
    if (!lockedEeTailAsr) {
      displayFeedback([{ t: 'warn', s: 'Could not decode audio' }]);
      pendingHeard = null;
      pendingAsrPass = null;
      attemptFinalized = true;
      clearAsrWait();
      releaseMic();
    }
    lastDsp = null;
    dspProcessed = false;
    mediaProcessInFlight = false;
    return;
  }

  dspProcessed = true;
  mediaProcessInFlight = false;
  if (dspBackfill && eeTailBackfill) {
    const { heard, asrPass } = eeTailBackfill;
    eeTailBackfill = null;
    finishAttempt(heard, asrPass);
    return;
  }
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
  takeAsrAccum = '';
  sawIncompleteEeOnEnd = false;
  lockedEeTailAsr = null;
  eeTailBackfill = null;
  speechDetectedThisTake = false;
  recognitionListening = false;
  takeRecorderStarted = false;
  takeMicTracks = [];
  clearSpeechCheckInterval();
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

function clearSpeechCheckInterval(): void {
  if (speechCheckInterval) {
    clearInterval(speechCheckInterval);
    speechCheckInterval = null;
  }
}

function noteSpeechEnergy(an: AnalyserNode): void {
  const buf = new Uint8Array(an.fftSize);
  an.getByteTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) {
    const x = (buf[i] - 128) / 128;
    sum += x * x;
  }
  const rms = Math.sqrt(sum / buf.length);
  if (rms >= SPEECH_RMS_THRESHOLD) speechDetectedThisTake = true;
}

function takeElapsedMs(): number {
  return takeStartedAt ? Date.now() - takeStartedAt : 0;
}

function asrTakeSnapshot(extra?: Record<string, unknown>): Record<string, unknown> {
  return {
    session: takeSessionId,
    target: curItem.key,
    spokenName: curItem.spokenName,
    listening,
    endingTake,
    asrEnded,
    attemptFinalized,
    speechDetected: speechDetectedThisTake,
    pendingHeard,
    pendingAsrPass,
    takeAsrAccum,
    asrRestarts: asrRestartsThisTake,
    elapsedMs: takeElapsedMs(),
    hasRecognition: !!activeRecognition,
    recorderState: mediaRec?.state ?? 'none',
    takeRecorderStarted,
    recognitionListening,
    sawIncompleteEeOnEnd,
    ...extra,
  };
}

function startTakeRecorder(caller: string): void {
  if (takeRecorderStarted || !mediaRec || mediaRec.state !== 'inactive') return;
  takeRecorderStarted = true;
  asrLog('mediaRecorder.start', asrTakeSnapshot({ caller }));
  mediaRec.start(100);
}

function setTakeMicEnabled(enabled: boolean, why: string): void {
  for (const t of takeMicTracks) {
    if (t.readyState === 'live') t.enabled = enabled;
  }
  asrLog('setTakeMicEnabled', { enabled, why, trackCount: takeMicTracks.length });
}

function canAutoEndTake(): boolean {
  return takeElapsedMs() >= MIN_RECORDING_MS;
}

/** Lone key on bee/dee or en/em/el letters without mic speech energy is almost always Chrome noise. */
function isPhantomKeyTranscript(heard: string): boolean {
  if (!letterNameNeedsAsrRecovery(curItem)) return false;
  if (speechDetectedThisTake) return false;
  const tokens = normalizeHeardLabel(heard).split(/\s+/).filter(Boolean);
  return tokens.length === 1 && tokens[0] === curItem.key;
}

function stopMediaRecorderNow(): void {
  if (!mediaRec || mediaRec.state === 'inactive') return;
  try {
    if (mediaRec.state === 'recording') mediaRec.requestData();
  } catch {
    /* requestData optional */
  }
  try {
    mediaRec.stop();
  } catch (err) {
  }
}

function stopMicTracksNow(): void {
  if (!recStream) return;
  recStream.getTracks().forEach((t) => t.stop());
}

/** End take from locked ASR now; do not wait for MediaRecorder onstop / decodeAudioData. */
function finalizeEeTailImmediately(): void {
  if (attemptFinalized || !lockedEeTailAsr) return;
  eeTailBackfill = { heard: lockedEeTailAsr.heard, asrPass: lockedEeTailAsr.pass };
  pendingHeard = eeTailBackfill.heard;
  pendingAsrPass = eeTailBackfill.asrPass;
  dspProcessed = true;
  finalizeAttempt({ deferScoring: true });
}

/** Run DSP after immediate finalize (mic already released). */
async function runEeTailDspBackfill(): Promise<void> {
  for (const delay of [0, 60, 200, 500, 1000]) {
    if (delay) await new Promise((r) => setTimeout(r, delay));
    if (mediaRec?.state === 'recording') stopMediaRecorderNow();
    if (recChunks.length) {
      await processAudio(true);
      return;
    }
  }
}

function endEeTailCapture(): void {
  stopMediaRecorderNow();
  stopMicTracksNow();
  finalizeEeTailImmediately();
  asrEnded = true;
  clearAsrWait();
  $('btnLbl').textContent = 'tap to speak';
  void runEeTailDspBackfill();
}

/** Stop recorder after ASR has time to deliver late transcripts. */
function scheduleMediaStop(): void {
  if (attemptFinalized) {
    return;
  }
  clearAsrWait();
  const hasTranscript = pendingHeard !== null && pendingHeard.length > 0;
  if (!hasTranscript) setAsrWaitStatus('checking speech...');

  const ms = lockedEeTailAsr
    ? 0
    : hasTranscript
      ? 650
      : speechDetectedThisTake
        ? ASR_EMPTY_WAIT_MS
        : 800;
  asrLog('scheduleMediaStop', { waitMs: ms, hasTranscript, ...asrTakeSnapshot() });
  asrWaitTimer = setTimeout(() => {
    asrWaitTimer = null;
    asrLog('scheduleMediaStop.fire', asrTakeSnapshot());
    if (pendingHeard === null) {
      pendingHeard = '';
      pendingAsrPass = false;
      asrLog('scheduleMediaStop.blankPending', asrTakeSnapshot());
    }
    if (mediaRec && mediaRec.state !== 'inactive') {
      mediaRec.stop();
    } else {
      dspProcessed = true;
      scheduleAttemptFinalize();
    }
  }, ms);
}

function markAsrEnded(): void {
  if (asrEnded) {
    return;
  }
  asrLog('markAsrEnded', asrTakeSnapshot());
  asrEnded = true;
  if (attemptFinalized) {
    return;
  }
  if (lockedEeTailAsr) {
    return;
  }
  scheduleMediaStop();
}

/** @param forceAbort true = cancel; false = end take and let Chrome flush finals via stop() */
function tearDownRecognition(forceAbort = true): void {
  const rec = activeRecognition;
  activeRecognition = null;
  recognitionListening = false;
  if (!rec) return;
  try {
    if (forceAbort) {
      rec.abort();
    } else {
      rec.stop();
    }
  } catch {
    try {
      rec.abort();
    } catch {
      /* already dead */
    }
  }
}

function releaseMic(): void {
  tearDownRecognition();
  setTakeMicEnabled(true, 'releaseMic');
  takeMicTracks = [];
  if (recStream) {
    recStream.getTracks().forEach((t) => t.stop());
    recStream = null;
  }
  endingTake = false;
}

function scheduleAttemptFinalize(): void {
  if (attemptFinalized) {
    return;
  }

  if (pendingHeard !== null && pendingAsrPass !== null) {
    finalizeAttempt();
    return;
  }

  if (!dspProcessed || !endingTake) {
    return;
  }

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
function endTake(caller = 'unknown'): void {
  asrLog('endTake', { caller, ...asrTakeSnapshot() });
  if (maxTakeTimer) {
    clearTimeout(maxTakeTimer);
    maxTakeTimer = null;
  }
  clearAsrPauseTimer();
  clearSpeechCheckInterval();

  if (endingTake) {
    if (listening) resetListenUi();
    markAsrEnded();
    return;
  }

  endingTake = true;
  resetListenUi();

  const rec = activeRecognition;
  activeRecognition = null;

  const completeAsrShutdown = () => {
    asrLog('completeAsrShutdown', asrTakeSnapshot());
    setTakeMicEnabled(true, 'endTake');
    if (!takeRecorderStarted && speechDetectedThisTake && mediaRec) {
      startTakeRecorder('endTake-fallback');
    }
    takeSessionId++;
    if (lockedEeTailAsr) {
      endEeTailCapture();
    } else {
      setAsrWaitStatus('checking...');
      markAsrEnded();
    }
  };

  if (!rec) {
    completeAsrShutdown();
    return;
  }

  let shutdownDone = false;
  const finishShutdown = () => {
    if (shutdownDone) return;
    shutdownDone = true;
    completeAsrShutdown();
  };

  rec.onend = () => {
    asrLog('endTake.rec.onend', asrTakeSnapshot());
    finishShutdown();
  };
  try {
    asrLog('endTake.rec.stop', asrTakeSnapshot());
    rec.stop();
  } catch {
    try {
      rec.abort();
    } catch {
      /* already dead */
    }
    finishShutdown();
    return;
  }
  setTimeout(finishShutdown, 280);
}

function finalizeAttempt(opts?: { deferScoring?: boolean }): void {
  if (attemptFinalized) {
    return;
  }
  attemptFinalized = true;
  dspProcessed = false;
  clearAsrWait();
  resetListenUi();
  releaseMic();

  const heard = lockedEeTailAsr?.heard ?? pendingHeard ?? '';
  const asrPass = lockedEeTailAsr?.pass ?? pendingAsrPass ?? false;
  lockedEeTailAsr = null;
  pendingHeard = null;
  pendingAsrPass = null;

  if (opts?.deferScoring) return;
  finishAttempt(heard, asrPass);
}

function shouldEndTakeFromEeTailAutofill(resolved: string): boolean {
  return (
    speechDetectedThisTake &&
    sawIncompleteEeOnEnd &&
    letterNameNeedsAsrRecovery(curItem) &&
    pendingAsrPass === true &&
    normalizeHeardLabel(resolved) === normalizeHeardLabel(curItem.spokenName)
  );
}

function applyAsrTranscript(heard: string): void {
  if (!heard.trim()) {
    asrLog('applyAsrTranscript.skipEmpty', asrTakeSnapshot({ raw: heard }));
    return;
  }
  const remapped = remapAsrMishearForItem(curStageId, heard, curItem);
  const resolved = resolveHeardForEeChromeTail(remapped, curItem, sawIncompleteEeOnEnd);
  pendingAsrPass = transcriptMatchesItemForScoring(curStageId, resolved, curItem);
  pendingHeard = resolved;
  takeAsrAccum = resolved;
  asrLog('applyAsrTranscript', {
    heard,
    remapped,
    resolved,
    pass: pendingAsrPass,
    ...asrTakeSnapshot(),
  });
  if (listening) {
    $('btnLbl').textContent =
      resolved !== heard ? `heard: ${resolved}` : `heard: ${heard}`;
  }

  if (
    listening &&
    !endingTake &&
    canAutoEndTake() &&
    takeElapsedMs() >= EE_TAIL_MIN_TAKE_MS &&
    shouldEndTakeFromEeTailAutofill(resolved)
  ) {
    lockedEeTailAsr = { heard: resolved, pass: true };
    clearAsrPauseTimer();
    endTake('ee-tail-autofill');
    return;
  }

  if (endingTake && !attemptFinalized) scheduleMediaStop();
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
      dspGuessDisplay: 'n/a',
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
          `app ${appPass ? 'pass' : 'fail'} (${basis}) | DSP ${formatDspGuessForSummary(dsp)} | ` +
          `ASR "${heard}"`,
      };
  addFB(studentMsg, true);

  if (!heard.trim() && speechDetectedThisTake) {
    const snap = asrTakeSnapshot({ asrPass, appPass, basis });
    asrWarn('finishAttempt.emptyAsrWithSpeech', snap);
    const trace = formatAsrLogTail(8);
    addFB(
      {
        t: 'warn',
        s:
          'Speech-to-text did not catch a word — try again (we never guess the target name).' +
          (trace ? ` Trace: ${trace}` : ''),
      },
      true,
    );
  }

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
    if (eeTailBackfill && !dsp.embedding) {
      addFB({ t: 'pass', s: `Heard "${heard}" - scoring audio...` }, true);
      return;
    }
    if (asrPass && heard.trim() && dsp.dspPass) {
      autoConfirmAsrPass(attempt, curStageId, heard, {
        dspFailed: false,
        statusMessage: `DSP and ASR agree on "${heard}" - saved for training.`,
      });
    } else if (asrPass && heard.trim() && !dsp.dspPass) {
      autoConfirmAsrPass(attempt, curStageId, heard, {
        dspFailed: true,
        statusMessage: `ASR correct, DSP missed - pass; saved for training.`,
      });
    } else {
      promptTeacherJudgment(attempt, curStageId);
    }
  }
}

/** Teacher accept overrides a failed automatic score to a pass for the student UI. */
function applyTeacherAcceptAsPass(teacherHeard: string): void {
  const latest = history[0];
  if (!latest || latest.w !== curItem.display || latest.pass) return;

  latest.pass = true;
  if (teacherHeard.trim()) latest.h = teacherHeard.trim();
  correct++;
  updateScores(correct, total);
  renderHistory(history);
  showResultBanner(true);

  if (settings.collectorMode && !settings.showMlDebug) {
    addFB(acousticStudentMessage(true), true);
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
      `Could not load shared model v${load.availablePublishVersion} - using local`,
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
  setModelLoadStatus('Loading classroom model...', 'neutral');
  $('netTxt').textContent = 'Loading classroom model...';
  const load = await ensureDspEngine(stageId);

  setTargetItem(getStage(stageId).items[0] ?? curItem);
  applyModelLoadStatus(load);

  if (isTfReady()) {
    const shared =
      load.publishedVersion != null &&
      (load.source === 'published_fresh' || load.source === 'published_cached');
    const sharedTag = shared ? ` | shared v${load.publishedVersion}` : '';
    $('netTxt').textContent = `TensorFlow.js WASM | ${getStage(stageId).label}${sharedTag}`;
  } else {
    $('netTxt').textContent = 'Heuristics only - publish or record teacher voice seed';
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
    endTake('manual-toggle');
    return;
  }

  if (activeRecognition) {
    tearDownRecognition(true);
  }

  const session = ++takeSessionId;
  resetTakeState();

  const ctx = getAudioContext();
  if (ctx.state === 'suspended') await ctx.resume();

  try {
    const asrProfile = getSpeechRecognitionProfile();
    asrLog('toggleRec.start', {
      session,
      profile: asrProfile,
      safari: isSafariSpeechRecognition(),
      chromium: isChromiumSpeechRecognition(),
      ...asrTakeSnapshot(),
    });
    recChunks = [];

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    recStream = stream;
    takeMicTracks = [...stream.getAudioTracks()];
    const src = ctx.createMediaStreamSource(stream);
    const takeAnalyser = ctx.createAnalyser();
    takeAnalyser.fftSize = 2048;
    src.connect(takeAnalyser);
    const recordStream = typeof stream.clone === 'function' ? stream.clone() : stream;
    mediaRec = createMediaRecorder(recordStream);
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
    stopWave = drawWave(takeAnalyser, () => listening && session === takeSessionId);
    clearSpeechCheckInterval();
    speechCheckInterval = setInterval(() => {
      if (!listening || session !== takeSessionId) {
        clearSpeechCheckInterval();
        return;
      }
      noteSpeechEnergy(takeAnalyser);
    }, 50);

    maxTakeTimer = setTimeout(() => {
      maxTakeTimer = null;
      if (!listening || session !== takeSessionId) return;
      endTake('max-take');
    }, MAX_TAKE_MS);

    activeRecognition = createSpeechRecognition();
    if (activeRecognition) {
      const recognition = activeRecognition;
      const { restartOnEnd, releaseLocalMicForAsr } = asrProfile;

      recognition.onstart = () => {
        if (session !== takeSessionId) return;
        recognitionListening = true;
        if (releaseLocalMicForAsr) setTakeMicEnabled(false, 'recognition.onstart');
        asrLog('recognition.onstart', asrTakeSnapshot({ restarts: asrRestartsThisTake }));
      };
      recognition.onspeechstart = () => {
        if (session === takeSessionId) {
          speechDetectedThisTake = true;
          asrLog('recognition.onspeechstart', asrTakeSnapshot());
          scheduleAsrPauseEnd('speech-start');
        }
      };
      recognition.onsoundstart = () => {
        if (session === takeSessionId) {
          speechDetectedThisTake = true;
          asrLog('recognition.onsoundstart', asrTakeSnapshot());
          if (!asrPauseTimer) scheduleAsrPauseEnd('sound-start');
        }
      };

      const scheduleAsrPauseEnd = (why: string) => {
        if (endingTake || lockedEeTailAsr || asrEnded) {
          return;
        }
        const raw = pendingHeard ?? '';
        if (asrPauseTimer && sawIncompleteEeOnEnd && isIncompleteLetterNamePrefix(raw, curItem)) {
          return;
        }
        clearAsrPauseTimer();
        const incomplete =
          !!raw && isIncompleteLetterNamePrefix(raw, curItem) && !sawIncompleteEeOnEnd;
        const ms =
          incomplete || (raw && isIncompleteLetterNamePrefix(raw, curItem))
            ? ASR_EE_TAIL_MS
            : ASR_PAUSE_MS;
        asrLog('scheduleAsrPauseEnd', { why, ms, raw, incomplete, ...asrTakeSnapshot() });
        asrPauseTimer = setTimeout(() => {
          asrPauseTimer = null;
          asrLog('scheduleAsrPauseEnd.fire', { why, ...asrTakeSnapshot() });
          if (!listening || session !== takeSessionId || endingTake) return;
          if (!canAutoEndTake()) {
            scheduleAsrPauseEnd('pause-wait-min-recording');
            return;
          }
          const h = pendingHeard ?? '';
          if (!h) {
            asrWarn('pause.noTranscript', asrTakeSnapshot({ why, recognitionListening }));
            if (recognitionListening) {
              if (takeElapsedMs() < MAX_TAKE_MS - 200) {
                scheduleAsrPauseEnd('pause-wait-asr-active');
              }
              return;
            }
            if (speechDetectedThisTake && tryRestartRecognition('pause-empty')) {
              return;
            }
            if (speechDetectedThisTake && takeElapsedMs() < MAX_TAKE_MS - 600) {
              scheduleAsrPauseEnd('pause-empty-wait');
              return;
            }
            endTake('pause-empty-no-asr');
            return;
          }
          if (isIncompleteLetterNamePrefix(h, curItem)) {
            if (sawIncompleteEeOnEnd && speechDetectedThisTake) {
              const resolved = normalizeHeardLabel(curItem.spokenName);
              lockedEeTailAsr = { heard: resolved, pass: true };
              endTake('pause-ee-forced');
            } else {
              sawIncompleteEeOnEnd = true;
              applyAsrTranscript(h);
            }
            return;
          }
          if (
            pendingAsrPass &&
            sawIncompleteEeOnEnd &&
            letterNameNeedsAsrRecovery(curItem)
          ) {
            endTake('pause-ee-scored');
            return;
          }
          endTake('pause-default');
        }, ms);
      };

      const tryRestartRecognition = (why: string): boolean => {
        if (session !== takeSessionId || endingTake || lockedEeTailAsr || !listening) {
          asrLog('tryRestartRecognition.skip', { why, ...asrTakeSnapshot() });
          return false;
        }
        if (recognitionListening) {
          asrLog('tryRestartRecognition.skipActive', { why, ...asrTakeSnapshot() });
          return false;
        }
        if (asrRestartsThisTake >= ASR_MAX_RESTARTS_PER_TAKE) {
          asrLog('tryRestartRecognition.max', { why, ...asrTakeSnapshot() });
          return false;
        }
        asrRestartsThisTake++;
        try {
          recognition.start();
          recognitionListening = true;
          asrLog('tryRestartRecognition.ok', { why, restarts: asrRestartsThisTake, ...asrTakeSnapshot() });
          scheduleAsrPauseEnd(`restart-${why}`);
          if (listening) $('btnLbl').textContent = 'listening…';
          return true;
        } catch (err) {
          asrLog('tryRestartRecognition.fail', {
            why,
            err: err instanceof Error ? err.message : String(err),
            ...asrTakeSnapshot(),
          });
          return false;
        }
      };

      recognition.onresult = (e: SpeechRecognitionEvent) => {
        if (session !== takeSessionId) {
          asrLog('onresult.staleSession', { hookSession: session, ...asrTakeSnapshot() });
          return;
        }
        if (endingTake) {
          const dump = dumpSpeechResultEvent(e);
          if (!speechResultEventHasContent(e)) {
            asrLog('onresult.flushNoContent', { dump, ...asrTakeSnapshot() });
            return;
          }
          const flushText = fullTranscriptFromEvent(e);
          asrLog('onresult.flush', { flushText, dump, ...asrTakeSnapshot() });
          if (flushText.trim()) {
            setTakeMicEnabled(true, 'flush-asr');
            startTakeRecorder('flush-asr');
            const flushed = mergeTakeTranscript(takeAsrAccum, flushText, curItem);
            if (!isPhantomKeyTranscript(flushed)) {
              takeAsrAccum = flushed;
              applyAsrTranscript(flushed);
            } else {
              asrLog('onresult.flushPhantom', { flushed, ...asrTakeSnapshot() });
            }
          }
          return;
        }
        const dump = dumpSpeechResultEvent(e);
        const hasContent = speechResultEventHasContent(e);
        if (!hasContent) {
          asrLog('onresult.noContent', { dump, ...asrTakeSnapshot() });
          return;
        }
        const eventText = fullTranscriptFromEvent(e);
        if (!eventText.trim()) {
          asrLog('onresult.emptyText', { dump, hasContent, ...asrTakeSnapshot() });
          return;
        }
        setTakeMicEnabled(true, 'first-asr');
        if (asrProfile.recorderStartMode === 'after-first-asr') {
          startTakeRecorder('first-asr');
        }
        const heard = mergeTakeTranscript(takeAsrAccum, eventText, curItem);
        if (isPhantomKeyTranscript(heard)) {
          asrLog('onresult.phantom', { eventText, heard, dump, ...asrTakeSnapshot() });
          return;
        }
        asrLog('onresult', {
          eventText,
          heard,
          isFinal: eventHasFinalTranscript(e),
          dump,
          ...asrTakeSnapshot(),
        });
        takeAsrAccum = heard;
        const isFinal = eventHasFinalTranscript(e);

        // Chrome marks "b" before "ee" or drops "en"/"em"; after MIN_TAKE_MS treat as missed tail.
        if (
          speechDetectedThisTake &&
          letterNameNeedsAsrRecovery(curItem) &&
          isIncompleteLetterNamePrefix(heard, curItem) &&
          takeElapsedMs() >= EE_TAIL_MIN_TAKE_MS
        ) {
          sawIncompleteEeOnEnd = true;
        }

        applyAsrTranscript(heard);
        if (!listening || endingTake) return;

        if (
          canAutoEndTake() &&
          takeElapsedMs() >= MIN_TAKE_MS &&
          transcriptMatchesItemForAutoStop(curStageId, heard, curItem, isFinal)
        ) {
          clearAsrPauseTimer();
          endTake('auto-stop-match');
          return;
        }

        scheduleAsrPauseEnd('onresult');
      };
      recognition.onerror = (e: SpeechRecognitionErrorEvent) => {
        if (session !== takeSessionId) return;
        if (e.error === 'aborted') return;
        asrLog('recognition.onerror', { error: e.error, message: e.message, ...asrTakeSnapshot() });
        if (e.error === 'no-speech') {
          if (tryRestartRecognition('no-speech')) return;
          return;
        }
        if (e.error === 'network' && tryRestartRecognition('network')) return;
      };
      recognition.onnomatch = () => {
        if (session !== takeSessionId || endingTake || !listening) return;
        asrLog('recognition.onnomatch', asrTakeSnapshot());
        if (speechDetectedThisTake && tryRestartRecognition('nomatch')) return;
      };
      recognition.onend = () => {
        recognitionListening = false;
        if (releaseLocalMicForAsr && !endingTake) setTakeMicEnabled(true, 'onend');
        const heardOnEnd = pendingHeard ?? '';
        if (session !== takeSessionId) {
          asrLog('onend.staleSession', { hookSession: session, ...asrTakeSnapshot() });
          return;
        }
        asrLog('recognition.onend', { heardOnEnd, ...asrTakeSnapshot() });
        if (endingTake || asrEnded || lockedEeTailAsr) return;
        if (!listening) {
          return;
        }
        if (
          heardOnEnd &&
          !isIncompleteLetterNamePrefix(heardOnEnd, curItem) &&
          canAutoEndTake() &&
          takeElapsedMs() >= MIN_TAKE_MS &&
          transcriptMatchesItemForSessionEnd(curStageId, heardOnEnd, curItem)
        ) {
          clearAsrPauseTimer();
          endTake('onend-session-match');
          return;
        }
        if (isIncompleteLetterNamePrefix(heardOnEnd, curItem)) {
          if (isPhantomKeyTranscript(heardOnEnd)) {
            return;
          }
          if (speechDetectedThisTake && takeElapsedMs() >= EE_TAIL_MIN_TAKE_MS) {
            sawIncompleteEeOnEnd = true;
          }
          clearAsrPauseTimer();
          if (!isPhantomKeyTranscript(heardOnEnd)) applyAsrTranscript(heardOnEnd);
          if (endingTake || !listening || lockedEeTailAsr) {
            return;
          }
          $('btnLbl').textContent = `heard "${heardOnEnd}" - keep going...`;
        }
        if (!listening || endingTake || lockedEeTailAsr) {
          return;
        }
        if (restartOnEnd) {
          const deferRestart = (why: string) => {
            setTimeout(() => {
              if (session !== takeSessionId || endingTake || !listening) return;
              tryRestartRecognition(why);
            }, 120);
          };
          if (!heardOnEnd.trim() && speechDetectedThisTake) {
            deferRestart('onend-empty');
            return;
          }
          deferRestart('onend-restart');
          return;
        }
        if (!heardOnEnd.trim() && speechDetectedThisTake && !asrPauseTimer) {
          scheduleAsrPauseEnd('onend-no-text');
        } else if (pendingHeard && !asrPauseTimer) {
          scheduleAsrPauseEnd('onend-fallback');
        }
      };
      try {
        if (releaseLocalMicForAsr) setTakeMicEnabled(false, 'pre-start');
        recognition.start();
        recognitionListening = true;
        asrLog('recognition.start', asrTakeSnapshot({ profile: asrProfile }));
        setTimeout(() => {
          if (session !== takeSessionId || endingTake || !listening || asrPauseTimer) return;
          if (!speechDetectedThisTake) scheduleAsrPauseEnd('idle-no-speech');
        }, 3200);
      } catch (err) {
        asrWarn('recognition.start.fail', {
          err: err instanceof Error ? err.message : String(err),
          ...asrTakeSnapshot(),
        });
        activeRecognition = null;
        asrEnded = true;
      }
    } else {
      asrLog('toggleRec.noSpeechApi', asrTakeSnapshot());
      asrEnded = true;
    }

    if (asrProfile.recorderStartMode === 'immediate') {
      const startImmediate = () => {
        if (!listening || session !== takeSessionId) return;
        startTakeRecorder('immediate');
      };
      if (asrProfile.mediaRecorderDelayMs > 0) {
        setTimeout(startImmediate, asrProfile.mediaRecorderDelayMs);
      } else {
        startImmediate();
      }
    } else {
      asrLog('mediaRecorder.deferred', asrTakeSnapshot({ until: 'first-asr' }));
    }
  } catch (e) {
    resetListenUi();
    showErr(`Mic denied " ${e instanceof Error ? e.message : String(e)}`);
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
  asrWarn('init', {
    version: APP_VERSION,
    hint: "Console: filter '[EARLY ASR]' or type __earlyAsrLog; disable logs: localStorage early.asrDebug=0",
    safari: isSafariSpeechRecognition(),
    chromium: isChromiumSpeechRecognition(),
    profile: getSpeechRecognitionProfile(),
  });

  settings = loadSettings();
  curStageId = settings.curriculumStage;
  applySettingsUi();
  initStagePills();
  if (settings.collectorMode) {
    initCollectorPanel();
    setJudgmentCompleteHandler((j) => {
      if (j.agrees) applyTeacherAcceptAsPass(j.teacherHeard);
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
