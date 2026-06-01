import type { CurriculumItem, CurriculumStageId } from './curriculum';
import { getStage } from './curriculum';
import { embeddingFromRecording, silenceEmbeddingFromRecording } from './audio-embedding';
import { SILENCE_VOCAB_KEY } from './word-vocabulary';
import {
  addVoiceSample,
  clearVoiceBank,
  countRecorded,
  isVoiceBankComplete,
  loadVoiceBank,
} from './voice-bank';
import { clearSyncedVoiceBank, uploadVoiceBankSample } from './cloud-voice-bank';
import { refreshLocalTrainingStatus } from './local-training-stats';
import { deleteStoredModel, retrainFromVoiceBank } from './tf-phoneme';
import { createMediaRecorder } from './recorder';
import { $, hide, show } from './ui';

let active = false;
let stageId: CurriculumStageId = 'alphabet';
let itemIndex = 0;
let recChunks: Blob[] = [];
let mediaRec: MediaRecorder | null = null;
let recStream: MediaStream | null = null;
let listening = false;

let getAudioContext: () => AudioContext;
let getStageId: () => CurriculumStageId = () => 'alphabet';
let onComplete: (() => void) | null = null;

export function isVoiceBootstrapActive(): boolean {
  return active;
}

export function initVoiceBootstrapUi(deps: {
  getAudioContext: () => AudioContext;
  getStageId: () => CurriculumStageId;
  onComplete: () => void;
}): void {
  getAudioContext = deps.getAudioContext;
  getStageId = deps.getStageId;
  onComplete = deps.onComplete;

  $('btnBootstrapRec').addEventListener('click', () => {
    void toggleBootstrapRec();
  });
  $('btnRedoVoiceBank').addEventListener('click', () => {
    if (
      !confirm(
        'Record the teacher voice seed again? This replaces your local seed for this stage (students use judgments only).',
      )
    ) {
      return;
    }
    void startVoiceBootstrap(getStageId(), true);
  });
}

export async function startVoiceBootstrap(
  forStage: CurriculumStageId,
  forceReset = false,
): Promise<void> {
  stageId = forStage;
  if (forceReset) {
    clearVoiceBank(stageId);
    clearSyncedVoiceBank(stageId);
    await deleteStoredModel(stageId);
  }

  const items = getStage(stageId).items;
  if (!items.length) return;

  if (!forceReset && isVoiceBankComplete(stageId)) {
    hideBootstrap();
    return;
  }

  itemIndex = firstMissingIndex();
  active = true;
  show('voiceBootstrap');
  hide('practiceMain');
  updateBootstrapUi();
}

export function hideBootstrap(): void {
  active = false;
  hide('voiceBootstrap');
  show('practiceMain');
  stopBootstrapRec();
}

type BootstrapStep = CurriculumItem & { key: string };

function bootstrapSteps(): BootstrapStep[] {
  const items = getStage(stageId).items;
  return [
    ...items,
    {
      key: SILENCE_VOCAB_KEY,
      display: 'Quiet',
      spokenName: 'silence — stay quiet ~1 second',
      phonemeNote: 'Room noise only — maps DSP to "" (no speech).',
      aliases: [],
    },
  ];
}

function firstMissingIndex(): number {
  const bank = loadVoiceBank(stageId);
  const idx = bootstrapSteps().findIndex((it) => !(bank.samples[it.key]?.length));
  return idx >= 0 ? idx : 0;
}

function currentItem(): BootstrapStep {
  return bootstrapSteps()[itemIndex];
}

function updateBootstrapUi(): void {
  const { done, total } = countRecorded(stageId);
  $('bootstrapProgress').textContent = `${done} / ${total} recorded for this stage`;
  const item = currentItem();
  $('bootstrapTarget').textContent = `${item.display} — say: ${item.spokenName}`;
  const isSilence = item.key === SILENCE_VOCAB_KEY;
  $('bootstrapStatus').textContent =
    done === total
      ? 'All items recorded. Training neural net…'
      : isSilence
        ? 'Stay quiet — tap record, wait ~1s, tap again to stop.'
        : 'Say the prompt clearly, then tap record again to stop.';
}

async function toggleBootstrapRec(): Promise<void> {
  if (listening) {
    stopBootstrapRec();
    return;
  }

  const ctx = getAudioContext();
  if (ctx.state === 'suspended') await ctx.resume();

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    recStream = stream;

    recChunks = [];
    mediaRec = createMediaRecorder(stream);
    mediaRec.ondataavailable = (e) => {
      if (e.data.size > 0) recChunks.push(e.data);
    };
    mediaRec.onstop = () => {
      void onBootstrapRecorded();
    };
    mediaRec.start(100);

    listening = true;
    $('btnBootstrapRec').classList.add('on');
    $('btnBootstrapLbl').textContent = 'listening… tap to stop';
    $('bootstrapStatus').textContent = 'Listening…';
  } catch (e) {
    $('bootstrapStatus').textContent = `Mic error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

function stopBootstrapRec(): void {
  if (!listening) return;
  listening = false;
  if (mediaRec && mediaRec.state !== 'inactive') mediaRec.stop();
  if (recStream) recStream.getTracks().forEach((t) => t.stop());
  recStream = null;
  mediaRec = null;
  $('btnBootstrapRec').classList.remove('on');
  $('btnBootstrapLbl').textContent = 'tap to record';
}

async function onBootstrapRecorded(): Promise<void> {
  const ctx = getAudioContext();
  const item = currentItem();
  const isSilence = item.key === SILENCE_VOCAB_KEY;
  const result = isSilence
    ? await silenceEmbeddingFromRecording(ctx, recChunks)
    : await embeddingFromRecording(ctx, recChunks);
  recChunks = [];

  if (!result) {
    $('bootstrapStatus').textContent = isSilence
      ? 'Too short — stay quiet a bit longer, then try again.'
      : 'Too short or quiet — try again, speak a bit longer.';
    return;
  }

  addVoiceSample(stageId, item.key, result.embedding);
  void uploadVoiceBankSample({
    stageId,
    targetKey: item.key,
    embedding: result.embedding,
  });
  refreshLocalTrainingStatus(stageId);
  $('bootstrapStatus').textContent =
    item.key === SILENCE_VOCAB_KEY
      ? 'Saved silence (no speech) — syncing to cloud.'
      : `Saved ${item.display} (${item.spokenName}) — syncing to cloud.`;

  if (!isVoiceBankComplete(stageId)) {
    itemIndex = firstMissingIndex();
    updateBootstrapUi();
    return;
  }

  $('bootstrapStatus').textContent = 'Training on your voice recordings…';
  const ok = await retrainFromVoiceBank(stageId);
  $('bootstrapStatus').textContent = ok
    ? 'Done — your voice model is ready.'
    : 'Training failed — try “re-record voice model”.';
  if (!ok) return;

  setTimeout(() => {
    hideBootstrap();
    onComplete?.();
  }, 800);
}
