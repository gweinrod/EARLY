import type { CurriculumItem } from './curriculum';
import { $, hide, show } from './ui';

const STROKE_WIDTH = 5;
const STROKE_COLOR = '#1e293b';
const MARGIN_COLOR = '#fca5a5';
const DASHED_LINE_COLOR = '#3b82f6';
const DASHED_LINE_WIDTH = 4;
const DASHED_LINE_DASH = [18, 12] as const;
const BOUNDARY_COLOR = '#000000';
const BOTTOM_PAD_LINES = 0.98;

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

function canvasCssWidth(): number {
  const wrap = $('letterWritingCanvasWrap');
  const w = wrap.clientWidth;
  return Math.max(200, Math.min(w, 360));
}

function paperLayout(w: number): {
  w: number;
  h: number;
  marginX: number;
  topBlackY: number;
  bottomBlackY: number;
  midlineY: number;
  lowerDashedY: number;
} {
  const lineGap = Math.max(22, Math.round(w / 8));
  const topPad = Math.round(lineGap * 0.65);
  const marginX = Math.round(w * 0.12);

  const rowYs: number[] = [];
  for (let y = topPad; y < w - lineGap * 0.4; y += lineGap) {
    rowYs.push(y);
  }

  const topBlackY = rowYs[0] ?? topPad;
  const bottomBlackY = rowYs[rowYs.length - 1] ?? topPad;
  const midIdx = Math.floor((rowYs.length - 1) / 2);
  const midlineY = rowYs[midIdx] ?? topBlackY;
  const midlineToBottom = bottomBlackY - midlineY;
  const lowerDashedY = bottomBlackY + midlineToBottom;

  const h = lowerDashedY + Math.round(lineGap * BOTTOM_PAD_LINES);

  return { w, h, marginX, topBlackY, bottomBlackY, midlineY, lowerDashedY };
}

function resizeCanvas(): void {
  if (!canvas || !ctx) return;
  const { w, h } = paperLayout(canvasCssWidth());
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  redrawPaper();
}

function strokeDashedGuide(y: number, width: number): void {
  if (!ctx) return;
  const drawY = y + 0.5;
  ctx.setLineDash([...DASHED_LINE_DASH]);
  ctx.lineCap = 'round';
  ctx.lineWidth = DASHED_LINE_WIDTH;
  ctx.strokeStyle = DASHED_LINE_COLOR;
  ctx.beginPath();
  ctx.moveTo(0, drawY);
  ctx.lineTo(width, drawY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineCap = 'butt';
  ctx.lineWidth = 1;
}

function redrawPaper(): void {
  if (!canvas || !ctx) return;
  const { w, h, marginX, topBlackY, bottomBlackY, midlineY, lowerDashedY } =
    paperLayout(canvasCssWidth());
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#fffef8';
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = MARGIN_COLOR;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(marginX, 0);
  ctx.lineTo(marginX, h);
  ctx.stroke();

  ctx.setLineDash([]);
  ctx.lineCap = 'round';
  ctx.lineWidth = DASHED_LINE_WIDTH;
  ctx.strokeStyle = BOUNDARY_COLOR;
  for (const y of [topBlackY, bottomBlackY]) {
    const by = y + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, by);
    ctx.lineTo(w, by);
    ctx.stroke();
  }
  ctx.lineWidth = 1;

  strokeDashedGuide(midlineY, w);
  strokeDashedGuide(lowerDashedY, w);
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
