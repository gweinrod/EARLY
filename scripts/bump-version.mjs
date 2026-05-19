#!/usr/bin/env node
/**
 * Bump EARLY display version: 0.1 → 0.2 → … → 0.9 → 0.10 → 0.11 …
 * Run before each release commit: npm run version:bump
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const versionTs = path.join(root, 'src', 'version.ts');
const pkgPath = path.join(root, 'package.json');

function bumpDisplay(display) {
  const dot = display.lastIndexOf('.');
  if (dot === -1) return `${display}.1`;
  const head = display.slice(0, dot);
  const n = parseInt(display.slice(dot + 1), 10);
  if (Number.isNaN(n)) throw new Error(`Invalid version: ${display}`);
  return `${head}.${n + 1}`;
}

const src = fs.readFileSync(versionTs, 'utf8');
const match = src.match(/APP_VERSION = '([^']+)'/);
if (!match) throw new Error('APP_VERSION not found in src/version.ts');

const current = match[1];
const next = bumpDisplay(current);

const nextSrc = src.replace(/APP_VERSION = '[^']+'/, `APP_VERSION = '${next}'`);
fs.writeFileSync(versionTs, nextSrc);

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
pkg.version = `${next}.0`;
fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

console.log(`EARLY version: ${current} → ${next}`);
