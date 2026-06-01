import { APP_VERSION } from './version';
import { getAuthUser } from './auth';
import { bootstrapAuth } from './auth-ui';
import {
  initCollectorPanel,
  promptTeacherJudgment,
  setCloudRefreshHandler,
  setJudgmentCompleteHandler,
} from './collector-ui';
import { applyTeacherToolsUi } from './teacher-ui';
import {
  type CurriculumItem,
  type CurriculumStageId,
  type CurriculumUnitId,
  getStage,
  getUnit,
  pickNextItemInOrder,
  pickPreviousItemInOrder,
  STAGE_PILL_LABEL,
  UNIT_NAV_VISIBLE,
  defaultStageForUnit,
  getStageIdsForUnit,
  getUnitForStage,
  isLetterWritingStage,
  wordPromptForUnitStage,
} from './curriculum';
import {
  hideLetterWritingPractice,
  initLetterWritingUi,
  setLetterWritingTarget,
  showLetterWritingPractice,
} from './letter-writing-ui';
import { setWritingStudentId } from './letter-writing-data';
import { refreshWritingSeedExportButtons } from './letter-writing-bank';
import { mountStageProgressPanel, showStageProgressSection } from './stage-progress';
import {
  getLetterWritingModelSource,
  isLetterWritingModelReady,
} from './letter-writing-tf';
import { fetchPublishedManifest, formatPublishedModelVersion } from './published-model';
import { isWritingBankComplete } from './letter-writing-bank';
import {
  initWritingJudgmentUi,
  promptWritingTeacherJudgment,
  setWritingJudgmentHandler,
} from './letter-writing-judgment-ui';
import {
  ensureWritingModelForPractice,
  initWritingBootstrapUi,
  isWritingBootstrapActive,
  startWritingBootstrap,
} from './writing-bootstrap-ui';
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
  flushWritingJudgmentQueue,
  refreshWritingJudgmentServerCount,
  subscribeWritingCloudSync,
} from './cloud-writing-judgments';
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
let refreshStageProgress: (stageId: CurriculumStageId) => void = () => {};
let audioCtx: AudioContext | null = null;
let recChunks: Blob[] = [];
let mediaRec: MediaRecorder | null = null;
let recStream: MediaStream | null = null;
let attemptFinalized = false;
let endingRecording = false;
let takeSessionId = 0;
let takeStartedAt = 0;
let maxTakeTimer: ReturnType<typeof setTimeout> | null = null;
let listening = false;
let mediaProcessInFlight = false;
/** End recording after speech pauses (post-speech tail). */
const RECORD_PAUSE_MS = 1400;
/** Hard cap per tap. */
const MAX_RECORD_MS = 4000;
/** Do not auto-end until the mic has been open this long. */
const MIN_RECORDING_MS = 600;
/** Analyser RMS above this counts as the student actually speaking. */
const SPEECH_RMS_THRESHOLD = 0.028;
let stopWave: (() => void) | null = null;
let speechCheckInterval: ReturnType<typeof setInterval> | null = null;
let speechDetectedThisTake = false;
let lastSpeechMs = 0;
let lastDsp: DspPrediction | null = null;
let lastLoggedAttemptId: string | null = null;

let correct = 0;
let total = 0;
const history: { w: string; h: string; pass: boolean }[] = [];

let curUnitId: CurriculumUnitId = settings.curriculumUnit;
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

function applyPracticeLayout(): void {
  if (isLetterWritingStage(curStageId)) {
    showLetterWritingPractice();
    setLetterWritingTarget(curItem);
  } else {
    hideLetterWritingPractice();
  }
}

function setTargetItem(item: CurriculumItem): void {
  curItem = item;
  if (isLetterWritingStage(curStageId)) {
    setLetterWritingTarget(item);
    return;
  }
  $('tWord').textContent = item.display;
  $('wordLabel').textContent = wordPromptForUnitStage(curUnitId, curStageId);
  const phon = $('tPhon');
  phon.textContent = '';
  phon.hidden = true;
  clearFB();
  hide('hmWrap');
  hide('pbWrap');
  hide('resultBanner');
}

