import { VC, W2C } from './data';
import { type Frame, extractNucleusMfcc } from './dsp';
import { heuristicFeedback, type FeedbackItem } from './feedback';
import { heuristicVerdict } from './scoring';
import { initTfPhonemeModel, isTfReady, predictWordForTarget, type TfWordPrediction } from './tf-phoneme';

export interface DspPrediction {
  embedding: number[] | null;
  heuristicItems: FeedbackItem[];
  heuristicPass: boolean | null;
  tf: TfWordPrediction | null;
  /** Whole-word guess from TF.js classifier. */
  guessedWord: string | null;
  guessConfidence: number;
  /** Target word probability from TF. */
  targetProbability: number;
  /** Human-readable line for teacher UI. */
  summary: string;
  /** DSP pass: TF match to target when confident, else heuristics. */
  dspPass: boolean;
}

const TF_CONFIDENCE_MIN = 0.22;

function formatTfLine(tf: TfWordPrediction, targetWord: string): string {
  const alt = tf.top3
    .filter((t) => t.word !== tf.guessedWord)
    .slice(0, 2)
    .map((t) => `${t.word} ${Math.round(t.probability * 100)}%`)
    .join(', ');
  const pct = Math.round(tf.confidence * 100);
  const targetPct = Math.round(tf.targetProbability * 100);
  let line = `DSP heard “${tf.guessedWord}” (${pct}%)`;
  if (tf.guessedWord !== targetWord) {
    line += ` · target “${targetWord}” at ${targetPct}%`;
  }
  if (alt) line += ` · also ${alt}`;
  return line;
}

function heuristicSummary(items: FeedbackItem[]): string {
  const judged = items.filter((i) => i.t === 'pass' || i.t === 'fail');
  if (!judged.length) return 'Heuristics: no onset/vowel/coda rule for this take';
  const fail = judged.find((i) => i.t === 'fail');
  if (fail) return `Heuristics: fail — ${fail.s.slice(0, 80)}`;
  return `Heuristics: pass — ${judged[0].s.slice(0, 80)}`;
}

export async function ensureDspEngine(stageId: import('./curriculum').CurriculumStageId): Promise<void> {
  await initTfPhonemeModel(stageId);
}

export function runDspPrediction(
  frames: Frame[],
  targetKey: string,
  groupKey: string,
): DspPrediction {
  const embedding = extractNucleusMfcc(frames);
  const heuristicItems = heuristicFeedback(frames, targetKey, groupKey);
  const heuristicPass = heuristicVerdict(heuristicItems);

  let tf: TfWordPrediction | null = null;
  if (embedding && isTfReady()) {
    tf = predictWordForTarget(embedding, targetKey);
  }

  const guessedWord = tf?.guessedWord ?? null;
  const guessConfidence = tf?.confidence ?? 0;
  const targetProbability = tf?.targetProbability ?? 0;

  const tfSaysTarget =
    tf !== null &&
    tf.guessedKey === targetKey.toLowerCase() &&
    tf.confidence >= TF_CONFIDENCE_MIN;

  const tfSaysOther =
    tf !== null && tf.guessedKey !== targetKey.toLowerCase() && tf.confidence >= TF_CONFIDENCE_MIN;

  let dspPass: boolean;
  if (tfSaysTarget) {
    dspPass = true;
  } else if (tfSaysOther) {
    dspPass = false;
  } else if (heuristicPass !== null) {
    dspPass = heuristicPass;
  } else {
    dspPass = false;
  }

  const parts = [heuristicSummary(heuristicItems)];
  if (tf) parts.unshift(formatTfLine(tf, targetKey));
  else if (embedding) parts.unshift('DSP neural net: still loading…');
  else parts.unshift('DSP: no clear vowel nucleus in recording');

  if (W2C[targetKey] !== undefined) {
    const ci = W2C[targetKey];
    parts.push(`Vowel class label: ${VC[ci].label}`);
  }

  return {
    embedding,
    heuristicItems,
    heuristicPass,
    tf,
    guessedWord,
    guessConfidence,
    targetProbability,
    summary: parts.join('\n'),
    dspPass,
  };
}
