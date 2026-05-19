import type { FeedbackItem } from './feedback';

export type ScoringBasis = 'heuristic' | 'asr' | 'asr_only';

/** Any explicit pass/fail from DSP heuristics (not info/warn). */
export function heuristicVerdict(items: FeedbackItem[]): boolean | null {
  const judged = items.filter((i) => i.t === 'pass' || i.t === 'fail');
  if (!judged.length) return null;
  if (judged.some((i) => i.t === 'fail')) return false;
  return true;
}

/**
 * Classroom scoring: trust acoustic heuristics when available, ASR only as fallback.
 * Month-one path toward ML — session logs keep both signals for training.
 */
export function deriveAppPass(
  asrPass: boolean,
  heuristicItems: FeedbackItem[],
): { appPass: boolean; basis: ScoringBasis } {
  const h = heuristicVerdict(heuristicItems);
  if (h !== null) {
    return { appPass: h, basis: 'heuristic' };
  }
  return { appPass: asrPass, basis: 'asr' };
}
