import * as tf from '@tensorflow/tfjs';
import { setWasmPaths } from '@tensorflow/tfjs-backend-wasm';
import '@tensorflow/tfjs-backend-wasm';
import type { Stroke } from './letter-writing-data';
import {
  getWritingBankSamples,
  isWritingBankComplete,
  WRITING_BANK_LETTERS,
} from './letter-writing-bank';
import { RASTER_SIZE, rasterizeStrokes } from './letter-writing-raster';

const MODEL_URL = 'localstorage://early-letter-writing-v1';
const NUM_CLASSES = 26;
const ML_PASS_THRESHOLD = 0.45;

let model: tf.LayersModel | null = null;
let ready = false;
let trainingBusy = false;
let wasmConfigured = false;

export type LetterWritingModelSource = 'bootstrap' | 'local' | 'none';

let modelSource: LetterWritingModelSource = 'none';

function ensureWasm(): void {
  if (wasmConfigured) return;
  setWasmPaths('/tfjs-wasm/');
  wasmConfigured = true;
}

function letterToIndex(letter: string): number {
  const code = letter.toUpperCase().charCodeAt(0);
  if (code < 65 || code > 90) return -1;
  return code - 65;
}

function indexToLetter(index: number): string {
  return String.fromCharCode(65 + index);
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

function rasterToTensor(flat: Float32Array): tf.Tensor4D {
  return tf.tensor4d(flat, [1, RASTER_SIZE, RASTER_SIZE, 1]);
}

async function fitRasters(
  flats: Float32Array[],
  labels: number[],
  epochs: number,
  batchSize: number,
): Promise<void> {
  if (!model || flats.length === 0) return;
  ensureCompiled();
  const xs = tf.stack(flats.map((f) => tf.tensor3d(f, [RASTER_SIZE, RASTER_SIZE, 1])));
  const ys = tf.oneHot(tf.tensor1d(labels, 'int32'), NUM_CLASSES);
  try {
    await model.fit(xs, ys, { epochs, batchSize, shuffle: true, verbose: 0 });
  } finally {
    xs.dispose();
    ys.dispose();
  }
}

async function persistModel(): Promise<void> {
  if (!model) return;
  await model.save(MODEL_URL);
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
  const batch = buildBootstrapBatch();
  if (!batch) return false;
  model?.dispose();
  model = createModel();
  trainingBusy = true;
  try {
    await fitRasters(batch.flats, batch.labels, 35, 16);
    await persistModel();
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

  try {
    model = await tf.loadLayersModel(MODEL_URL);
    ensureCompiled();
    ready = true;
    modelSource = 'local';
    return 'local';
  } catch {
    /* no saved model */
  }

  if (isWritingBankComplete()) {
    const ok = await runBootstrapTraining();
    return ok ? 'bootstrap' : 'none';
  }

  modelSource = 'none';
  return 'none';
}

export async function retrainFromWritingBank(): Promise<boolean> {
  if (!isWritingBankComplete()) return false;
  return runBootstrapTraining();
}

export async function deleteLetterWritingModel(): Promise<void> {
  try {
    await tf.io.removeModel(MODEL_URL);
  } catch {
    /* not saved */
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

/** On-device fit from a teacher judgment (judgments-only path after bootstrap). */
export async function trainWritingJudgment(
  strokes: Stroke[],
  targetLetter: string,
  teacherPass: boolean,
): Promise<void> {
  if (!teacherPass || trainingBusy || !model || !ready) return;
  const idx = letterToIndex(targetLetter);
  if (idx < 0) return;

  const flat = rasterizeStrokes(strokes);
  trainingBusy = true;
  try {
    await fitRasters([flat], [idx], 3, 1);
    await persistModel();
    modelSource = 'local';
  } finally {
    trainingBusy = false;
  }
}
