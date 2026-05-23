#!/usr/bin/env node
/**
 * Write TensorFlow.js LayersModel from train-weights.json (see train_letter_writing_model.py).
 * Architecture must match letter-writing-tf.ts createModel().
 */
import * as tf from '@tensorflow/tfjs';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const STAGE_ID = 'letter-writing';
const STAGE_DIR = path.join(ROOT, 'public', 'models', STAGE_ID);

function createModel(rasterSize, numClasses) {
  const m = tf.sequential();
  m.add(
    tf.layers.conv2d({
      inputShape: [rasterSize, rasterSize, 1],
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
  m.add(tf.layers.dense({ units: numClasses, activation: 'softmax' }));
  return m;
}

async function main() {
  const weightsPath = path.join(STAGE_DIR, 'train-weights.json');
  const spec = JSON.parse(await fs.readFile(weightsPath, 'utf8'));
  const { rasterSize, numClasses, layers } = spec;
  if (!rasterSize || !numClasses || !layers?.length) {
    throw new Error('train-weights.json missing rasterSize, numClasses, or layers[]');
  }

  const model = createModel(rasterSize, numClasses);
  const weightLayers = model.layers.filter((l) => {
    const n = l.getClassName();
    return n === 'Conv2D' || n === 'Dense';
  });
  if (weightLayers.length !== layers.length) {
    throw new Error(`Expected ${layers.length} weight layers, got ${weightLayers.length}`);
  }

  for (let i = 0; i < layers.length; i++) {
    const { type, kernel, bias } = layers[i];
    const layer = weightLayers[i];
    if (type === 'conv2d') {
      const k = tf.tensor4d(kernel);
      const b = tf.tensor1d(bias);
      layer.setWeights([k, b]);
      k.dispose();
      b.dispose();
    } else if (type === 'dense') {
      const k = tf.tensor2d(kernel);
      const b = tf.tensor1d(bias);
      layer.setWeights([k, b]);
      k.dispose();
      b.dispose();
    } else {
      throw new Error(`Unknown layer type: ${type}`);
    }
  }

  model.compile({
    optimizer: tf.train.adamax(0.001),
    loss: 'categoricalCrossentropy',
    metrics: ['accuracy'],
  });

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
        generatedBy: 'EARLY tools/export_letter_writing_tfjs.mjs',
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

  model.dispose();
  console.log(`Exported TF.js model → public/models/${STAGE_ID}/ (${rasterSize}×${rasterSize}, ${numClasses} classes)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
