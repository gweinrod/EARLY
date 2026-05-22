#!/usr/bin/env node
/**
 * Write TensorFlow.js LayersModel files from train-weights.json (see train_global_model.py).
 * Architecture must match tf-phoneme.ts createModel() and train_global_model.py build_model().
 */
import * as tf from '@tensorflow/tfjs';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

async function main() {
  const stageId = process.argv[2] || 'alphabet';
  const stageDir = path.join(ROOT, 'public', 'models', stageId);
  const weightsPath = path.join(stageDir, 'train-weights.json');
  const spec = JSON.parse(await fs.readFile(weightsPath, 'utf8'));

  const { dense, inputDim, numClasses } = spec;
  if (!dense?.length || !inputDim || !numClasses) {
    throw new Error('train-weights.json missing inputDim, numClasses, or dense[]');
  }

  const model = tf.sequential();
  for (let i = 0; i < dense.length; i++) {
    const kernel = dense[i].kernel;
    const units = kernel[0].length;
    if (i === 0) {
      model.add(
        tf.layers.dense({
          inputShape: [inputDim],
          units,
          activation: 'relu',
          kernelInitializer: 'glorotUniform',
        }),
      );
      model.add(tf.layers.dropout({ rate: 0.2 }));
    } else if (i === dense.length - 1) {
      model.add(tf.layers.dense({ units, activation: 'softmax' }));
    } else {
      model.add(tf.layers.dense({ units, activation: 'relu' }));
    }
  }

  const denseLayers = model.layers.filter((l) => l.getClassName() === 'Dense');
  if (denseLayers.length !== dense.length) {
    throw new Error(`Expected ${dense.length} dense layers, got ${denseLayers.length}`);
  }
  for (let i = 0; i < dense.length; i++) {
    const { kernel, bias } = dense[i];
    const k = tf.tensor2d(kernel);
    const b = tf.tensor1d(bias);
    denseLayers[i].setWeights([k, b]);
    k.dispose();
    b.dispose();
  }

  model.compile({
    optimizer: tf.train.adamax(0.002),
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
        generatedBy: 'EARLY tools/export_tfjs_model.mjs',
        convertedBy: null,
        modelTopology: artifacts.modelTopology,
        weightsManifest,
      };

      await fs.mkdir(stageDir, { recursive: true });
      await fs.writeFile(path.join(stageDir, 'model.json'), JSON.stringify(modelJson));
      await fs.writeFile(path.join(stageDir, shard), buffer);

      return {
        modelArtifactsInfo: {
          dateSaved: new Date(),
          modelTopologyType: 'JSON',
        },
      };
    }),
  );

  model.dispose();
  console.log(`Exported TF.js model → public/models/${stageId}/ (input ${inputDim}-D, ${numClasses} classes)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
