import type { Stroke } from './letter-writing-data';

export const RASTER_SIZE = 64;

/** Flat grayscale raster: ink = 1, background = 0 (length RASTER_SIZE²). */
export function rasterizeStrokes(strokes: Stroke[]): Float32Array {
  const size = RASTER_SIZE;
  const out = new Float32Array(size * size);
  if (!strokes.length || strokes.every((s) => s.length === 0)) return out;

  const points = strokes.flat();
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  let minX = Math.min(...xs);
  let maxX = Math.max(...xs);
  let minY = Math.min(...ys);
  let maxY = Math.max(...ys);
  const pad = 0.08;
  const w = Math.max(maxX - minX, 0.05);
  const h = Math.max(maxY - minY, 0.05);
  minX -= w * pad;
  maxX += w * pad;
  minY -= h * pad;
  maxY += h * pad;

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return out;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = Math.max(2, size * 0.09);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const toPx = (p: { x: number; y: number }) => ({
    x: ((p.x - minX) / (maxX - minX)) * (size - 4) + 2,
    y: ((p.y - minY) / (maxY - minY)) * (size - 4) + 2,
  });

  for (const stroke of strokes) {
    if (stroke.length < 2) continue;
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
