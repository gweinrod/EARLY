import * as tf from '@tensorflow/tfjs';
import { setWasmPaths } from '@tensorflow/tfjs-backend-wasm';
import '@tensorflow/tfjs-backend-wasm';
import type { CurriculumStageId } from './curriculum';
import { buildBootstrapDataset } from './bootstrap-embeddings';
import { EMBEDDING_DIM } from './dsp';
import { getVocabWords, setVocabularyStage, wordIndex } from './word-vocabulary';
import { isVoiceBankComplete } from './voice-bank';
import {
  fetchPublishedManifest,
  getStoredPublishedVersion,
  setStoredPublishedVersion,
  type PublishedModelManifest,
} from './published-model';

const INPUT_DIM = EMBEDDING_DIM; // 148

let model: tf.LayersModel | null = null;
let ready = false;
let trainingBusy = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let activeStage: CurriculumStageId = 'alphabet';
let wasmPathsConfigured = false;

function ensureWasmPaths(): void {
  if (wasmPathsConfigured) return;
  // Bundled JS lives under /assets/; .wasm must be served as static files (see public/tfjs-wasm/).
  setWasmPaths('/tfjs-wasm/');
  wasmPathsConfigured = true;
}

/**
 * v2 storage key — deliberately different from early-tf-${stageId} so that
 * stale models trained on the old 13-dim NMCC embedding are never loaded.
 */
function modelStorageUrl(stageId: CurriculumStageId): string {
  return `localstorage://early-tf-v2-${stageId}`;
}

export function isTfReady(): boolean {
  return ready && model !== null;
}

export function isTfPredictBusy(): boolean {
  return trainingBusy;
}

export function getActiveTfStage(): CurriculumStageId {
  return activeStage;
}

export type TfModelLoadSource =
  | 'published_fresh'
  | 'published_cached'
  | 'local'
  | 'bootstrap'
  | 'none';

export interface TfInitResult {
  source: TfModelLoadSource;
  publishedVersion: number | null;
  /** Published manifest is newer than this device loaded, but fetch/load failed. */
  publishLoadFailed?: boolean;
  availablePublishVersion?: number;
}

const noneResult = (): TfInitResult => ({ source: 'none', publishedVersion: null });

async function publishedCachedResult(stageId: CurriculumStageId): Promise<TfInitResult> {
  const manifest = await fetchPublishedManifest(stageId);
  const stored = getStoredPublishedVersion(stageId);
  if (manifest && stored >= manifest.version) {
    return { source: 'published_cached', publishedVersion: manifest.version };
  }
  return { source: 'local', publishedVersion: null };
}

export async function initTfPhonemeModel(stageId: CurriculumStageId): Promise<TfInitResult> {
  if (ready && activeStage === stageId && model) {
    return publishedCachedResult(stageId);
  }

  model?.dispose();
  model = null;
  ready = false;
  activeStage = stageId;

  setVocabularyStage(stageId);
  const vocabSize = getVocabWords().length;
  if (vocabSize === 0) return noneResult();

  ensureWasmPaths();
  await tf.setBackend('wasm');
  await tf.ready();

  const published = await tryLoadPublishedModel(stageId);
  if (published) {
    return { source: 'published_fresh', publishedVersion: published.version };
  }

  const url = modelStorageUrl(stageId);
  const manifestAfterPublish = await fetchPublishedManifest(stageId);
  try {
    model = await tf.loadLayersModel(url);
    if (!(await reconcileModelWithVocab(stageId))) {
      return noneResult();
    }
    const cached = await publishedCachedResult(stageId);
    if (
      cached.source === 'local' &&
      manifestAfterPublish &&
      getStoredPublishedVersion(stageId) < manifestAfterPublish.version
    ) {
      return {
        ...cached,
        publishLoadFailed: true,
        availablePublishVersion: manifestAfterPublish.version,
      };
    }
    return cached;
  } catch {
    /* no saved model for this stage */
  }

  if (isVoiceBankComplete(stageId)) {
    const bootstrapped = await runBootstrapTraining(stageId);
    if (!bootstrapped) {
      model = null;
      ready = false;
      return noneResult();
    }
    return { source: 'bootstrap', publishedVersion: null };
  }

  model = null;
  ready = false;
  return noneResult();
}

/**
 * Model architecture for the 148-dim landmark embedding.
 *
 * The input is ~10× larger than the old 13-dim nucleus MFCC so the first layer
 * is widened to 256 units to give the network enough capacity to learn separate
 * detectors for the onset/nucleus/coda regions before compressing.
 */
