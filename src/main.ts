import {
  createSpeechRecognition,
  eventHasFinalTranscript,
  fullTranscriptFromEvent,
  mergeTakeTranscript,
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
  isIncompleteEeNamePrefix,
  letterNameIsKeyPlusEe,
  normalizeHeardLabel,
  resolveHeardForEeChromeTail,
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
/** End take after speech pauses (post-speech tail). */
const ASR_PAUSE_MS = 1400;
/** Extra wait when Chrome only heard the consonant of bee/dee before onend. */
const ASR_EE_TAIL_MS = 2200;
/** Brief floor so auto-stop does not fire on the first syllable. */
const MIN_TAKE_MS = 350;
/** Min time for full "bee" before ee-tail autofill ends the take (one utterance). */
const EE_TAIL_MIN_TAKE_MS = 850;
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

function takeSnapshot(extra?: Record<string, unknown>): Record<string, unknown> {
  return {
    session: takeSessionId,
    letter: curItem.display,
    listening,
    endingTake,
    asrEnded,
    attemptFinalized,
    dspProcessed,
    restarts: asrRestartsThisTake,
    chromeAteTail: sawIncompleteEeOnEnd,
    pendingHeard,
    pendingAsrPass,
    lockedHeard: lockedEeTailAsr?.heard ?? null,
    accum: takeAsrAccum,
    mediaState: mediaRec?.state ?? 'none',
    recChunks: recChunks.length,
    pauseTimer: !!asrPauseTimer,
    asrWaitTimer: !!asrWaitTimer,
    takeMs: takeStartedAt ? Date.now() - takeStartedAt : 0,
    ...extra,
  };
}

function takeLog(event: string, extra?: Record<string, unknown>): void {
  console.log('[TAKE]', event, takeSnapshot(extra));
}

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
  setTargetItem(pickNextItemInOrder(curStageId, curItem.key));
}

function displayFeedback(items: DspPrediction['heuristicItems']): void {
  const shown = settings.collectorMode && !settings.showMlDebug ? toStudentFeedback(items) : items;
  for (const fb of shown) addFB(fb);
}

