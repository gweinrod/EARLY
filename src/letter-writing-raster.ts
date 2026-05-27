import type { Stroke } from './letter-writing-data';

export const RASTER_SIZE = 64;

/**
 * Flat grayscale raster: ink = 1, background = 0 (length RASTER_SIZE²).
 *
 * Strokes carry canvas-normalised (0..1) coordinates, so they are rendered
 * onto the raster **in their canvas position** — NOT renormalised to fill
 * the frame. That preservation of position is what lets the CNN distinguish
 * letters whose shape is identical but whose size or vertical placement
 * differs by case (O vs o, C vs c, P vs p, etc.).
 *
 * Aspect ratio: the writing canvas is taller than it is wide (~0.77
 * width/height), so strokes are slightly stretched horizontally in the
 * square raster. That stretch is applied consistently to both training
 * seed/judgments and inference inputs, so the model is unaffected.
 */
export function rasterizeStrokes(strokes: Stroke[]): Float32Array {
  const size = RASTER_SIZE;
  const out = new Float32Array(size * size);
  if (!strokes.length || strokes.every((s) => s.length === 0)) return out;

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return out;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = Math.max(2, size * 0.05);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
  const toPx = (p: { x: number; y: number }) => ({
    x: clamp01(p.x) * (size - 1),
    y: clamp01(p.y) * (size - 1),
  });

  for (const stroke of strokes) {
    if (stroke.length < 2) {
      // Render a single dot so very short pen-down events still leave ink.
      if (stroke.length === 1) {
        const p = toPx(stroke[0]);
        ctx.beginPath();
        ctx.arc(p.x, p.y, ctx.lineWidth / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      continue;
    }
    const start = toPx(stroke[0]);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    for (let i = 1; i < stroke.length; i++) {
      const pt = toPx(stroke[i]);
      ctx.lineTo(pt.x, pt.y);
    }
    ctx.stroke();
  }

  const imageData = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < size * size; i++) {
    const r = imageData.data[i * 4];
    out[i] = 1 - r / 255;
  }
  return out;
}