function createModel(numClasses: number): tf.LayersModel {
  const m = tf.sequential();
  m.add(
    tf.layers.dense({
      inputShape: [INPUT_DIM],
      units: 256,
      activation: 'relu',
      kernelInitializer: 'glorotUniform',
    }),
  );
  m.add(tf.layers.dropout({ rate: 0.25 }));
  m.add(tf.layers.dense({ units: 128, activation: 'relu' }));
  m.add(tf.layers.dropout({ rate: 0.15 }));
  m.add(tf.layers.dense({ units: 64, activation: 'relu' }));
  m.add(tf.layers.dense({ units: numClasses, activation: 'softmax' }));
  m.compile({
    optimizer: tf.train.adamax(0.002),
    loss: 'categoricalCrossentropy',
    metrics: ['accuracy'],
  });
  return m;
}

/** Published / imported models load without compile args; required before fit(). */
function ensureModelCompiled(): void {
  if (!model || model.optimizer != null) return;
  model.compile({
    optimizer: tf.train.adamax(0.002),
    loss: 'categoricalCrossentropy',
    metrics: ['accuracy'],
  });
}

function getModelClassCount(): number | null {
  if (!model) return null;
  const shape = model.outputs[0]?.shape;
  if (!shape?.length) return null;
  const n = shape[shape.length - 1];
  return typeof n === 'number' ? n : null;
}

function modelMatchesVocab(): boolean {
  const vocabSize = getVocabWords().length;
  if (!vocabSize) return false;
  const n = getModelClassCount();
  return n !== null && n === vocabSize;
}

function disposeCurrentModel(): void {
  model?.dispose();
  model = null;
  ready = false;
}

/** Drop stale checkpoints (wrong class count or wrong input dimension). */
async function reconcileModelWithVocab(stageId: CurriculumStageId): Promise<boolean> {
  if (!model) return false;
  if (modelMatchesVocab()) {
    ensureModelCompiled();
    ready = true;
    return true;
  }
  const classes = getModelClassCount();
  const vocabSize = getVocabWords().length;
  console.warn(`EARLY: model has ${classes} classes but vocab has ${vocabSize} — retraining`);
  disposeCurrentModel();
  if (isVoiceBankComplete(stageId)) {
    return runBootstrapTraining(stageId);
  }
  return false;
}

async function runBootstrapTraining(stageId: CurriculumStageId): Promise<boolean> {
  const dataset = buildBootstrapDataset(stageId, 4);
  if (!dataset) return false;

  if (!model) {
    model = createModel(getVocabWords().length);
  }
  trainingBusy = true;
  try {
    await fitBatch(dataset.x, dataset.y, 40, 16);
    await persistModel();
    ready = true;
    return true;
  } finally {
    trainingBusy = false;
  }
}

export async function deleteStoredModel(stageId: CurriculumStageId): Promise<void> {
  try {
    await tf.io.removeModel(modelStorageUrl(stageId));
  } catch {
    /* not saved yet */
  }
  if (activeStage === stageId) {
    model?.dispose();
    model = null;
    ready = false;
  }
}

/** Train from teacher voice bank and persist (after guided recording). */
export async function retrainFromVoiceBank(stageId: CurriculumStageId): Promise<boolean> {
  setVocabularyStage(stageId);
  const vocabSize = getVocabWords().length;
  if (vocabSize === 0) return false;

  ensureWasmPaths();
  await tf.setBackend('wasm');
  await tf.ready();

  const dataset = buildBootstrapDataset(stageId, 4);
  if (!dataset) return false;

  model?.dispose();
  model = createModel(vocabSize);
  activeStage = stageId;
  ready = false;
  trainingBusy = true;
  try {
    await fitBatch(dataset.x, dataset.y, 40, 16);
    await persistModel();
    ready = true;
    return true;
  } finally {
    trainingBusy = false;
  }
}

async function fitBatch(x: number[][], y: number[], epochs: number, batchSize: number): Promise<void> {
  if (!model || x.length === 0) return;
  if (!modelMatchesVocab()) return;
  ensureModelCompiled();
  const vocabSize = getVocabWords().length;
  const xs = tf.tensor2d(x);
  const ys = tf.oneHot(tf.tensor1d(y, 'int32'), vocabSize);
  try {
    await model.fit(xs, ys, { epochs, batchSize, shuffle: true, verbose: 0 });
  } catch (err) {
    console.warn('EARLY: model.fit failed', err);
  } finally {
    xs.dispose();
    ys.dispose();
  }
}

