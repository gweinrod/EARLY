import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-backend-wasm';
import type { CurriculumStageId } from './curriculum';
import { buildBootstrapDataset } from './bootstrap-embeddings';
import { NMCC } from './dsp';
import { getVocabWords, setVocabularyStage, wordIndex } from './word-vocabulary';
import { isVoiceBankComplete } from './voice-bank';

const INPUT_DIM = NMCC;

let model: tf.LayersModel | null = null;
let ready = false;
let trainingBusy = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let activeStage: CurriculumStageId = 'alphabet';

function modelStorageUrl(stageId: CurriculumStageId): string {
  return `localstorage://early-tf-${stageId}`;
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

export async function initTfPhonemeModel(stageId: CurriculumStageId): Promise<void> {
  if (ready && activeStage === stageId && model) return;

  model?.dispose();
  model = null;
  ready = false;
  activeStage = stageId;

  setVocabularyStage(stageId);
  const vocabSize = getVocabWords().length;
  if (vocabSize === 0) return;

  await tf.setBackend('wasm');
  await tf.ready();

  if (!isVoiceBankComplete(stageId)) {
    model = null;
    ready = false;
    return;
  }

  const url = modelStorageUrl(stageId);
  try {
    model = await tf.loadLayersModel(url);
    ready = true;
    return;
  } catch {
    /* no saved model for this stage */
  }

  const bootstrapped = await runBootstrapTraining(stageId);
  if (!bootstrapped) {
    model = null;
    ready = false;
  }
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
  const vocabSize = getVocabWords().length;
  const xs = tf.tensor2d(x);
  const ys = tf.oneHot(tf.tensor1d(y, 'int32'), vocabSize);
  try {
    await model.fit(xs, ys, { epochs, batchSize, shuffle: true, verbose: 0 });
  } finally {
    xs.dispose();
    ys.dispose();
  }
}

async function persistModel(): Promise<void> {
  if (!model) return;
  await model.save(modelStorageUrl(activeStage));
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
  if (!model || trainingBusy) return;

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