function nextItem(): void {
  setTargetItem(pickNextItemInOrder(curStageId, curItem.key));
}

function previousItem(): void {
  setTargetItem(pickPreviousItemInOrder(curStageId, curItem.key));
}

function displayFeedback(items: DspPrediction['heuristicItems']): void {
  const shown = settings.teacherMode && !settings.showMlDebug ? toStudentFeedback(items) : items;
  for (const fb of shown) addFB(fb);
}

async function processAudio(): Promise<void> {
  if (mediaProcessInFlight || attemptFinalized) {
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
      displayFeedback([{ t: 'warn', s: 'Recording too short ? try again' }]);
      attemptFinalized = true;
      releaseMic();
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
    displayFeedback([{ t: 'warn', s: 'Could not decode audio' }]);
    lastDsp = null;
    attemptFinalized = true;
    releaseMic();
    mediaProcessInFlight = false;
    return;
  }

  mediaProcessInFlight = false;
  finishAttempt();
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
  endingRecording = false;
  speechDetectedThisTake = false;
  lastSpeechMs = 0;
  clearSpeechCheckInterval();
  if (maxTakeTimer) {
    clearTimeout(maxTakeTimer);
    maxTakeTimer = null;
  }
}

function clearSpeechCheckInterval(): void {
  if (speechCheckInterval) {
    clearInterval(speechCheckInterval);
    speechCheckInterval = null;
  }
}

function noteSpeechEnergy(an: AnalyserNode, session: number): void {
  const buf = new Uint8Array(an.fftSize);
  an.getByteTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) {
    const x = (buf[i] - 128) / 128;
    sum += x * x;
  }
  const rms = Math.sqrt(sum / buf.length);
  const now = Date.now();
  if (rms >= SPEECH_RMS_THRESHOLD) {
    speechDetectedThisTake = true;
    lastSpeechMs = now;
    return;
  }
  if (
    !listening ||
    session !== takeSessionId ||
    endingRecording ||
    !speechDetectedThisTake ||
    takeElapsedMs() < MIN_RECORDING_MS
  ) {
    return;
  }
  if (lastSpeechMs > 0 && now - lastSpeechMs >= RECORD_PAUSE_MS) {
    endRecording('silence');
  }
}

function takeElapsedMs(): number {
  return takeStartedAt ? Date.now() - takeStartedAt : 0;
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
  } catch {
    /* already stopped */
  }
}

function releaseMic(): void {
  if (recStream) {
    recStream.getTracks().forEach((t) => t.stop());
    recStream = null;
  }
  endingRecording = false;
}

/** Stop recording and run DSP when MediaRecorder finishes. */
function endRecording(_caller = 'unknown'): void {
  if (endingRecording || attemptFinalized) return;
  endingRecording = true;
  if (maxTakeTimer) {
    clearTimeout(maxTakeTimer);
    maxTakeTimer = null;
  }
  clearSpeechCheckInterval();
  resetListenUi();
  $('btnLbl').textContent = 'checking...';
  stopMediaRecorderNow();
  if (!mediaRec || mediaRec.state === 'inactive') {
    if (!attemptFinalized) void processAudio();
  }
}