async function persistModel(): Promise<void> {
  if (!model) return;
  await model.save(modelStorageUrl(activeStage));
}

/** Shared model shipped with the app (trained from all teachers' cloud samples). */
async function tryLoadPublishedModel(
  stageId: CurriculumStageId,
): Promise<PublishedModelManifest | null> {
  const manifest = await fetchPublishedManifest(stageId);
  if (!manifest || manifest.version <= getStoredPublishedVersion(stageId)) return null;

  try {
    const loaded = await tf.loadLayersModel(manifest.modelUrl);
    model?.dispose();
    model = loaded;
    activeStage = stageId;
    if (!(await reconcileModelWithVocab(stageId))) {
      if (isVoiceBankComplete(stageId)) {
        const bootstrapped = await runBootstrapTraining(stageId);
        if (bootstrapped) {
          setStoredPublishedVersion(stageId, manifest.version);
          return manifest;
        }
      }
      model = null;
      ready = false;
      return null;
    }
    await model.save(modelStorageUrl(stageId));
    setStoredPublishedVersion(stageId, manifest.version);
    return manifest;
  } catch (err) {
    console.warn('EARLY: failed to load published model', manifest.modelUrl, err);
    return null;
  }
}

export async function checkForPublishedModelUpdate(
  stageId: CurriculumStageId,
): Promise<PublishedModelManifest | null> {
  const manifest = await fetchPublishedManifest(stageId);
  if (!manifest) return null;
  if (manifest.version <= getStoredPublishedVersion(stageId)) return null;
  return manifest;
}

export async function applyPublishedModelUpdate(stageId: CurriculumStageId): Promise<boolean> {
  model?.dispose();
  model = null;
  ready = false;
  return (await tryLoadPublishedModel(stageId)) !== null;
}

function schedulePersist(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void persistModel();
  }, 1500);
}

export interface TfWordPrediction {
  guessedWord: string;
  guessedKey: string;
  confidence: number;
  targetProbability: number;
  top3: { word: string; key: string; probability: number }[];
}

export function predictWordForTarget(embedding: number[], targetKey: string): TfWordPrediction | null {
  if (!model || !ready || trainingBusy || embedding.length !== INPUT_DIM) return null;

  try {
    const words = getVocabWords();
    const probs = tf.tidy(() => {
      const input = tf.tensor2d([embedding]);
      const out = model!.predict(input) as tf.Tensor;
      return Array.from(out.dataSync());
    });

    if (probs.some((p) => Number.isNaN(p))) return null;

    let topIdx = 0;
    for (let i = 1; i < probs.length; i++) if (probs[i] > probs[topIdx]) topIdx = i;

    const sorted = probs
      .map((p, i) => ({ word: words[i], key: words[i], probability: p }))
      .sort((a, b) => b.probability - a.probability);

    const ti = wordIndex(targetKey);

    return {
      guessedWord: words[topIdx],
      guessedKey: words[topIdx],
      confidence: probs[topIdx],
      targetProbability: ti !== undefined ? probs[ti] : 0,
      top3: sorted.slice(0, 3),
    };
  } catch {
    return null;
  }
}

export interface CalibrationTrainInput {
  embedding: number[];
  targetKey: string;
  teacherHeardKey: string | null;
  agrees: boolean;
  asrWrong: boolean;
  dspWrong: boolean;
}

export async function trainCalibrationSample(input: CalibrationTrainInput): Promise<void> {
  if (trainingBusy) return;
  if (!model || !modelMatchesVocab()) {
    const ok = await reconcileModelWithVocab(activeStage);
    if (!ok || !model) return;
  }

  trainingBusy = true;
  try {
    const { embedding, targetKey, teacherHeardKey, agrees, asrWrong, dspWrong } = input;

    if (teacherHeardKey) {
      const heardIdx = wordIndex(teacherHeardKey);
      if (heardIdx !== undefined) {
        await fitBatch([embedding], [heardIdx], 4, 1);
      }
    }

    if (agrees && !asrWrong) {
      const targetIdx = wordIndex(targetKey);
      if (targetIdx !== undefined && (!dspWrong || teacherHeardKey === targetKey)) {
        await fitBatch([embedding], [targetIdx], 4, 1);
      }
    }

    schedulePersist();
  } finally {
    trainingBusy = false;
  }
}