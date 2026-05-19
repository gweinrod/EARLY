import { VC } from './data';
import { NMCC, type Frame } from './dsp';
import { trainingBuffer } from './net';

export type FeedbackType = 'pass' | 'fail' | 'warn' | 'info';

const icons: Record<string, string> = { pass: '✓', fail: '✗', warn: '⚠', info: 'ℹ' };

export function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}

export function show(id: string): void {
  $(id).style.display = 'block';
}

export function hide(id: string): void {
  $(id).style.display = 'none';
}

export function showErr(msg: string): void {
  const e = $('errBox');
  e.textContent = msg;
  e.style.display = 'block';
}

export function addFB(fb: { t: FeedbackType; s: string }, prepend = false): void {
  const d = document.createElement('div');
  const cls =
    fb.t === 'pass' ? ' pass' : fb.t === 'fail' ? ' fail' : fb.t === 'warn' ? ' warn' : '';
  d.className = 'fb' + cls;
  d.innerHTML = `<span class="fb-icon">${icons[fb.t] ?? 'ℹ'}</span><span>${fb.s}</span>`;
  const list = $('fbList');
  if (prepend) list.insertBefore(d, list.firstChild);
  else list.appendChild(d);
}

export function clearFB(): void {
  $('fbList').innerHTML = '';
}

export function updateScores(correct: number, total: number): void {
  $('sC').textContent = String(correct);
  $('sT').textContent = String(total);
  $('sP').textContent = total > 0 ? `${Math.round((correct / total) * 100)}%` : '—';
}

export function addHistory(
  w: string,
  h: string,
  pass: boolean,
  history: { w: string; h: string; pass: boolean }[],
): void {
  history.unshift({ w, h, pass });
  if (history.length > 5) history.pop();
  show('histBlock');
  let html = '';
  for (const x of history) {
    html += `<div class="hist-row">
      <span>${x.w}</span>
      <span class="h-heard">“${x.h}”</span>
      <span class="badge ${x.pass ? 'ok' : 'no'}">${x.pass ? '✓' : '✗'}</span>
    </div>`;
  }
  $('histRows').innerHTML = html;
}

export function updateNetBadge(n: number, loss?: number): void {
  const badge = $('netBadge');
  const txt = $('netTxt');
  const lossStr = loss !== undefined ? ` · loss: ${loss.toFixed(3)}` : '';
  txt.textContent = `pure JS · 13→16→8→6 · ${n} sample${n !== 1 ? 's' : ''}${lossStr} · ${n >= 8 ? 'model active' : 'model cold'}`;
  badge.className = n >= 8 ? 'active' : 'info';
}

export function drawHeatmap(frames: Frame[]): void {
  show('hmWrap');
  const cv = $('hmCanvas') as HTMLCanvasElement;
  const W = cv.parentElement?.offsetWidth || 600;
  cv.width = W;
  cv.height = 104;
  cv.style.width = `${W}px`;
  const ctx = cv.getContext('2d');
  if (!ctx) return;

  const nF = frames.length;
  const nC = NMCC;
  const cW = W / nF;
  const cH = 104 / nC;

  let mn = Infinity;
  let mx = -Infinity;
  for (const f of frames) {
    for (let c = 0; c < nC; c++) {
      const v = f.mfcc[c];
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
  }
  const rng = mx - mn || 1;

  for (let t = 0; t < nF; t++) {
    for (let c = 0; c < nC; c++) {
      const n = (frames[t].mfcc[c] - mn) / rng;
      let r: number;
      let g: number;
      let b: number;
      if (n < 0.5) {
        const p = n * 2;
        r = Math.round(p * 255);
        g = r;
        b = 255;
      } else {
        const p = (1 - n) * 2;
        r = 255;
        g = Math.round(p * 255);
        b = g;
      }
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(Math.round(t * cW), Math.round(c * cH), Math.ceil(cW) + 1, Math.ceil(cH) + 1);
    }
  }

  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.font = `${Math.max(7, Math.round(cH * 0.65))}px monospace`;
  for (let c = 0; c < nC; c++) {
    ctx.fillText(`c${c}`, 2, Math.round(c * cH + cH * 0.78));
  }
}

export function showProbBars(probs: number[], ms: string): void {
  show('pbWrap');
  let top = 0;
  for (let i = 1; i < probs.length; i++) if (probs[i] > probs[top]) top = i;

  let html = '';
  for (let i = 0; i < VC.length; i++) {
    const p = Math.round(probs[i] * 100);
    const isTop = i === top;
    html += `<div class="pb-row">
      <span class="pb-lbl${isTop ? ' hi' : ''}">${VC[i].label}</span>
      <div class="pb-bg"><div class="pb-fill${isTop ? ' hi' : ''}" style="width:${p}%"></div></div>
      <span class="pb-val${isTop ? ' hi' : ''}">${p}%</span>
    </div>`;
  }
  $('pbBars').innerHTML = html;
  const n = trainingBuffer.X.length;
  $('pbMeta').textContent = `inference ${ms}ms · ${n} training sample${n !== 1 ? 's' : ''} · ${n < 8 ? 'cold' : 'active'}`;
}

export function drawWave(an: AnalyserNode, listening: () => boolean): () => void {
  const cv = $('waveCanvas') as HTMLCanvasElement;
  cv.width = (cv.offsetWidth || 600) * window.devicePixelRatio;
  cv.height = 72 * window.devicePixelRatio;
  const ctx = cv.getContext('2d');
  if (!ctx) return () => {};

  const buf = new Uint8Array(an.frequencyBinCount);
  let animId = 0;

  const frame = () => {
    if (!listening()) return;
    animId = requestAnimationFrame(frame);
    an.getByteTimeDomainData(buf);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const sw = cv.width / buf.length;
    for (let i = 0; i < buf.length; i++) {
      const y = (buf[i] / 128) * (cv.height / 2);
      if (i === 0) ctx.moveTo(0, y);
      else ctx.lineTo(i * sw, y);
    }
    ctx.stroke();
  };
  frame();

  return () => cancelAnimationFrame(animId);
}
