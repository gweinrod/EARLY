#!/usr/bin/env node
/** Copy @tensorflow/tfjs-backend-wasm binaries into public/ for Vite and static deploy. */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'node_modules', '@tensorflow', 'tfjs-backend-wasm', 'dist');
const destDir = path.join(root, 'public', 'tfjs-wasm');

const files = [
  'tfjs-backend-wasm.wasm',
  'tfjs-backend-wasm-simd.wasm',
  'tfjs-backend-wasm-threaded-simd.wasm',
];

if (!fs.existsSync(srcDir)) {
  console.error('Missing @tensorflow/tfjs-backend-wasm — run npm install');
  process.exit(1);
}

fs.mkdirSync(destDir, { recursive: true });
for (const name of files) {
  fs.copyFileSync(path.join(srcDir, name), path.join(destDir, name));
}
console.log(`Copied ${files.length} WASM files → public/tfjs-wasm/`);
