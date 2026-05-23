import type { CurriculumItem } from './curriculum';
import type { Stroke, StrokePoint } from './letter-writing-data';
import {
  ALL_LETTERS,
  getMastery,
  logWritingAttempt,
} from './letter-writing-data';
import {
  expectedStrokes,
  extractStrokeFeatures,
  getStrokeHint,
  scoreLetterAttempt,
} from './letter-writing-scoring';
import { $, hide, show } from './ui';

const STROKE_WIDTH = 5;
const STROKE_COLOR = '#1e293b';
const MARGIN_COLOR = '#fca5a5';
const DASHED_LINE_COLOR = '#3b82f6';
const DASHED_LINE_WIDTH = 4;
const DASHED_LINE_DASH = [18, 12] as const;
const BOUNDARY_COLOR = '#000000';
const SCORE_DELAY_MS = 800;

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let drawing = false;
let pointerId: number | null = null;
let resizeObserver: ResizeObserver | null = null;

let strokes: Stroke[] = [];
let currentStroke: StrokePoint[] | null = null;
let strokeT0 = 0;
let attemptStartTime = 0;
let scored = false;
let scoreTimer: ReturnType<typeof setTimeout> | null = null;

let currentLetter = 'A';
let currentIsUppercase = true;
let onAttemptLogged: ((pass: boolean, score: number, letter: string) => void) | undefined;

export interface LetterWritingCallbacks {
  onAttemptLogged?: (pass: boolean, score: number, letter: string) => void;
}

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

  const h = lowerDashedY + topBlackY;

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
  redrawCanvas();
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

function drawInk(): void {
  if (!canvas || !ctx) return;
  const { w, h } = paperLayout(canvasCssWidth());
  const allStrokes = currentStroke ? [...strokes, currentStroke] : strokes;

  ctx.strokeStyle = STROKE_COLOR;
  ctx.lineWidth = STROKE_WIDTH;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash([]);

  for (const stroke of allStrokes) {
    if (stroke.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(stroke[0].x * w, stroke[0].y * h);
    for (let i = 1; i < stroke.length; i++) {
      ctx.lineTo(stroke[i].x * w, stroke[i].y * h);
    }
    ctx.stroke();
  }
}

function redrawCanvas(): void {
  redrawPaper();
  drawInk();
}

function cancelScoreTimer(): void {
  if (scoreTimer !== null) {
    clearTimeout(scoreTimer);
    scoreTimer = null;
  }
}

function updateTargetHints(): void {
  const hint = getStrokeHint(currentLetter, currentIsUppercase);
  const expected = expectedStrokes(currentLetter, currentIsUppercase);
  const strokeHintEl = $('letterWritingStrokeHint');
  strokeHintEl.textContent = hint;
  strokeHintEl.hidden = !hint;

  if (!scored) {
    $('letterWritingScore').textContent = expected ? `Expected: ${expected}` : '';
    $('letterWritingFeedback').textContent = '';
    $('letterWritingFeedback').className = 'letter-writing-feedback';
  }
}

function showFeedback(pass: boolean, lines: string[]): void {
  const el = $('letterWritingFeedback');
  el.innerHTML = lines.map((line) => `<div>${line}</div>`).join('');
  el.className = pass
    ? 'letter-writing-feedback letter-writing-feedback--pass'
    : 'letter-writing-feedback letter-writing-feedback--fail';
}

function finaliseAttempt(): void {
  scoreTimer = null;
  if (scored || strokes.length === 0) return;
  scored = true;

  const features = extractStrokeFeatures(strokes, attemptStartTime);
  const result = scoreLetterAttempt(currentLetter, currentIsUppercase, features);

  logWritingAttempt({
    letter: currentLetter,
    isUppercase: currentIsUppercase,
    strokes,
    features,
    heuristicScore: result.score,
    heuristicPass: result.pass,
    feedback: [...result.feedback, ...result.warnings],
    teacherPass: null,
    teacherNote: null,
  });

  showFeedback(result.pass, [...result.feedback, ...result.warnings]);

  const mastery = getMastery(currentLetter, currentIsUppercase);
  const accuracyStr = mastery
    ? ` · ${Math.round(mastery.recentAccuracy * 100)}% recent accuracy`
    : '';
  const masteredStr = mastery?.mastered ? ' ⭐' : '';
  $('letterWritingScore').textContent =
    `Score: ${result.score}/100${accuracyStr}${masteredStr}`;

  onAttemptLogged?.(result.pass, result.score, currentLetter);
}

function scheduleScore(): void {
  cancelScoreTimer();
  scoreTimer = setTimeout(finaliseAttempt, SCORE_DELAY_MS);
}

function clearInk(): void {
  cancelScoreTimer();
  strokes = [];
  currentStroke = null;
  drawing = false;
  scored = false;
  attemptStartTime = Date.now();
  redrawCanvas();
  updateTargetHints();
}

function pointerNorm(e: PointerEvent): StrokePoint {
  const rect = canvas!.getBoundingClientRect();
  const w = rect.width || 1;
  const h = rect.height || 1;
  return {
    x: Math.max(0, Math.min(1, (e.clientX - rect.left) / w)),
    y: Math.max(0, Math.min(1, (e.clientY - rect.top) / h)),
    t: Date.now() - strokeT0,
  };
}

function onPointerDown(e: PointerEvent): void {
  if (!canvas || !ctx || e.button !== 0 || scored) return;
  drawing = true;
  pointerId = e.pointerId;
  canvas.setPointerCapture(e.pointerId);
  strokeT0 = Date.now();
  currentStroke = [pointerNorm(e)];
  redrawCanvas();
  e.preventDefault();
}

function onPointerMove(e: PointerEvent): void {
  if (!drawing || !ctx || e.pointerId !== pointerId) return;
  currentStroke?.push(pointerNorm(e));
  redrawCanvas();
  e.preventDefault();
}

function endStroke(e: PointerEvent): void {
  if (!drawing || e.pointerId !== pointerId) return;
  drawing = false;
  pointerId = null;
  if (canvas?.hasPointerCapture(e.pointerId)) {
    canvas.releasePointerCapture(e.pointerId);
  }
  if (currentStroke && currentStroke.length >= 2) {
    strokes.push(currentStroke);
  }
  currentStroke = null;
  redrawCanvas();
  scheduleScore();
}

/** Index into ALL_LETTERS for a display character (e.g. "A"). */
export function findLetterIndex(letter: string): number {
  const ch = letter.trim().charAt(0);
  const idx = ALL_LETTERS.findIndex((l) => l.letter === ch);
  return idx >= 0 ? idx : 0;
}

function setCurrentLetter(letter: string, isUppercase: boolean): void {
  currentLetter = letter;
  currentIsUppercase = isUppercase;
  updateTargetHints();
}

export function initLetterWritingUi(callbacks: LetterWritingCallbacks = {}): void {
  onAttemptLogged = callbacks.onAttemptLogged;

  canvas = $('letterWritingCanvas') as HTMLCanvasElement;
  ctx = canvas.getContext('2d');
  if (!ctx) return;

  const touch = deviceUsesTouch();
  $('letterWritingHint').textContent = touch
    ? 'Use your finger to write on the lines.'
    : 'Use the mouse to write on the lines.';

  canvas.style.touchAction = 'none';
  attemptStartTime = Date.now();

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
  const letter = item.display.trim().charAt(0) || 'A';
  const isUppercase = letter === letter.toUpperCase();
  setCurrentLetter(letter, isUppercase);
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
  cancelScoreTimer();
}
