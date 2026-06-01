#!/usr/bin/env node
/**
 * Merge pulled cloud samples into a permanent local archive (survives "clear server").
 * Run after npm run training:pull, or via publish scripts.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function copyDir(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) return 0;
  fs.mkdirSync(destDir, { recursive: true });
  let n = 0;
  for (const name of fs.readdirSync(srcDir)) {
    if (!name.endsWith('.json')) continue;
    const src = path.join(srcDir, name);
    const dest = path.join(destDir, name);
    if (!fs.existsSync(dest)) {
      fs.copyFileSync(src, dest);
      n++;
    }
  }
  return n;
}

const pairs = [
  [path.join(root, 'data', 'calibration'), path.join(root, 'data', 'training-archive', 'calibration')],
  [path.join(root, 'data', 'voice-bank'), path.join(root, 'data', 'training-archive', 'voice-bank')],
  [
    path.join(root, 'data', 'writing-calibration'),
    path.join(root, 'data', 'training-archive', 'writing-calibration'),
  ],
];

let added = 0;
for (const [src, dest] of pairs) {
  added += copyDir(src, dest);
}

const calTotal = fs.existsSync(pairs[0][1])
  ? fs.readdirSync(pairs[0][1]).filter((f) => f.endsWith('.json')).length
  : 0;
const voiceTotal = fs.existsSync(pairs[1][1])
  ? fs.readdirSync(pairs[1][1]).filter((f) => f.endsWith('.json')).length
  : 0;

const writingDir = pairs[2][1];
const writingTotal = fs.existsSync(writingDir)
  ? fs.readdirSync(writingDir).filter((f) => f.endsWith('.json')).length
  : 0;

console.log(
  `Training archive: +${added} new file(s) → ${calTotal} speech judgments, ${voiceTotal} voice, ${writingTotal} writing (kept locally).`,
);
