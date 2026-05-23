/** Keep in sync with src/letter-writing-raster.ts */
export const RASTER_SIZE = 64;

function rasterizeStrokesPure(strokes, minX, maxX, minY, maxY, size, out) {
  if (!out) out = new Float32Array(size * size);

  const toPx = (p) => ({
    x: ((p.x - minX) / (maxX - minX)) * (size - 4) + 2,
    y: ((p.y - minY) / (maxY - minY)) * (size - 4) + 2,
  });

  const lineWidth = Math.max(2, size * 0.09);
  const half = lineWidth / 2;

  const stampSegment = (x0, y0, x1, y1) => {
    const steps = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (y1 - y0) * t;
      const ix = Math.round(x);
      const iy = Math.round(y);
      for (let dy = -Math.ceil(half); dy <= Math.ceil(half); dy++) {
        for (let dx = -Math.ceil(half); dx <= Math.ceil(half); dx++) {
          const px = ix + dx;
          const py = iy + dy;
          if (px >= 0 && px < size && py >= 0 && py < size) {
            if (dx * dx + dy * dy <= half * half) {
              out[py * size + px] = 1;
            }
          }
        }
      }
    }
  };

  for (const stroke of strokes) {
    if (stroke.length < 2) continue;
    for (let i = 1; i < stroke.length; i++) {
      const a = toPx(stroke[i - 1]);
      const b = toPx(stroke[i]);
      stampSegment(a.x, a.y, b.x, b.y);
    }
  }
  return out;
}

/** @param {Array<Array<{x:number,y:number,t?:number}>>} strokes */
export function rasterizeStrokesNode(strokes) {
  const size = RASTER_SIZE;
  const out = new Float32Array(size * size);
  if (!strokes?.length || strokes.every((s) => !s.length)) return out;

  const points = strokes.flat();
  let minX = Math.min(...points.map((p) => p.x));
  let maxX = Math.max(...points.map((p) => p.x));
  let minY = Math.min(...points.map((p) => p.y));
  let maxY = Math.max(...points.map((p) => p.y));
  const pad = 0.08;
  const w = Math.max(maxX - minX, 0.05);
  const h = Math.max(maxY - minY, 0.05);
  minX -= w * pad;
  maxX += w * pad;
  minY -= h * pad;
  maxY += h * pad;

  return rasterizeStrokesPure(strokes, minX, maxX, minY, maxY, size, out);
}
