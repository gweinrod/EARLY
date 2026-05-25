/**
 * letter-writing-scoring.ts
 *
 * Extracts geometric features from raw strokes and applies per-letter
 * heuristic rules to produce a pass/fail score and human-readable feedback.
 *
 * These heuristics are deliberately permissive — the primary goal is to
 * encourage the student and collect labelled data for future ML training,
 * not to be a strict handwriting judge.
 */

import type { Stroke, StrokePoint, LetterStrokeFeatures } from './letter-writing-data';

// ---------------------------------------------------------------------------
// Feature extraction
// ---------------------------------------------------------------------------

/** Euclidean distance between two normalised points. */
function dist(a: StrokePoint, b: StrokePoint): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

/** Angle in radians between two points (-π to π). */
function angle(a: StrokePoint, b: StrokePoint): number {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

/** Map an angle in radians to one of 8 directional bins. */
function angleToBin(rad: number): number {
  // Rotate by π/8 so bins are centred on cardinal / diagonal directions
  const shifted = ((rad + Math.PI / 8) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
  return Math.floor(shifted / (Math.PI / 4));
}

/**
 * Extract a fixed-length feature vector from raw strokes.
 *
 * @param strokes   Array of strokes (each already normalised 0-1).
 * @param startTime ms timestamp of first stroke start (for duration).
 */
export function extractStrokeFeatures(
  strokes: Stroke[],
  startTime: number,
): LetterStrokeFeatures {
  if (strokes.length === 0 || strokes.every((s) => s.length === 0)) {
    return emptyFeatures();
  }

  const allPoints = strokes.flat();

  // Bounding box
  const xs = allPoints.map((p) => p.x);
  const ys = allPoints.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const bboxW = maxX - minX;
  const bboxH = maxY - minY;

  // Total ink length (normalised by diagonal = √2 for 1×1 canvas)
  let totalInk = 0;
  const dirHist: [number, number, number, number, number, number, number, number] =
    [0, 0, 0, 0, 0, 0, 0, 0];
  let totalSegments = 0;
  let totalCurvature = 0;
  let curvatureCount = 0;

  for (const stroke of strokes) {
    for (let i = 1; i < stroke.length; i++) {
      const seg = dist(stroke[i - 1], stroke[i]);
      totalInk += seg;
      if (seg > 0.002) {
        // Only count segments long enough to have direction
        const bin = angleToBin(angle(stroke[i - 1], stroke[i]));
        dirHist[bin]++;
        totalSegments++;
      }
      if (i >= 2 && stroke[i - 2]) {
        const a1 = angle(stroke[i - 2], stroke[i - 1]);
        const a2 = angle(stroke[i - 1], stroke[i]);
        let da = Math.abs(a2 - a1);
        if (da > Math.PI) da = 2 * Math.PI - da;
        totalCurvature += da;
        curvatureCount++;
      }
    }
  }

  // Normalise direction histogram to fractions
  if (totalSegments > 0) {
    for (let i = 0; i < 8; i++) dirHist[i] /= totalSegments;
  }

  // Centre of mass
  const comX = allPoints.reduce((s, p) => s + p.x, 0) / allPoints.length;
  const comY = allPoints.reduce((s, p) => s + p.y, 0) / allPoints.length;

  // Upper-half ratio (above y=0.5)
  const upperHalfRatio = allPoints.filter((p) => p.y < 0.5).length / allPoints.length;

  // Start / end distance
  const first = strokes[0][0];
  const lastStroke = strokes[strokes.length - 1];
  const last = lastStroke[lastStroke.length - 1];
  const startEndDistNorm = first && last ? dist(first, last) : 0;

  // Duration
  const firstT = strokes[0][0]?.t ?? 0;
  const lastT = lastStroke[lastStroke.length - 1]?.t ?? 0;
  const durationMs = (lastT - firstT) + (Date.now() - startTime);

  return {
    strokeCount: strokes.length,
    totalInkNorm: totalInk / Math.SQRT2,
    bboxW,
    bboxH,
    aspectRatio: bboxH > 0 ? bboxW / bboxH : 0,
    coverageFraction: bboxH,    // already 0-1 (fraction of canvas height)
    xSpanFraction: bboxW,
    comX,
    comY,
    upperHalfRatio,
    startEndDistNorm,
    dirHist,
    meanCurvature: curvatureCount > 0 ? totalCurvature / curvatureCount : 0,
    durationMs,
  };
}

function emptyFeatures(): LetterStrokeFeatures {
  return {
    strokeCount: 0,
    totalInkNorm: 0,
    bboxW: 0,
    bboxH: 0,
    aspectRatio: 0,
    coverageFraction: 0,
    xSpanFraction: 0,
    comX: 0.5,
    comY: 0.5,
    upperHalfRatio: 0.5,
    startEndDistNorm: 0,
    dirHist: [0, 0, 0, 0, 0, 0, 0, 0],
    meanCurvature: 0,
    durationMs: 0,
  };
}

// ---------------------------------------------------------------------------
// Per-letter rule definitions
// ---------------------------------------------------------------------------

/**
 * Mandatory crossbar/horizontal-stroke check (relative to the letter bbox).
 * Failing this is a hard fail — the student's pass is denied even if score and
 * ML model would otherwise accept (e.g. a triangle drawn for "A").
 */
export interface CrossbarRequirement {
  /** Vertical band where the crossbar must sit, as a fraction of letter bbox (0=top, 1=bottom). */
  yRange: [number, number];
  /** Minimum crossbar width as a fraction of letter bbox width. */
  minXSpanFraction: number;
  /** Maximum crossbar thickness as a fraction of letter bbox height. */
  maxThicknessFraction: number;
  /** Maximum |dy/dx| slope (0 = perfectly horizontal). */
  maxSlope: number;
  /** Feedback line shown when the crossbar is missing. */
  missingMessage: string;
}

interface LetterRule {
  /** Expected number of strokes [min, max]. */
  strokes: [number, number];
  /** Minimum coverage fraction (how tall the letter should be). */
  minCoverage: number;
  /** Aspect ratio range [min, max] (width/height). */
  aspectRatio: [number, number];
  /**
   * Whether the letter is generally "round" — high meanCurvature expected.
   * Used only for feedback messaging, not hard pass/fail.
   */
  isRound: boolean;
  /** Whether letter body stays below the midline (descenders like g, p, y). */
  hasDescender: boolean;
  /** Whether letter body rises above the midline (ascenders like b, d, h, k, l). */
  hasAscender: boolean;
  /** Human-readable stroke hint shown before drawing. */
  strokeHint: string;
  /** Hard requirement for a near-horizontal crossbar stroke (e.g. A, H, T, E, F). */
  crossbar?: CrossbarRequirement;
}

/** Rules indexed by letter (uppercase) */
const UPPER_RULES: Record<string, LetterRule> = {
  A: {
    strokes: [2, 3],
    minCoverage: 0.65,
    aspectRatio: [0.4, 1.1],
    isRound: false,
    hasDescender: false,
    hasAscender: true,
    strokeHint: 'Two diagonal lines meeting at the top, then a crossbar.',
    crossbar: {
      yRange: [0.30, 0.75],
      minXSpanFraction: 0.30,
      maxThicknessFraction: 0.30,
      maxSlope: 0.4,
      missingMessage:
        'A needs a horizontal crossbar near the dashed blue midline — draw it as a separate stroke.',
    },
  },
  B: { strokes: [2, 3], minCoverage: 0.65, aspectRatio: [0.4, 0.9], isRound: true,  hasDescender: false, hasAscender: true,  strokeHint: 'Straight line down, then two bumps on the right.' },
  C: { strokes: [1, 1], minCoverage: 0.60, aspectRatio: [0.5, 1.1], isRound: true,  hasDescender: false, hasAscender: true,  strokeHint: 'One curved stroke, open on the right.' },
  D: { strokes: [2, 2], minCoverage: 0.65, aspectRatio: [0.4, 0.9], isRound: true,  hasDescender: false, hasAscender: true,  strokeHint: 'Straight line down, then a big curve on the right.' },
  E: { strokes: [3, 4], minCoverage: 0.65, aspectRatio: [0.5, 1.2], isRound: false, hasDescender: false, hasAscender: true,  strokeHint: 'Straight line down, then three horizontal lines.' },
  F: { strokes: [2, 3], minCoverage: 0.65, aspectRatio: [0.4, 1.1], isRound: false, hasDescender: false, hasAscender: true,  strokeHint: 'Straight line down, then two horizontal lines at top and middle.' },
  G: { strokes: [1, 2], minCoverage: 0.60, aspectRatio: [0.5, 1.1], isRound: true,  hasDescender: false, hasAscender: true,  strokeHint: 'Like C, but with a short horizontal line going inward at the middle.' },
  H: { strokes: [2, 3], minCoverage: 0.65, aspectRatio: [0.5, 1.2], isRound: false, hasDescender: false, hasAscender: true,  strokeHint: 'Two tall lines connected by a crossbar in the middle.' },
  I: { strokes: [1, 3], minCoverage: 0.65, aspectRatio: [0.0, 0.5], isRound: false, hasDescender: false, hasAscender: true,  strokeHint: 'One vertical line (and optional serifs at top and bottom).' },
  J: { strokes: [1, 2], minCoverage: 0.65, aspectRatio: [0.1, 0.7], isRound: true,  hasDescender: true,  hasAscender: true,  strokeHint: 'A line that curves to the left at the bottom.' },
  K: { strokes: [2, 3], minCoverage: 0.65, aspectRatio: [0.4, 1.1], isRound: false, hasDescender: false, hasAscender: true,  strokeHint: 'Straight line down, then two diagonal lines touching the middle.' },
  L: { strokes: [1, 2], minCoverage: 0.65, aspectRatio: [0.3, 0.9], isRound: false, hasDescender: false, hasAscender: true,  strokeHint: 'Straight line down, then a short line to the right at the bottom.' },
  M: { strokes: [1, 4], minCoverage: 0.65, aspectRatio: [0.5, 1.4], isRound: false, hasDescender: false, hasAscender: true,  strokeHint: 'Two tall lines with a V shape between them at the top.' },
  N: { strokes: [1, 3], minCoverage: 0.65, aspectRatio: [0.4, 1.2], isRound: false, hasDescender: false, hasAscender: true,  strokeHint: 'Two tall lines connected by a diagonal.' },
  O: { strokes: [1, 2], minCoverage: 0.60, aspectRatio: [0.5, 1.2], isRound: true,  hasDescender: false, hasAscender: true,  strokeHint: 'One smooth closed oval.' },
  P: { strokes: [2, 2], minCoverage: 0.65, aspectRatio: [0.3, 0.9], isRound: true,  hasDescender: false, hasAscender: true,  strokeHint: 'Straight line down, then one bump on the upper right.' },
  Q: { strokes: [2, 2], minCoverage: 0.60, aspectRatio: [0.5, 1.2], isRound: true,  hasDescender: false, hasAscender: true,  strokeHint: 'A circle with a small diagonal tail at the lower right.' },
  R: { strokes: [2, 3], minCoverage: 0.65, aspectRatio: [0.4, 1.0], isRound: true,  hasDescender: false, hasAscender: true,  strokeHint: 'Like P but with a diagonal leg kicking right.' },
  S: { strokes: [1, 1], minCoverage: 0.60, aspectRatio: [0.4, 1.0], isRound: true,  hasDescender: false, hasAscender: true,  strokeHint: 'One curvy stroke — like two half-circles in opposite directions.' },
  T: { strokes: [2, 2], minCoverage: 0.65, aspectRatio: [0.5, 1.5], isRound: false, hasDescender: false, hasAscender: true,  strokeHint: 'A tall line with a horizontal line across the top.' },
  U: { strokes: [1, 2], minCoverage: 0.60, aspectRatio: [0.4, 1.1], isRound: true,  hasDescender: false, hasAscender: true,  strokeHint: 'Two tall lines joined by a curve at the bottom.' },
  V: { strokes: [1, 2], minCoverage: 0.65, aspectRatio: [0.5, 1.3], isRound: false, hasDescender: false, hasAscender: true,  strokeHint: 'Two diagonal lines meeting at a point at the bottom.' },
  W: { strokes: [1, 4], minCoverage: 0.65, aspectRatio: [0.7, 2.0], isRound: false, hasDescender: false, hasAscender: true,  strokeHint: 'Like two V shapes side by side.' },
  X: { strokes: [2, 2], minCoverage: 0.65, aspectRatio: [0.5, 1.3], isRound: false, hasDescender: false, hasAscender: true,  strokeHint: 'Two diagonal lines crossing in the middle.' },
  Y: { strokes: [2, 3], minCoverage: 0.65, aspectRatio: [0.4, 1.2], isRound: false, hasDescender: true,  hasAscender: true,  strokeHint: 'A V on top with a line dropping down from the centre.' },
  Z: { strokes: [1, 3], minCoverage: 0.65, aspectRatio: [0.5, 1.5], isRound: false, hasDescender: false, hasAscender: true,  strokeHint: 'Top line, then a diagonal down-left, then bottom line.' },
};

/** Rules indexed by letter (lowercase). */
const LOWER_RULES: Record<string, LetterRule> = {
  a: { strokes: [1, 2], minCoverage: 0.30, aspectRatio: [0.5, 1.4], isRound: true,  hasDescender: false, hasAscender: false, strokeHint: 'A small circle then a short line on the right.' },
  b: { strokes: [1, 2], minCoverage: 0.55, aspectRatio: [0.4, 1.0], isRound: true,  hasDescender: false, hasAscender: true,  strokeHint: 'A tall line down, then a bump on the right.' },
  c: { strokes: [1, 1], minCoverage: 0.30, aspectRatio: [0.5, 1.2], isRound: true,  hasDescender: false, hasAscender: false, strokeHint: 'Small open curve facing right.' },
  d: { strokes: [1, 2], minCoverage: 0.55, aspectRatio: [0.4, 1.0], isRound: true,  hasDescender: false, hasAscender: true,  strokeHint: 'A small circle, then a tall line on the right.' },
  e: { strokes: [1, 1], minCoverage: 0.30, aspectRatio: [0.5, 1.3], isRound: true,  hasDescender: false, hasAscender: false, strokeHint: 'A small loop — start at the middle, curve around and open left.' },
  f: { strokes: [1, 2], minCoverage: 0.55, aspectRatio: [0.2, 0.8], isRound: true,  hasDescender: false, hasAscender: true,  strokeHint: 'A curved top, then a long line down, then a crossbar.' },
  g: { strokes: [1, 2], minCoverage: 0.45, aspectRatio: [0.4, 1.1], isRound: true,  hasDescender: true,  hasAscender: false, strokeHint: 'A small circle, then a line dropping below the baseline and curling left.' },
  h: { strokes: [1, 2], minCoverage: 0.55, aspectRatio: [0.4, 1.0], isRound: true,  hasDescender: false, hasAscender: true,  strokeHint: 'Tall line down, then a hump on the right from midway.' },
  i: { strokes: [1, 2], minCoverage: 0.30, aspectRatio: [0.0, 0.4], isRound: false, hasDescender: false, hasAscender: false, strokeHint: 'Short line, then a dot above.' },
  j: { strokes: [1, 2], minCoverage: 0.40, aspectRatio: [0.0, 0.5], isRound: true,  hasDescender: true,  hasAscender: false, strokeHint: 'Short line curving left below the baseline, then a dot above.' },
  k: { strokes: [2, 3], minCoverage: 0.55, aspectRatio: [0.4, 1.1], isRound: false, hasDescender: false, hasAscender: true,  strokeHint: 'Tall line, then two diagonal strokes touching the middle.' },
  l: { strokes: [1, 1], minCoverage: 0.55, aspectRatio: [0.0, 0.4], isRound: false, hasDescender: false, hasAscender: true,  strokeHint: 'One tall straight line.' },
  m: { strokes: [1, 3], minCoverage: 0.30, aspectRatio: [0.7, 2.0], isRound: true,  hasDescender: false, hasAscender: false, strokeHint: 'Two humps side by side (wider than other letters).' },
  n: { strokes: [1, 2], minCoverage: 0.30, aspectRatio: [0.4, 1.2], isRound: true,  hasDescender: false, hasAscender: false, strokeHint: 'One hump — line down then arch right and down.' },
  o: { strokes: [1, 2], minCoverage: 0.30, aspectRatio: [0.6, 1.3], isRound: true,  hasDescender: false, hasAscender: false, strokeHint: 'A closed oval.' },
  p: { strokes: [1, 2], minCoverage: 0.45, aspectRatio: [0.4, 1.0], isRound: true,  hasDescender: true,  hasAscender: false, strokeHint: 'Line dropping below baseline, with a bump on the upper right.' },
  q: { strokes: [1, 2], minCoverage: 0.45, aspectRatio: [0.4, 1.0], isRound: true,  hasDescender: true,  hasAscender: false, strokeHint: 'Small circle, then a line dropping below baseline to the right.' },
  r: { strokes: [1, 2], minCoverage: 0.30, aspectRatio: [0.2, 0.8], isRound: true,  hasDescender: false, hasAscender: false, strokeHint: 'Line down then a small hook curving right at the top.' },
  s: { strokes: [1, 1], minCoverage: 0.30, aspectRatio: [0.4, 1.1], isRound: true,  hasDescender: false, hasAscender: false, strokeHint: 'Small S-curve.' },
  t: { strokes: [1, 2], minCoverage: 0.50, aspectRatio: [0.3, 1.0], isRound: false, hasDescender: false, hasAscender: true,  strokeHint: 'Tall line (just above midline), then a crossbar at the midline.' },
  u: { strokes: [1, 2], minCoverage: 0.30, aspectRatio: [0.4, 1.2], isRound: true,  hasDescender: false, hasAscender: false, strokeHint: 'Two lines joined by a curve at the bottom.' },
  v: { strokes: [1, 2], minCoverage: 0.30, aspectRatio: [0.5, 1.4], isRound: false, hasDescender: false, hasAscender: false, strokeHint: 'Two diagonals meeting at a point at the bottom.' },
  w: { strokes: [1, 4], minCoverage: 0.30, aspectRatio: [0.8, 2.2], isRound: false, hasDescender: false, hasAscender: false, strokeHint: 'Like two small v shapes side by side.' },
  x: { strokes: [2, 2], minCoverage: 0.30, aspectRatio: [0.5, 1.4], isRound: false, hasDescender: false, hasAscender: false, strokeHint: 'Two short diagonals crossing.' },
  y: { strokes: [1, 2], minCoverage: 0.40, aspectRatio: [0.4, 1.2], isRound: false, hasDescender: true,  hasAscender: false, strokeHint: 'V on top, then the right leg continues below the baseline.' },
  z: { strokes: [1, 3], minCoverage: 0.30, aspectRatio: [0.5, 1.6], isRound: false, hasDescender: false, hasAscender: false, strokeHint: 'Top line, diagonal down-left, then bottom line.' },
};

export function getLetterRule(letter: string, isUppercase: boolean): LetterRule | null {
  const key = isUppercase ? letter.toUpperCase() : letter.toLowerCase();
  return isUppercase ? (UPPER_RULES[key] ?? null) : (LOWER_RULES[key] ?? null);
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export interface ScoringResult {
  score: number;        // 0-100
  pass: boolean;
  feedback: string[];   // human-readable feedback items
  warnings: string[];   // soft hints (not counted against pass)
  /**
   * True when a structural requirement (e.g. missing A crossbar) failed.
   * Caller should deny the student's pass regardless of score or ML prediction.
   */
  hardFail: boolean;
}

/**
 * Look for a near-horizontal "crossbar" stroke that satisfies the requirement.
 * A whole stroke qualifies when its own bbox is thin, wide enough, low-slope,
 * and centered in the required vertical band (relative to the letter bbox).
 */
function hasCrossbar(strokes: Stroke[], req: CrossbarRequirement): boolean {
  const allPoints = strokes.flat();
  if (allPoints.length < 2) return false;

  let lminX = Infinity, lmaxX = -Infinity, lminY = Infinity, lmaxY = -Infinity;
  for (const p of allPoints) {
    if (p.x < lminX) lminX = p.x;
    if (p.x > lmaxX) lmaxX = p.x;
    if (p.y < lminY) lminY = p.y;
    if (p.y > lmaxY) lmaxY = p.y;
  }
  const letterW = Math.max(lmaxX - lminX, 1e-6);
  const letterH = Math.max(lmaxY - lminY, 1e-6);
  const yMinAbs = lminY + req.yRange[0] * letterH;
  const yMaxAbs = lminY + req.yRange[1] * letterH;

  for (const stroke of strokes) {
    if (stroke.length < 2) continue;
    let sMinX = Infinity, sMaxX = -Infinity, sMinY = Infinity, sMaxY = -Infinity;
    for (const p of stroke) {
      if (p.x < sMinX) sMinX = p.x;
      if (p.x > sMaxX) sMaxX = p.x;
      if (p.y < sMinY) sMinY = p.y;
      if (p.y > sMaxY) sMaxY = p.y;
    }
    const sW = sMaxX - sMinX;
    const sH = sMaxY - sMinY;
    const midY = (sMinY + sMaxY) / 2;

    if (sW < req.minXSpanFraction * letterW) continue;
    if (sH > req.maxThicknessFraction * letterH) continue;
    if (midY < yMinAbs || midY > yMaxAbs) continue;

    const slope = sW > 0 ? sH / sW : Infinity;
    if (slope > req.maxSlope) continue;

    return true;
  }
  return false;
}

/**
 * Score a writing attempt.
 *
 * Scoring breakdown (100 pts):
 *   30 pts — coverage (letter fills appropriate height of the zone)
 *   30 pts — stroke count within expected range
 *   20 pts — minimum ink (student actually drew something)
 *   20 pts — aspect ratio reasonable
 */
export function scoreLetterAttempt(
  letter: string,
  isUppercase: boolean,
  features: LetterStrokeFeatures,
  strokes: Stroke[] = [],
): ScoringResult {
  const feedback: string[] = [];
  const warnings: string[] = [];
  let score = 0;

  // Trivial reject — nothing drawn
  if (features.strokeCount === 0 || features.totalInkNorm < 0.02) {
    return {
      score: 0,
      pass: false,
      feedback: ['Nothing was drawn yet — give it a try!'],
      warnings: [],
      hardFail: false,
    };
  }

  const rule = getLetterRule(letter, isUppercase);
  if (!rule) {
    score = features.totalInkNorm > 0.05 ? 70 : 30;
    return { score, pass: score >= 60, feedback: [], warnings: [], hardFail: false };
  }

  // --- Coverage (30 pts) ---
  if (features.coverageFraction >= rule.minCoverage) {
    score += 30;
  } else if (features.coverageFraction >= rule.minCoverage * 0.7) {
    score += 15;
    warnings.push(`Try to make the letter ${isUppercase ? 'taller' : 'fill more of the writing zone'}.`);
  } else {
    feedback.push(`The letter is too small — try to fill the writing lines.`);
  }

  // --- Stroke count (30 pts) ---
  const [minS, maxS] = rule.strokes;
  if (features.strokeCount >= minS && features.strokeCount <= maxS) {
    score += 30;
  } else if (features.strokeCount < minS) {
    const missing = minS - features.strokeCount;
    score += 10;
    feedback.push(
      `${letter} needs ${minS === maxS ? minS : `${minS}–${maxS}`} stroke${minS > 1 ? 's' : ''} — it looks like ${missing} part${missing > 1 ? 's are' : ' is'} missing.`,
    );
  } else {
    // Too many strokes — partial credit
    score += 15;
    warnings.push(`Try to write ${letter} in ${minS === maxS ? minS : `${minS}–${maxS}`} stroke${minS > 1 ? 's' : ''}.`);
  }

  // --- Ink density (20 pts) ---
  // A reasonable letter has totalInkNorm in roughly 0.05–0.8
  if (features.totalInkNorm >= 0.06) {
    score += 20;
  } else if (features.totalInkNorm >= 0.03) {
    score += 10;
    warnings.push('Try to write more confidently with clearer lines.');
  } else {
    feedback.push('The strokes are very short — try writing larger.');
  }

  // --- Aspect ratio (20 pts) ---
  const [minAR, maxAR] = rule.aspectRatio;
  if (features.aspectRatio >= minAR && features.aspectRatio <= maxAR) {
    score += 20;
  } else if (features.aspectRatio > 0) {
    score += 8;
    if (features.aspectRatio < minAR) {
      warnings.push(`${letter} looks a bit narrow — try making it wider.`);
    } else {
      warnings.push(`${letter} looks a bit wide — try making it taller.`);
    }
  }

  let hardFail = false;
  if (rule.crossbar && strokes.length > 0 && !hasCrossbar(strokes, rule.crossbar)) {
    hardFail = true;
    feedback.unshift(rule.crossbar.missingMessage);
  }

  const pass = !hardFail && score >= 60;
  if (pass && feedback.length === 0) {
    feedback.push(`Great job writing ${letter}!`);
  } else if (!pass && !hardFail) {
    if (feedback.length === 0) {
      feedback.push(`Keep practising ${letter} — you're getting there!`);
    }
  }

  return { score, pass, feedback, warnings, hardFail };
}

/** Return the stroke hint for display before the student writes. */
export function getStrokeHint(letter: string, isUppercase: boolean): string {
  const rule = getLetterRule(letter, isUppercase);
  return rule?.strokeHint ?? '';
}

/** Return expected stroke count string, e.g. "2 strokes" or "2–3 strokes". */
export function expectedStrokes(letter: string, isUppercase: boolean): string {
  const rule = getLetterRule(letter, isUppercase);
  if (!rule) return '';
  const [min, max] = rule.strokes;
  return min === max ? `${min} stroke${min > 1 ? 's' : ''}` : `${min}–${max} strokes`;
}
