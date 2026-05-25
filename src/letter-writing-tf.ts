import * as tf from '@tensorflow/tfjs';
import { setWasmPaths } from '@tensorflow/tfjs-backend-wasm';
import '@tensorflow/tfjs-backend-wasm';
import '@tensorflow/tfjs-backend-webgl';
import type { Stroke } from './letter-writing-data';
import {
  fetchPublishedManifest,
  getStoredPublishedVersion,
  setStoredPublishedVersion,
  type PublishedModelManifest,
} from './published-model';
import {
  getWritingBankSamples,
  isWritingBankComplete,
  WRITING_BANK_LETTERS,
} from './letter-writing-bank';
import { RASTER_SIZE, rasterizeStrokes } from './letter-writing-raster';

const LOCAL_MODEL_URL = 'localstorage://early-letter-writing-v2';
const LEGACY_LOCAL_MODEL_URL = 'localstorage://early-letter-writing-v1';
const STAGE_ID = 'letter-writing' as const;
const NUM_CLASSES = 52;
const ML_PASS_THRESHOLD = 0.45;

let model: tf.LayersModel | null = null;
let ready = false;
let trainingBusy = false;
let wasmConfigured = false;

export type LetterWritingModelSource = 'published' | 'local' | 'bootstrap' | 'none';

let modelSource: LetterWritingModelSource = 'none';

function ensureWasm(): void {
  if (wasmConfigured) return;
  setWasmPaths('/tfjs-wasm/');
  wasmConfigured = true;
}

/**
 * Map a letter to its class index (case-sensitive).
 *   A–Z → 0..25
 *   a–z → 26..51
 */
function letterToIndex(letter: string): number {
  const ch = letter.charAt(0);
  const code = ch.charCodeAt(0);
  if (code >= 65 && code <= 90) return code - 65;
  if (code >= 97 && code <= 122) return 26 + (code - 97);
  return -1;
}

function indexToLetter(index: number): string {
  if (index < 0 || index > 51) return '?';
  if (index < 26) return String.fromCharCode(65 + index);
  return String.fromCharCode(97 + (index - 26));
}

function createModel(): tf.LayersModel {
  const m = tf.sequential();
  m.add(
    tf.layers.conv2d({
      inputShape: [RASTER_SIZE, RASTER_SIZE, 1],
      filters: 16,
      kernelSize: 3,
      activation: 'relu',
      padding: 'same',
    }),
  );
  m.add(tf.layers.maxPooling2d({ poolSize: 2 }));
  m.add(tf.layers.conv2d({ filters: 32, kernelSize: 3, activation: 'relu', padding: 'same' }));
  m.add(tf.layers.maxPooling2d({ poolSize: 2 }));
  m.add(tf.layers.conv2d({ filters: 48, kernelSize: 3, activation: 'relu', padding: 'same' }));
  m.add(tf.layers.maxPooling2d({ poolSize: 2 }));
  m.add(tf.layers.flatten());
  m.add(tf.layers.dense({ units: 96, activation: 'relu' }));
  m.add(tf.layers.dropout({ rate: 0.3 }));
  m.add(tf.layers.dense({ units: NUM_CLASSES, activation: 'softmax' }));
  m.compile({
    optimizer: tf.train.adamax(0.001),
    loss: 'categoricalCrossentropy',
    metrics: ['accuracy'],
  });
  return m;
}