function finishAttempt(): void {
  if (attemptFinalized) return;
  attemptFinalized = true;
  resetListenUi();
  releaseMic();
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
    { ...dsp, guessedKey: dsp.tf?.guessedKey },
    curItem.key,
    curStageId,
  );

  const heardDisplay = dsp.tf?.guessedKey ?? '?';

  total++;
  if (appPass) correct++;
  updateScores(correct, total);
  addHistory(curItem.display, heardDisplay, appPass, history);
  showResultBanner(appPass);

  const studentMsg = settings.teacherMode && !settings.showMlDebug
    ? acousticStudentMessage(appPass)
    : {
        t: appPass ? ('pass' as const) : ('fail' as const),
        s: `app ${appPass ? 'pass' : 'fail'} (${basis}) | DSP ${formatDspGuessForSummary(dsp)}`,
      };
  addFB(studentMsg, true);

  if (settings.teacherMode) {
    const meta = getSessionMeta();
    const attempt = logAttempt({
      studentId: meta.studentId,
      group: getStage(curStageId).label,
      word: curItem.display,
      targetKey: curItem.key,
      heard: '',
      asrPass: false,
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
    refreshStageProgress(curStageId);
    promptTeacherJudgment(attempt, curStageId);
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

  if (settings.teacherMode && !settings.showMlDebug) {
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
  refreshStageProgress(curStageId);
  refreshLocalTrainingStatus(curStageId);
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
    setModelLoadStatus(
      `Shared classroom model loaded (v${formatPublishedModelVersion(load.publishedVersion)})`,
      'ok',
    );
    return;
  }
  if (load.source === 'published_cached' && load.publishedVersion != null) {
    setModelLoadStatus(
      `Shared classroom model (v${formatPublishedModelVersion(load.publishedVersion)})`,
      'ok',
    );
    return;
  }
  if (load.source === 'bootstrap') {
    setModelLoadStatus('Local model (teacher voice seed)', 'neutral');
    return;
  }
  setModelLoadStatus('Local neural model', 'neutral');
}

async function prepareStage(stageId: CurriculumStageId): Promise<void> {
  applyPracticeLayout();
  applyTeacherToolsUi(settings, stageId);

  if (isLetterWritingStage(stageId)) {
    setTargetItem(getStage(stageId).items[0] ?? curItem);
    void refreshWritingJudgmentServerCount().then(() => refreshCloudStats(stageId, 0));
    refreshLocalTrainingStatus(stageId);
    refreshStageProgress(stageId);

    const publishedManifest = await fetchPublishedManifest('letter-writing');
    if (settings.teacherMode && !isWritingBankComplete() && !publishedManifest) {
      await startWritingBootstrap();
      return;
    }

    await ensureWritingModelForPractice();

    // Stale published model (e.g. older vocab/class count) — kick collectors
    // back into bootstrap so they can re-record the missing letters.
    if (
      settings.teacherMode &&
      publishedManifest &&
      !isLetterWritingModelReady() &&
      !isWritingBankComplete()
    ) {
      await startWritingBootstrap();
      return;
    }

    const src = getLetterWritingModelSource();
    if (isLetterWritingModelReady()) {
      if (src === 'published' && publishedManifest) {
        setModelLoadStatus(
          `Shared letter-writing model (v${formatPublishedModelVersion(publishedManifest.version)})`,
          'ok',
        );
      } else if (src === 'bootstrap') {
        setModelLoadStatus('Local writing model (teacher seed)', 'neutral');
      } else {
        setModelLoadStatus('Local letter-writing model', 'neutral');
      }
    } else if (publishedManifest) {
      setModelLoadStatus('Could not load shared letter-writing model ? using heuristics', 'warn');
    } else {
      setModelLoadStatus(
        settings.teacherMode
          ? 'Writing model not ready ? record teacher writing seed'
          : 'Letter writing (model loading)',
        'warn',
      );
    }
    return;
  }

  resetMelFilterbank();
  setModelLoadStatus('Loading classroom model...', 'neutral');
  $('netTxt').textContent = 'Loading classroom model...';
  const load = await ensureDspEngine(stageId);

  setTargetItem(getStage(stageId).items[0] ?? curItem);
  applyModelLoadStatus(load);

  void refreshCloudStats(stageId, getVoiceBankQueueLength());
  refreshLocalTrainingStatus(stageId);
  refreshStageProgress(stageId);
}

async function switchStage(stageId: CurriculumStageId): Promise<void> {
  curStageId = stageId;
  curUnitId = getUnitForStage(stageId);
  settings.curriculumUnit = curUnitId;
  settings.curriculumStage = stageId;
  saveSettings(settings);
  renderStagePills();
  await prepareStage(stageId);
}

function onWritingBootstrapComplete(): void {
  void prepareStage(curStageId);
}

function onVoiceBootstrapComplete(): void {
  void (async () => {
    await ensureDspEngine(curStageId);
    if (settings.teacherMode) {
      await syncLocalVoiceBankToCloud(curStageId);
    }
    await prepareStage(curStageId);
  })();
}

async function toggleRec(): Promise<void> {
  if (isLetterWritingStage(curStageId)) return;
  if (listening) {
    endRecording('manual-toggle');
    return;
  }

  const session = ++takeSessionId;
  resetTakeState();

  const ctx = getAudioContext();
  if (ctx.state === 'suspended') await ctx.resume();

  try {
    recChunks = [];

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    recStream = stream;
    const src = ctx.createMediaStreamSource(stream);
    const an = ctx.createAnalyser();
    an.fftSize = 2048;
    src.connect(an);

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
    clearSpeechCheckInterval();
    speechCheckInterval = setInterval(() => {
      if (!listening || session !== takeSessionId) {
        clearSpeechCheckInterval();
        return;
      }
      noteSpeechEnergy(an, session);
    }, 50);

    maxTakeTimer = setTimeout(() => {
      maxTakeTimer = null;
      if (!listening || session !== takeSessionId) return;
      endRecording('max-record');
    }, MAX_RECORD_MS);

    if (mediaRec.state === 'inactive') {
      mediaRec.start(100);
    }
  } catch (e) {
    resetListenUi();
    releaseMic();
    showErr(`Mic denied ? ${e instanceof Error ? e.message : String(e)}`);
  }
}

function updateStageSectionLabel(): void {
  $('stageSectionLabel').textContent = getUnit(curUnitId).stageSectionLabel;
}

function renderStagePills(): void {
  const container = $('pillGroup');
  container.innerHTML = '';
  updateStageSectionLabel();

  for (const stageId of getStageIdsForUnit(curUnitId)) {
    const stage = getStage(stageId);
    if (!stage.items.length) continue;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pill' + (stageId === curStageId ? ' on' : '');
    btn.textContent = STAGE_PILL_LABEL[stageId];
    btn.addEventListener('click', () => {
      container.querySelectorAll('.pill').forEach((p) => p.classList.remove('on'));
      btn.classList.add('on');
      void switchStage(stageId);
    });
    container.appendChild(btn);
  }
}

function initUnitPills(): void {
  const container = $('unitPillGroup');
  container.innerHTML = '';
  for (const unitId of UNIT_NAV_VISIBLE) {
    const unit = getUnit(unitId);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pill' + (unitId === curUnitId ? ' on' : '');
    btn.textContent = unit.pillLabel;
    btn.addEventListener('click', () => {
      container.querySelectorAll('.pill').forEach((p) => p.classList.remove('on'));
      btn.classList.add('on');
      void switchUnit(unitId);
    });
    container.appendChild(btn);
  }
}

async function switchUnit(unitId: CurriculumUnitId): Promise<void> {
  const stageId = defaultStageForUnit(unitId);
  curUnitId = unitId;
  curStageId = stageId;
  settings.curriculumUnit = unitId;
  settings.curriculumStage = stageId;
  saveSettings(settings);
  updateStageSectionLabel();
  renderStagePills();
  await prepareStage(stageId);
}

function applySettingsUi(): void {
  applySettingsToDocument(settings);
  const debugToggle = $('debugMode') as HTMLInputElement;
  debugToggle.checked = settings.showMlDebug;
  const teacherToggle = $('teacherMode') as HTMLInputElement;
  teacherToggle.checked = settings.teacherMode;
  const legacyToggles = $('legacyToggles');
  if (curStageId === 'legacy-cvc') show('legacyToggles');
  else hide('legacyToggles');

  show('collectorPanel');
  applyTeacherToolsUi(settings, curStageId);
  showStageProgressSection(settings.teacherMode);
  hide('netBadge');
  refreshWritingSeedExportButtons();
  if (settings.teacherMode) {
    refreshLocalTrainingStatus(curStageId);
    refreshStageProgress(curStageId);
  }
}

function init(): void {
  $('appTitle').textContent = 'EARLY';
  $('appVersion').textContent = `v${APP_VERSION}`;

  settings = loadSettings();
  curUnitId = settings.curriculumUnit;
  curStageId = settings.curriculumStage;
  applySettingsUi();
  initUnitPills();
  renderStagePills();

  const authUser = getAuthUser();
  if (authUser) {
    setStudentId(authUser.userId);
    setWritingStudentId(authUser.userId);
  }

  initCollectorPanel();
  if (settings.teacherMode) {
    setJudgmentCompleteHandler((j) => {
      if (j.agrees) applyTeacherAcceptAsPass(j.teacherHeard);
      void onTeacherJudgment(j);
    });
    setCloudRefreshHandler(() => {
      void refreshCloudStats(curStageId, getVoiceBankQueueLength(), { force: true }).then(
        () => refreshStageProgress(curStageId),
      );
    });
  }

  subscribeCloudSync((s) => {
      $('cloudSyncStatus').textContent = formatCloudSyncLine(s, curStageId);
      refreshLocalTrainingStatus(curStageId);
    });
    subscribeWritingCloudSync(() => {
      if (!isLetterWritingStage(curStageId)) return;
      $('cloudSyncStatus').textContent = formatCloudSyncLine(
        {
          enabled: false,
          pending: 0,
          serverTotal: null,
          voiceBankTotal: null,
          voicePending: 0,
          lastUploadAt: null,
          lastError: null,
        },
        curStageId,
      );
      refreshLocalTrainingStatus(curStageId);
    });
    refreshLocalTrainingStatus(curStageId);
    void flushCloudQueue()
      .then(() => flushVoiceBankQueue())
      .then(() => flushWritingJudgmentQueue())
      .then(async () => {
        if (
          settings.teacherMode &&
          !isLetterWritingStage(curStageId) &&
          isVoiceBankComplete(curStageId)
        ) {
          await syncLocalVoiceBankToCloud(curStageId);
        }
        await refreshWritingJudgmentServerCount();
        await refreshCloudStats(curStageId, getVoiceBankQueueLength(), { force: true });
        refreshStageProgress(curStageId);
      });

  $('teacherMode').addEventListener('change', (e) => {
    settings.teacherMode = (e.target as HTMLInputElement).checked;
    saveSettings(settings);
    applySettingsUi();
  });

  initVoiceBootstrapUi({
    getAudioContext,
    getStageId: () => curStageId,
    onComplete: onVoiceBootstrapComplete,
  });
  initWritingBootstrapUi({ onComplete: onWritingBootstrapComplete });
  initWritingJudgmentUi();
  setWritingJudgmentHandler(() => {
    refreshStageProgress(curStageId);
    refreshLocalTrainingStatus(curStageId);
  });
  const { refresh: refreshStageProgressFn } = mountStageProgressPanel(
    $('stageProgressPanel') as HTMLElement,
  );
  refreshStageProgress = refreshStageProgressFn;
  initLetterWritingUi({
    onAttemptLogged(attempt) {
      refreshStageProgress(curStageId);
      if (settings.teacherMode) {
        promptWritingTeacherJudgment(attempt);
      }
    },
  });

  $('btnRec').addEventListener('click', () => {
    if (isVoiceBootstrapActive() || isWritingBootstrapActive()) return;
    void toggleRec();
  });
  $('btnNext').addEventListener('click', () => {
    if (isVoiceBootstrapActive() || isWritingBootstrapActive()) return;
    nextItem();
  });
  $('btnPrev').addEventListener('click', () => {
    if (isVoiceBootstrapActive() || isWritingBootstrapActive()) return;
    previousItem();
  });
  $('btnPrevWriting').addEventListener('click', () => {
    if (isVoiceBootstrapActive() || isWritingBootstrapActive()) return;
    previousItem();
  });
  $('btnNextWriting').addEventListener('click', () => {
    if (isVoiceBootstrapActive() || isWritingBootstrapActive()) return;
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

void bootstrapAuth().then(() => init());
