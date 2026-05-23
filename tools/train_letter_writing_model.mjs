#!/usr/bin/env node
/**
 * Train shared letter-writing CNN from teacher bootstrap seed (+ optional judgments).
 *
 *   1. Export seed from app → data/writing-bank/teacher-seed.json
 *   2. node tools/train_letter_writing_model.mjs
 *
 * Writes public/models/letter-writing/ (manifest + TF.js). Architecture matches
 * src/letter-writing-tf.ts createModel().
 */
import * as tf from '@tensorflow/tfjs';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { RASTER_SIZE, rasterizeStrokesNode } from './letter_writing_raster.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const STAGE_ID = 'letter-writing';
const NUM_CLASSES = 26;
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const BANK_PATH = path.join(ROOT, 'data', 'writing-bank', 'teacher-seed.json');
const CALIBRATION_DIR = path.join(ROOT, 'data', 'writing-calibration');
const STAGE_DIR = path.join(ROOT, 'public', 'models', STAGE_ID);

function letterToIndex(letter) {
  const code = String(letter).toUpperCase().charCodeAt(0);
  if (code < 65 || code > 90) return -1;
  return code - 65;
}

/** @returns {tf.LayersModel} — keep in sync with letter-writing-tf.ts createModel() */
function createModel() {
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

async function loadBootstrapSamples() {
  let raw;
  try {
    raw = await fs.readFile(BANK_PATH, 'utf8');
  } catch {
    throw new Error(
      `Missing ${BANK_PATH}\n` +
        'Export from the app: collector panel → Export writing seed, save as data/writing-bank/teacher-seed.json',
    );
  }
  const bank = JSON.parse(raw);
  const samples = bank.samples ?? bank;
  const xs = [];
  const ys = [];

  for (const letter of LETTERS) {
    const sets = samples[letter];
    if (!sets?.length) {
      throw new Error(`Bootstrap seed missing letter ${letter} in teacher-seed.json`);
    }
    const idx = letterToIndex(letter);
    for (const strokes of sets) {
      const flat = rasterizeStrokesNode(strokes);
      for (let r = 0; r < 4; r++) {
        xs.push(flat);
        ys.push(idx);
      }
    }
  }
  return { xs, ys };
}

async function loadJudgmentSamples(xs, ys, seen) {
  let files = [];
  try {
    files = await fs.readdir(CALIBRATION_DIR);
  } catch {
    return 0;
  }
  let added = 0;
  for (const name of files.filter((f) => f.endsWith('.json'))) {
    const row = JSON.parse(await fs.readFile(path.join(CALIBRATION_DIR, name), 'utf8'));
    if (row.teacherPass !== true && row.pass !== true) continue;
    const letter = row.letter ?? row.targetLetter;
    const idx = letterToIndex(letter);
    if (idx < 0 || !row.strokes?.length) continue;
    const flat = rasterizeStrokesNode(row.strokes);
    const key = `${idx}:${flat[0].toFixed(4)}:${flat.length}`;
    if (seen.has(key)) continue;
    seen.add(key);
    xs.push(flat);
    ys.push(idx);
    added++;
  }
  return added;
}

function normalizeManifestVersion(raw) {
  const v = Number(raw);
  if (!Number.isFinite(v)) return 0;
  if (v >= 1 && v < 10 && Number.isInteger(v)) return Math.round((v / 10) * 100) / 100;
  return Math.round(v * 100) / 100;
}

function bumpMinorVersion(current) {
  return Math.round(normalizeManifestVersion(current) * 100 + 1) / 100;
}

async function readManifestVersion() {
  try {
    const m = JSON.parse(await fs.readFile(path.join(STAGE_DIR, 'manifest.json'), 'utf8'));
    return normalizeManifestVersion(m.version ?? 0);
  } catch {
    return 0;
  }
}

async function exportTfjsModel(model) {
  await model.save(
    tf.io.withSaveHandler(async (artifacts) => {
      const weightData = artifacts.weightData;
      const buffer =
        weightData instanceof ArrayBuffer
          ? Buffer.from(weightData)
          : Buffer.concat(weightData.map((ab) => Buffer.from(ab)));

      const shard = 'group1-shard1of1.bin';
      const weightsManifest = [
        {
          paths: [shard],
          weights: artifacts.weightSpecs.map((w) => ({
            name: w.name,
            shape: w.shape,
            dtype: w.dtype,
          })),
        },
      ];

      const modelJson = {
        format: 'layers-model',
        generatedBy: 'EARLY tools/train_letter_writing_model.mjs',
        convertedBy: null,
        modelTopology: artifacts.modelTopology,
        weightsManifest,
      };

      await fs.mkdir(STAGE_DIR, { recursive: true });
      await fs.writeFile(path.join(STAGE_DIR, 'model.json'), JSON.stringify(modelJson));
      await fs.writeFile(path.join(STAGE_DIR, shard), buffer);

      return {
        modelArtifactsInfo: {
          dateSaved: new Date(),
          modelTopologyType: 'JSON',
        },
      };
    }),
  );
}

async function main() {
  await tf.setBackend('cpu');
  await tf.ready();

  const { xs, ys } = await loadBootstrapSamples();
  const seen = new Set();
  const judgmentCount = await loadJudgmentSamples(xs, ys, seen);

  const xStack = tf.stack(xs.map((f) => tf.tensor3d(f, [RASTER_SIZE, RASTER_SIZE, 1])));
  const yOneHot = tf.oneHot(tf.tensor1d(ys, 'int32'), NUM_CLASSES);

  const model = createModel();
  console.log(
    `Training letter-writing CNN: ${xs.length} rasters (${LETTERS.length} bootstrap letters, +${judgmentCount} judgments)`,
  );

  await model.fit(xStack, yOneHot, {
    epochs: 40,
    batchSize: Math.min(16, xs.length),
    shuffle: true,
    verbose: 1,
  });

  xStack.dispose();
  yOneHot.dispose();

  await exportTfjsModel(model);
  model.dispose();

  const nextVersion = bumpMinorVersion(await readManifestVersion());
  const manifest = {
    version: nextVersion,
    stageId: STAGE_ID,
    modelUrl: `/models/${STAGE_ID}/model.json`,
    trainedAt: new Date().toISOString(),
    sampleCount: xs.length,
    bootstrapLetters: LETTERS.length,
    judgmentSamples: judgmentCount,
  };
  await fs.writeFile(path.join(STAGE_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  console.log(`Wrote public/models/${STAGE_ID}/ — v${nextVersion}, ${xs.length} training rasters.`);
  console.log('Commit public/models/letter-writing/ and deploy so all devices load the shared model.');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