async function processAudio(): Promise<void> {
  takeLog('processAudio start');
  if (!recChunks.length || !audioCtx) {
    takeLog('processAudio abort empty', { chunks: recChunks.length });
    return;
  }
  const blob = buildRecordingBlob(recChunks);
  const ab = await blob.arrayBuffer();

  try {
    const aB = await audioCtx.decodeAudioData(ab.slice(0));
    const audio = Array.from(aB.getChannelData(0));
    const frames = extractFrames(audio, aB.sampleRate);

    if (frames.length < 4) {
      takeLog('processAudio too short', { frames: frames.length, locked: !!lockedEeTailAsr });
      displayFeedback([{ t: 'warn', s: 'Recording too short — try again' }]);
      if (!lockedEeTailAsr) {
        pendingHeard = null;
        pendingAsrPass = null;
      }
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
  takeLog('processAudio done', { frames: lastDsp ? 'ok' : 'no-dsp' });
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
  takeLog('resetTakeState');
  attemptFinalized = false;
  dspProcessed = false;
  asrEnded = false;
  endingTake = false;
  asrRestartsThisTake = 0;
  takeAsrAccum = '';
  sawIncompleteEeOnEnd = false;
  lockedEeTailAsr = null;
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

  const ms = lockedEeTailAsr ? 400 : hasTranscript ? 650 : 2800;
  takeLog('scheduleMediaStop', { delayMs: ms, hasTranscript });
  asrWaitTimer = setTimeout(() => {
    asrWaitTimer = null;
    takeLog('scheduleMediaStop fire');
    if (pendingHeard === null) {
      pendingHeard = '';
      pendingAsrPass = false;
    }
    if (mediaRec && mediaRec.state !== 'inactive') {
      takeLog('mediaRec.stop()');
      mediaRec.stop();
    } else {
      takeLog('mediaRec already inactive', { dspProcessed });
      if (dspProcessed) scheduleAttemptFinalize();
    }
  }, ms);
}

function markAsrEnded(): void {
  if (asrEnded) {
    takeLog('markAsrEnded noop (already ended)');
    return;
  }
  asrEnded = true;
  takeLog('markAsrEnded');
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
  takeLog('scheduleAttemptFinalize enter');
  if (attemptFinalized) {
    takeLog('scheduleAttemptFinalize noop already finalized');
    return;
  }

  if (pendingHeard !== null && pendingAsrPass !== null) {
    takeLog('scheduleAttemptFinalize → finalize (pending ready)');
    finalizeAttempt();
    return;
  }

  if (!dspProcessed || !endingTake) {
    takeLog('scheduleAttemptFinalize wait', { dspProcessed, endingTake });
    return;
  }

  clearAsrWait();

  if (!asrEnded) {
    takeLog('scheduleAttemptFinalize wait asrEnded 2500ms');
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

  takeLog('scheduleAttemptFinalize → finalize (fallback)');
  finalizeAttempt();
}

/** End speech recognition; keep recorder running until ASR transcript is collected. */
function endTake(caller = 'unknown'): void {
  takeLog('endTake called', { caller });
  if (maxTakeTimer) {
    clearTimeout(maxTakeTimer);
    maxTakeTimer = null;
  }
  clearAsrPauseTimer();

  if (endingTake) {
    takeLog('endTake reentrant');
    if (listening) resetListenUi();
    markAsrEnded();
    return;
  }

  endingTake = true;
  resetListenUi();

  if (activeRecognition) {
    try {
      takeLog('recognition.stop()');
      activeRecognition.stop();
    } catch (err) {
      takeLog('recognition.stop() threw', { err: String(err) });
    }
  } else {
    takeLog('endTake no activeRecognition');
  }
  markAsrEnded();
}

function finalizeAttempt(): void {
  takeLog('finalizeAttempt');
  if (attemptFinalized) {
    takeLog('finalizeAttempt noop');
    return;
  }
  attemptFinalized = true;
  dspProcessed = false;
  asrEnded = false;
  clearAsrWait();
  resetListenUi();
  releaseMic();

  const heard = lockedEeTailAsr?.heard ?? pendingHeard ?? '';
  const asrPass = lockedEeTailAsr?.pass ?? pendingAsrPass ?? false;
  lockedEeTailAsr = null;
  pendingHeard = null;
  pendingAsrPass = null;

  takeLog('finalizeAttempt → finishAttempt', { heard, asrPass });
  finishAttempt(heard, asrPass);
}

function shouldEndTakeFromEeTailAutofill(resolved: string): boolean {
  return (
    sawIncompleteEeOnEnd &&
    letterNameIsKeyPlusEe(curItem) &&
    pendingAsrPass === true &&
    normalizeHeardLabel(resolved) === normalizeHeardLabel(curItem.spokenName)
  );
}

function applyAsrTranscript(heard: string): void {
  if (!heard.trim()) return;
  const resolved = resolveHeardForEeChromeTail(heard, curItem, sawIncompleteEeOnEnd);
  pendingAsrPass = transcriptMatchesItemForScoring(curStageId, resolved, curItem);
  takeLog('applyAsrTranscript', {
    raw: heard,
    resolved,
    match: transcriptMatchesItem(curStageId, heard, curItem),
    score: pendingAsrPass,
    incomplete: isIncompleteEeNamePrefix(heard, curItem),
    autofillReady: shouldEndTakeFromEeTailAutofill(resolved),
    takeMs: takeStartedAt ? Date.now() - takeStartedAt : 0,
  });
  pendingHeard = resolved;
  takeAsrAccum = resolved;
  if (listening) {
    $('btnLbl').textContent =
      resolved !== heard ? `heard: ${resolved}` : `heard: ${heard}`;
  }

  if (
    listening &&
    !endingTake &&
    Date.now() - takeStartedAt >= EE_TAIL_MIN_TAKE_MS &&
    shouldEndTakeFromEeTailAutofill(resolved)
  ) {
    takeLog('ee-tail autofill → endTake');
    lockedEeTailAsr = { heard: resolved, pass: true };
    clearAsrPauseTimer();
    endTake('ee-tail-autofill');
    return;
  }

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

  setTargetItem(getStage(stageId).items[0] ?? curItem);
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
    takeLog('toggleRec manual stop');
    endTake('manual-toggle');
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
  takeLog('toggleRec start take', { session });
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
      takeLog('mediaRec.onstop');
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
      if (listening && session === takeSessionId) endTake('max-take-12s');
    }, 12000);

    activeRecognition = createSpeechRecognition();
    if (activeRecognition) {
      const recognition = activeRecognition;

      const scheduleAsrPauseEnd = (why: string) => {
        if (endingTake || lockedEeTailAsr || asrEnded) {
          takeLog('scheduleAsrPauseEnd skipped', { why, endingTake, locked: !!lockedEeTailAsr, asrEnded });
          return;
        }
        clearAsrPauseTimer();
        const raw = pendingHeard ?? '';
        const incomplete =
          !!raw && isIncompleteEeNamePrefix(raw, curItem) && !sawIncompleteEeOnEnd;
        const ms = incomplete || (raw && isIncompleteEeNamePrefix(raw, curItem))
          ? ASR_EE_TAIL_MS
          : ASR_PAUSE_MS;
        takeLog('scheduleAsrPauseEnd', { why, delayMs: ms, incomplete, raw });
        asrPauseTimer = setTimeout(() => {
          asrPauseTimer = null;
          takeLog('pauseTimer fire', { why });
          if (!listening || session !== takeSessionId || endingTake || !pendingHeard) {
            takeLog('pauseTimer bail', {
              listening,
              sessionOk: session === takeSessionId,
              endingTake,
              pendingHeard,
            });
            return;
          }
          const h = pendingHeard ?? '';
          if (isIncompleteEeNamePrefix(h, curItem) && !sawIncompleteEeOnEnd) {
            scheduleAsrPauseEnd('still-incomplete');
            return;
          }
          if (pendingAsrPass && sawIncompleteEeOnEnd && letterNameIsKeyPlusEe(curItem)) {
            endTake('pause-ee-scored');
            return;
          }
          endTake('pause-default');
        }, ms);
      };

      recognition.onresult = (e: SpeechRecognitionEvent) => {
        if (session !== takeSessionId) {
          takeLog('onresult stale session');
          return;
        }
        if (endingTake) {
          takeLog('onresult ignored (endingTake)');
          return;
        }
        const eventText = fullTranscriptFromEvent(e);
        if (!eventText) return;
        const heard = mergeTakeTranscript(takeAsrAccum, eventText, curItem);
        takeAsrAccum = heard;
        const isFinal = eventHasFinalTranscript(e);

        // Chrome marks "b" before "ee"; after MIN_TAKE_MS treat as missed tail (not only isFinal).
        if (
          letterNameIsKeyPlusEe(curItem) &&
          isIncompleteEeNamePrefix(heard, curItem) &&
          Date.now() - takeStartedAt >= EE_TAIL_MIN_TAKE_MS
        ) {
          sawIncompleteEeOnEnd = true;
        }

        applyAsrTranscript(heard);
        if (!listening || endingTake) return;

        if (
          Date.now() - takeStartedAt >= MIN_TAKE_MS &&
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
        if (e.error === 'no-speech' || e.error === 'aborted') return;
        takeLog('onerror', { error: e.error });
      };
      recognition.onend = () => {
        const heardOnEnd = pendingHeard ?? '';
        takeLog('onend', { heardOnEnd });
        if (session !== takeSessionId) {
          takeLog('onend stale session');
          return;
        }
        if (endingTake || asrEnded || lockedEeTailAsr) {
          takeLog('onend bail (take finishing)', {
            endingTake,
            asrEnded,
            locked: lockedEeTailAsr?.heard,
          });
          if (endingTake) markAsrEnded();
          return;
        }
        if (!listening) {
          takeLog('onend bail (!listening)');
          return;
        }
        if (
          heardOnEnd &&
          !isIncompleteEeNamePrefix(heardOnEnd, curItem) &&
          Date.now() - takeStartedAt >= MIN_TAKE_MS &&
          transcriptMatchesItemForSessionEnd(curStageId, heardOnEnd, curItem)
        ) {
          takeLog('onend → endTake session match');
          clearAsrPauseTimer();
          endTake('onend-session-match');
          return;
        }
        if (isIncompleteEeNamePrefix(heardOnEnd, curItem)) {
          takeLog('onend incomplete → keep going');
          sawIncompleteEeOnEnd = true;
          clearAsrPauseTimer();
          applyAsrTranscript(heardOnEnd);
          $('btnLbl').textContent = `heard "${heardOnEnd}" — keep going…`;
        }
        if (asrRestartsThisTake < ASR_MAX_RESTARTS_PER_TAKE) {
          asrRestartsThisTake++;
          takeLog('onend → recognition.start() restart', { restart: asrRestartsThisTake });
          try {
            recognition.start();
            scheduleAsrPauseEnd('onend-restart');
            return;
          } catch (err) {
            takeLog('onend recognition.start() failed', { err: String(err) });
          }
        }
        if (pendingHeard && !asrPauseTimer) {
          scheduleAsrPauseEnd('onend-fallback');
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
