import { VC, W2C } from './data';
import { type Frame, extractEmbedding, extractSilenceEmbedding } from './dsp';
import { heuristicFeedback, type FeedbackItem } from './feedback';
import { heuristicVerdict } from './scoring';
import {
  initTfPhonemeModel,
  isTfPredictBusy,
  isTfReady,
  predictWordForTarget,
  type TfInitResult,
  type TfWordPrediction,
} from './tf-phoneme';
import type { CurriculumStageId } from './curriculum';
import { formatVocabKeyForDisplay, isSilenceVocabKey } from './word-vocabulary';

export interface DspPrediction {
  embedding: number[] | null;
  heuristicItems: FeedbackItem[];
  heuristicPass: boolean | null;
  tf: TfWordPrediction | null;
  guessedWord: string | null;
  guessConfidence: number;
  targetProbability: number;
  summary: string;
  dspPass: boolean;
}

const TF_CONFIDENCE_MIN = 0.22;
/** Below this peak frame RMS, treat as silence (skip TF letter guess). */
const PEAK_RMS_SILENCE_MAX = 0.014;

function formatTfLine(tf: TfWordPrediction, targetKey: string): string {
  const guessLabel = formatVocabKeyForDisplay(tf.guessedKey);
  const alt = tf.top3
    .filter((t) => t.key !== tf.guessedKey)
    .slice(0, 2)
    .map((t) => `${formatVocabKeyForDisplay(t.key)} ${Math.round(t.probability * 100)}%`)
    .join(', ');
  const pct = Math.round(tf.confidence * 100);
  const targetPct = Math.round(tf.targetProbability * 100);
  let line = `DSP heard “${guessLabel}” (${pct}%)`;
  if (tf.guessedKey !== targetKey) {
    line += ` · target “${targetKey}” at ${targetPct}%`;
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

export async function ensureDspEngine(stageId: CurriculumStageId): Promise<TfInitResult> {
  return initTfPhonemeModel(stageId);
}

function peakFrameRms(frames: Frame[]): number {
  if (!frames.length) return 0;
  return Math.max(...frames.map((f) => f.rms));
}

export function runDspPrediction(
  frames: Frame[],
  targetKey: string,
  groupKey: string,
): DspPrediction {
  const peakRms = peakFrameRms(frames);
  const likelySilence = peakRms < PEAK_RMS_SILENCE_MAX;

  const embedding = likelySilence ? extractSilenceEmbedding(frames) : extractEmbedding(frames);
  const heuristicItems = heuristicFeedback(frames, targetKey, groupKey);
  const heuristicPass = heuristicVerdict(heuristicItems);

  let tf: TfWordPrediction | null = null;
  if (embedding && isTfReady() && !isTfPredictBusy() && !likelySilence) {
    tf = predictWordForTarget(embedding, targetKey);
  }

  const quietTake =
    likelySilence ||
    (tf !== null && isSilenceVocabKey(tf.guessedKey) && tf.confidence >= TF_CONFIDENCE_MIN);

  const guessedWord = quietTake ? '' : (tf?.guessedKey ?? null);
  const guessConfidence = quietTake ? 0 : (tf?.confidence ?? 0);
  const targetProbability = quietTake ? 0 : (tf?.targetProbability ?? 0);

  const tfSaysTarget =
    !quietTake &&
    tf !== null &&
    !isSilenceVocabKey(tf.guessedKey) &&
    tf.guessedKey === targetKey.toLowerCase() &&
    tf.confidence >= TF_CONFIDENCE_MIN;

  const tfSaysOther =
    !quietTake &&
    tf !== null &&
    !isSilenceVocabKey(tf.guessedKey) &&
    tf.guessedKey !== targetKey.toLowerCase() &&
    tf.confidence >= TF_CONFIDENCE_MIN;

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
  if (tf) {
    parts.unshift(formatTfLine(tf, targetKey));
  } else if (isTfPredictBusy()) {
    parts.unshift('DSP neural net: updating from your last judgment — wait a moment');
  } else if (!isTfReady()) {
    parts.unshift(
      'DSP neural net: classroom model not loaded — teacher publishes shared model or records one-time voice seed',
    );
  } else if (!embedding) {
    parts.unshift('DSP: recording too quiet or too short — try again, speak a bit longer');
  } else {
    parts.unshift('DSP neural net: could not classify this take');
  }

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
