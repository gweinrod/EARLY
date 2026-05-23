import type { CurriculumItem } from './curriculum';
import { $, hide, show } from './ui';

const STROKE_WIDTH = 2.5;
const STROKE_COLOR = '#1e293b';
const LINE_COLOR = '#93c5fd';
const MARGIN_COLOR = '#fca5a5';
const MIDLINE_COLOR = '#334155';
const MIDLINE_WIDTH = 4;
const MIDLINE_DASH = [18, 12] as const;
const BOUNDARY_COLOR = '#000000';

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let drawing = false;
let pointerId: number | null = null;
let resizeObserver: ResizeObserver | null = null;

function deviceUsesTouch(): boolean {
  return (
    typeof window !== 'undefined' &&
    ('ontouchstart' in window || navigator.maxTouchPoints > 0)
  );
}

function canvasCssSize(): number {
  const wrap = $('letterWritingCanvasWrap');
  const w = wrap.clientWidth;
  return Math.max(200, Math.min(w, 360));
}

function resizeCanvas(): void {
  if (!canvas || !ctx) return;
  const css = canvasCssSize();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(css * dpr);
  canvas.height = Math.round(css * dpr);
  canvas.style.width = `${css}px`;
  canvas.style.height = `${css}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  redrawPaper();
}

function redrawPaper(): void {
  if (!canvas || !ctx) return;
  const w = canvasCssSize();
  const h = w;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#fffef8';
  ctx.fillRect(0, 0, w, h);

  const lineGap = Math.max(22, Math.round(h / 8));
  const topPad = Math.round(lineGap * 0.65);
  const marginX = Math.round(w * 0.12);

  ctx.strokeStyle = MARGIN_COLOR;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(marginX, 0);
  ctx.lineTo(marginX, h);
  ctx.stroke();

  const ruledYs: number[] = [];
  ctx.strokeStyle = LINE_COLOR;
  ctx.lineWidth = 1;
  for (let y = topPad; y < h - lineGap * 0.4; y += lineGap) {
    ruledYs.push(y);
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(w, y + 0.5);
    ctx.stroke();
  }

  if (ruledYs.length >= 2) {
    ctx.setLineDash([]);
    ctx.lineCap = 'round';
    ctx.lineWidth = MIDLINE_WIDTH;
    ctx.strokeStyle = BOUNDARY_COLOR;
    for (const y of [ruledYs[0], ruledYs[ruledYs.length - 1]]) {
      const by = y + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, by);
      ctx.lineTo(w, by);
      ctx.stroke();
    }
  }

  const midIdx = Math.floor((ruledYs.length - 1) / 2);
  const midY = ruledYs[midIdx] ?? topPad + lineGap * 2;
  const midlineY = midY + 0.5;

  ctx.setLineDash([...MIDLINE_DASH]);
  ctx.lineCap = 'round';
  ctx.lineWidth = MIDLINE_WIDTH;
  ctx.strokeStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(0, midlineY);
  ctx.lineTo(w, midlineY);
  ctx.stroke();

  ctx.strokeStyle = MIDLINE_COLOR;
  ctx.beginPath();
  ctx.moveTo(0, midlineY);
  ctx.lineTo(w, midlineY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineWidth = 1;
  ctx.lineCap = 'butt';
}

function clearInk(): void {
  redrawPaper();
}

function pointerPos(e: PointerEvent): { x: number; y: number } {
  if (!canvas) return { x: 0, y: 0 };
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function onPointerDown(e: PointerEvent): void {
  if (!canvas || !ctx || e.button !== 0) return;
  drawing = true;
  pointerId = e.pointerId;
  canvas.setPointerCapture(e.pointerId);
  const { x, y } = pointerPos(e);
  ctx.strokeStyle = STROKE_COLOR;
  ctx.lineWidth = STROKE_WIDTH;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y);
  e.preventDefault();
}

function onPointerMove(e: PointerEvent): void {
  if (!drawing || !ctx || e.pointerId !== pointerId) return;
  const { x, y } = pointerPos(e);
  ctx.lineTo(x, y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x, y);
  e.preventDefault();
}

function endStroke(e: PointerEvent): void {
  if (!drawing || e.pointerId !== pointerId) return;
  drawing = false;
  pointerId = null;
  if (canvas?.hasPointerCapture(e.pointerId)) {
    canvas.releasePointerCapture(e.pointerId);
  }
}

export function initLetterWritingUi(): void {
  canvas = $('letterWritingCanvas') as HTMLCanvasElement;
  ctx = canvas.getContext('2d');
  if (!ctx) return;

  const touch = deviceUsesTouch();
  $('letterWritingHint').textContent = touch
    ? 'Use your finger to write on the lines.'
    : 'Use the mouse to write on the lines.';

  canvas.style.touchAction = 'none';

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', endStroke);
  canvas.addEventListener('pointercancel', endStroke);

  $('btnClearWriting').addEventListener('click', () => clearInk());

  resizeObserver = new ResizeObserver(() => resizeCanvas());
  resizeObserver.observe($('letterWritingCanvasWrap'));
  resizeCanvas();
}

export function setLetterWritingTarget(item: CurriculumItem): void {
  $('letterWritingTarget').textContent = item.display;
  $('letterWritingPrompt').textContent = 'Practice writing this letter';
  clearInk();
}

export function showLetterWritingPractice(): void {
  hide('speechPracticeBlock');
  show('letterWritingBlock');
  resizeCanvas();
}

export function hideLetterWritingPractice(): void {
  show('speechPracticeBlock');
  hide('letterWritingBlock');
  drawing = false;
  pointerId = null;
}
