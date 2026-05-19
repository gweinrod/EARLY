import type { CurriculumStageId } from './curriculum';
import type { DspPrediction } from './dsp-predict';
import type { FeedbackItem } from './feedback';

export type ScoringBasis = 'dsp_tf' | 'heuristic' | 'asr' | 'asr_only';

/** Any explicit pass/fail from DSP heuristics (not info/warn). */
export function heuristicVerdict(items: FeedbackItem[]): boolean | null {
  const judged = items.filter((i) => i.t === 'pass' || i.t === 'fail');
  if (!judged.length) return null;
  if (judged.some((i) => i.t === 'fail')) return false;
  return true;
}

/**
 * Student pass/fail: DSP match wins; if DSP fails but ASR heard the target, count as pass and train from that.
 */
export function deriveAppPass(
  asrPass: boolean,
  dsp: Pick<DspPrediction, 'dspPass' | 'heuristicPass' | 'tf'> & { guessedKey?: string | null },
  targetKey: string,
  _stageId: CurriculumStageId = 'alphabet',
): { appPass: boolean; basis: ScoringBasis } {
  const t = targetKey.toLowerCase();
  const guess = dsp.tf?.guessedKey ?? dsp.guessedKey ?? null;

  if (dsp.dspPass) {
    if (dsp.tf && dsp.tf.confidence >= 0.22 && guess === t) {
      return { appPass: true, basis: 'dsp_tf' };
    }
    return { appPass: true, basis: 'heuristic' };
  }

  if (asrPass) {
    return { appPass: true, basis: 'asr' };
  }

  if (dsp.tf && dsp.tf.confidence >= 0.22) {
    return { appPass: guess === t, basis: 'dsp_tf' };
  }
  if (dsp.heuristicPass !== null) {
    return { appPass: dsp.dspPass, basis: 'heuristic' };
  }
  return { appPass: false, basis: 'asr' };
}
