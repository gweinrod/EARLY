import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-backend-wasm';
import { buildBootstrapDataset } from './bootstrap-embeddings';
import { NMCC } from './dsp';
import { VOCAB_WORDS, wordIndex } from './word-vocabulary';

const MODEL_STORAGE_URL = 'localstorage://early-tf-word-model';
const INPUT_DIM = NMCC;

let model: tf.LayersModel | null = null;
let ready = false;

export function isTfReady(): boolean {
  return ready && model !== null;
}

export async function initTfPhonemeModel(): Promise<void> {
  if (ready) return;
  await tf.setBackend('wasm');
  await tf.ready();

  try {
    model = await tf.loadLayersModel(MODEL_STORAGE_URL);
    ready = true;
    return;
  } catch {
    /* first run */
  }

  model = createModel(VOCAB_WORDS.length);
  ready = true;
  await runBootstrapTraining();
}

function createModel(numClasses: number): tf.LayersModel {
  const m = tf.sequential();
  m.add(
    tf.layers.dense({
      inputShape: [INPUT_DIM],
      units: 128,
      activation: 'relu',
      kernelInitializer: 'glorotUniform',
    }),
  );
  m.add(tf.layers.dropout({ rate: 0.2 }));
  m.add(tf.layers.dense({ units: 64, activation: 'relu' }));
  m.add(tf.layers.dense({ units: 32, activation: 'relu' }));
  m.add(tf.layers.dense({ units: numClasses, activation: 'softmax' }));
  m.compile({
    optimizer: tf.train.adamax(0.002),
    loss: 'categoricalCrossentropy',
    metrics: ['accuracy'],
  });
  return m;
}

async function runBootstrapTraining(): Promise<void> {
  if (!model) return;
  const { x, y } = buildBootstrapDataset(12);
  await fitBatch(x, y, 40, 16);
  await model.save(MODEL_STORAGE_URL);
}

async function fitBatch(x: number[][], y: number[], epochs: number, batchSize: number): Promise<void> {
  if (!model || x.length === 0) return;
  const xs = tf.tensor2d(x);
  const ys = tf.oneHot(tf.tensor1d(y, 'int32'), VOCAB_WORDS.length);
  try {
    await model.fit(xs, ys, { epochs, batchSize, shuffle: true, verbose: 0 });
  } finally {
    xs.dispose();
    ys.dispose();
  }
}

export interface TfWordPrediction {
  guessedWord: string;
  confidence: number;
  targetProbability: number;
  top3: { word: string; probability: number }[];
}

export function predictWordForTarget(embedding: number[], targetWord: string): TfWordPrediction | null {
  if (!model || !ready || embedding.length !== INPUT_DIM) return null;

  const probs = tf.tidy(() => {
    const input = tf.tensor2d([embedding]);
    const out = model!.predict(input) as tf.Tensor;
    return Array.from(out.dataSync());
  });

  let topIdx = 0;
  for (let i = 1; i < probs.length; i++) if (probs[i] > probs[topIdx]) topIdx = i;

  const sorted = probs
    .map((p, i) => ({ word: VOCAB_WORDS[i], probability: p }))
    .sort((a, b) => b.probability - a.probability);

  const ti = wordIndex(targetWord);

  return {
    guessedWord: VOCAB_WORDS[topIdx],
    confidence: probs[topIdx],
    targetProbability: ti !== undefined ? probs[ti] : 0,
    top3: sorted.slice(0, 3),
  };
}

/** Online calibration when teacher agrees and marks neither ASR nor DSP wrong. */
export async function trainOnCalibrationSample(embedding: number[], targetWord: string): Promise<void> {
  if (!model) return;
  const idx = wordIndex(targetWord);
  if (idx === undefined) return;
  await fitBatch([embedding], [idx], 8, 1);
  await model.save(MODEL_STORAGE_URL);
}
