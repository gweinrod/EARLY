#!/usr/bin/env node
/**
 * Extract dense weights from shipped TF.js model → base-weights.json for fine-tuning.
 */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function readEmbeddingDim() {
  const out = execSync('node tools/read_embedding_dim.mjs', { cwd: ROOT, encoding: 'utf8' }).trim();
  const n = parseInt(out, 10);
  if (!Number.isFinite(n) || n < 1) throw new Error(`Invalid EMBEDDING_DIM: ${out}`);
  return n;
}

function readWeights(stageDir) {
  const modelJson = JSON.parse(fs.readFileSync(path.join(stageDir, 'model.json'), 'utf8'));
  const manifest = modelJson.weightsManifest[0];
  const buffer = fs.readFileSync(path.join(stageDir, manifest.paths[0]));
  let offset = 0;
  const dense = [];

  for (const spec of manifest.weights) {
    if (!spec.name.includes('/kernel') && !spec.name.includes('/bias')) continue;
    const count = spec.shape.reduce((a, b) => a * b, 1);
    const slice = buffer.subarray(offset, offset + count * 4);
    offset += count * 4;
    const arr = new Float32Array(slice.buffer, slice.byteOffset, count);
    const values = [...arr];
    if (spec.name.endsWith('/kernel')) {
      const [inDim, outDim] = spec.shape.length === 2 ? spec.shape : [spec.shape[0], 1];
      const kernel = [];
      for (let i = 0; i < inDim; i++) {
        kernel[i] = values.slice(i * outDim, (i + 1) * outDim);
      }
      dense.push({ kernel, bias: null });
    } else {
      dense[dense.length - 1].bias = values;
    }
  }

  return dense.filter((d) => d.bias);
}

function main() {
  const stageId = process.argv[2] || 'alphabet';
  const stageDir = path.join(ROOT, 'public', 'models', stageId);
  const dense = readWeights(stageDir);
  const spec = {
    inputDim: readEmbeddingDim(),
    numClasses: dense[dense.length - 1].bias.length,
    dense,
  };
  const outPath = path.join(stageDir, 'base-weights.json');
  fs.writeFileSync(outPath, `${JSON.stringify(spec, null, 2)}\n`);
  console.log(`Wrote ${outPath} (${dense.length} dense layers).`);
}

main();