function ensureCompiled(): void {
  if (!model || model.optimizer != null) return;
  model.compile({
    optimizer: tf.train.adamax(0.001),
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
  return getModelClassCount() === NUM_CLASSES;
}

function rasterToTensor(flat: Float32Array): tf.Tensor4D {
  return tf.tensor4d(flat, [1, RASTER_SIZE, RASTER_SIZE, 1]);
}

async function persistLocalModel(): Promise<void> {
  if (!model) return;
  await model.save(LOCAL_MODEL_URL);
}

async function isPublishedModelActive(): Promise<boolean> {
  const manifest = await fetchPublishedManifest(STAGE_ID);
  if (!manifest) return false;
  return getStoredPublishedVersion(STAGE_ID) >= manifest.version;
}

async function tryLoadPublishedModel(): Promise<PublishedModelManifest | null> {
  const manifest = await fetchPublishedManifest(STAGE_ID);
  if (!manifest) return null;
  const stored = getStoredPublishedVersion(STAGE_ID);
  if (manifest.version < stored) return null;

  try {
    const loaded = await tf.loadLayersModel(manifest.modelUrl);
    model?.dispose();
    model = loaded;
    const classCount = getModelClassCount();
    if (!modelMatchesVocab()) {
      console.warn(
        `EARLY: published letter-writing model has ${classCount} classes, expected ${NUM_CLASSES}. Falling back.`,
      );
      model.dispose();
      model = null;
      ready = false;
      return null;
    }
    ensureCompiled();
    try {
      await model.save(LOCAL_MODEL_URL);
    } catch (err) {
      console.warn('EARLY: failed to cache published letter-writing model locally', err);
    }
    setStoredPublishedVersion(STAGE_ID, manifest.version);
    ready = true;
    modelSource = 'published';
    return manifest;
  } catch (err) {
    console.warn('EARLY: failed to load published letter-writing model', manifest.modelUrl, err);
    return null;
  }
}

export async function hasPublishedLetterWritingModel(): Promise<boolean> {
  const manifest = await fetchPublishedManifest(STAGE_ID);
  return manifest !== null;
}

/**
 * Run a thunk on a backend that supports conv2d backprop (WebGL preferred,
 * CPU fallback) and restore the previous backend afterwards. Inference stays
 * on WASM for speed; CPU is a last resort because pure-JS conv backprop
 * blocks the main thread for many seconds on a 64x64 raster.
 */
async function trySetBackend(name: string): Promise<boolean> {
  try {
    const ok = await tf.setBackend(name);
    if (ok) await tf.ready();
    return Boolean(ok);
  } catch {
    return false;
  }
}

async function withTrainingBackend<T>(fn: () => Promise<T>): Promise<T> {
  const previous = tf.getBackend();
  const switched = (await trySetBackend('webgl')) || (await trySetBackend('cpu'));
  try {
    return await fn();
  } finally {
    if (switched && previous && previous !== tf.getBackend()) {
      await tf.setBackend(previous);
      await tf.ready();
    }
  }
}

async function fitRasters(
  flats: Float32Array[],
  labels: number[],
  epochs: number,
  batchSize: number,
): Promise<void> {
  if (!model || flats.length === 0 || (await isPublishedModelActive())) return;
  ensureCompiled();
  await withTrainingBackend(async () => {
    const xs = tf.stack(flats.map((f) => tf.tensor3d(f, [RASTER_SIZE, RASTER_SIZE, 1])));
    const ys = tf.oneHot(tf.tensor1d(labels, 'int32'), NUM_CLASSES);
    try {
      await model!.fit(xs, ys, { epochs, batchSize, shuffle: true, verbose: 0 });
    } finally {
      xs.dispose();
      ys.dispose();
    }
  });
}

function buildBootstrapBatch(): { flats: Float32Array[]; labels: number[] } | null {
  const flats: Float32Array[] = [];
  const labels: number[] = [];
  for (const letter of WRITING_BANK_LETTERS) {
    const idx = letterToIndex(letter);
    if (idx < 0) continue;
    const sets = getWritingBankSamples(letter);
    if (!sets.length) return null;
    for (const strokes of sets) {
      const flat = rasterizeStrokes(strokes);
      for (let r = 0; r < 4; r++) {
        flats.push(flat);
        labels.push(idx);
      }
    }
  }
  return flats.length ? { flats, labels } : null;
}

async function runBootstrapTraining(): Promise<boolean> {
  if (await isPublishedModelActive()) return false;
  const batch = buildBootstrapBatch();
  if (!batch) return false;
  model?.dispose();
  model = createModel();
  trainingBusy = true;
  try {
    await fitRasters(batch.flats, batch.labels, 35, 16);
    await persistLocalModel();
    ready = true;
    modelSource = 'bootstrap';
    return true;
  } catch (err) {
    console.warn('EARLY: letter-writing bootstrap failed', err);
    return false;
  } finally {
    trainingBusy = false;
  }
}

export function isLetterWritingModelReady(): boolean {
  return ready && model !== null;
}

export function getLetterWritingModelSource(): LetterWritingModelSource {
  return modelSource;
}

export async function initLetterWritingModel(): Promise<LetterWritingModelSource> {
  if (ready && model) return modelSource;

  ensureWasm();
  await tf.setBackend('wasm');
  await tf.ready();

  model?.dispose();
  model = null;
  ready = false;

  const published = await tryLoadPublishedModel();
  if (published) return 'published';

  // Clear any legacy 26-class model so it doesn't keep tripping the loader.
  try {
    await tf.io.removeModel(LEGACY_LOCAL_MODEL_URL);
  } catch {
    /* not saved */
  }

  try {
    model = await tf.loadLayersModel(LOCAL_MODEL_URL);
    if (modelMatchesVocab()) {
      ensureCompiled();
      ready = true;
      modelSource = 'local';
      return 'local';
    }
    model.dispose();
    model = null;
  } catch {
    /* no saved model */
  }

  // Skip the expensive on-device bootstrap if a published manifest exists
  // (even if its load failed this time) — that path can block the main thread
  // for a long time on slow backends, and the published model will succeed on
  // the next page load once the deploy / cache settles.
  const manifest = await fetchPublishedManifest(STAGE_ID);
  if (!manifest && isWritingBankComplete()) {
    const ok = await runBootstrapTraining();
    return ok ? 'bootstrap' : 'none';
  }

  modelSource = 'none';
  return 'none';
}

export async function retrainFromWritingBank(): Promise<boolean> {
  if (await isPublishedModelActive()) return false;
  if (!isWritingBankComplete()) return false;
  return runBootstrapTraining();
}

export async function deleteLetterWritingModel(): Promise<void> {
  for (const url of [LOCAL_MODEL_URL, LEGACY_LOCAL_MODEL_URL]) {
    try {
      await tf.io.removeModel(url);
    } catch {
      /* not saved */
    }
  }
  model?.dispose();
  model = null;
  ready = false;
  modelSource = 'none';
}

export interface LetterWritingPrediction {
  guessedLetter: string;
  confidence: number;
  targetProbability: number;
  pass: boolean;
  top3: { letter: string; probability: number }[];
}

export function predictLetterWriting(
  strokes: Stroke[],
  targetLetter: string,
): LetterWritingPrediction | null {
  if (!model || !ready || trainingBusy) return null;
  const targetIdx = letterToIndex(targetLetter);
  if (targetIdx < 0) return null;

  const flat = rasterizeStrokes(strokes);
  try {
    const probs = tf.tidy(() => {
      const input = rasterToTensor(flat);
      const out = model!.predict(input) as tf.Tensor;
      return Array.from(out.dataSync());
    });
    if (probs.some((p) => Number.isNaN(p))) return null;

    let topIdx = 0;
    for (let i = 1; i < probs.length; i++) {
      if (probs[i] > probs[topIdx]) topIdx = i;
    }

    const sorted = probs
      .map((p, i) => ({ letter: indexToLetter(i), probability: p }))
      .sort((a, b) => b.probability - a.probability);

    const targetProbability = probs[targetIdx];
    const guessedLetter = indexToLetter(topIdx);
    const pass = topIdx === targetIdx && targetProbability >= ML_PASS_THRESHOLD;

    return {
      guessedLetter,
      confidence: probs[topIdx],
      targetProbability,
      pass,
      top3: sorted.slice(0, 3),
    };
  } catch {
    return null;
  }
}

/**
 * On-device fit from teacher judgment.
 *
 * Strictly limited to attempts the teacher explicitly accepted (teacherPass === true).
 * Model self-accepts, heuristic passes, and teacher rejections all return early —
 * they MUST NOT feed back into the learning model. Also skipped when the shared
 * published model is active (retraining happens in the Python pipeline instead).
 */
export async function trainWritingJudgment(
  strokes: Stroke[],
  targetLetter: string,
  teacherPass: boolean,
): Promise<void> {
  if (teacherPass !== true) return;
  if (trainingBusy || !model || !ready) return;
  if (await isPublishedModelActive()) return;
  const idx = letterToIndex(targetLetter);
  if (idx < 0) return;

  const flat = rasterizeStrokes(strokes);
  trainingBusy = true;
  try {
    await fitRasters([flat], [idx], 3, 1);
    await persistLocalModel();
    modelSource = 'local';
  } finally {
    trainingBusy = false;
  }
}
