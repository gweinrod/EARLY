#!/usr/bin/env node
/** Read EMBEDDING_DIM from src/dsp.ts (single source of truth for train/server sync). */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dspPath = path.join(ROOT, 'src', 'dsp.ts');
const text = fs.readFileSync(dspPath, 'utf8');
const m = text.match(/export const EMBEDDING_DIM\s*=\s*([^;]+);/);
if (!m) {
  console.error('EMBEDDING_DIM not found in src/dsp.ts');
  process.exit(1);
}
const expr = m[1].trim();
const dim = Function(`"use strict"; const NMCC = 20; return (${expr});`)();
if (!Number.isFinite(dim) || dim < 1) {
  console.error('Invalid EMBEDDING_DIM:', dim);
  process.exit(1);
}
console.log(dim);
