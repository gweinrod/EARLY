import { EMBEDDING_DIM, extractFrames, extractSilenceEmbedding, type Frame } from './dsp';

/** ~300ms of digital silence through the same landmark pipeline as speech. */
export function syntheticSilenceEmbedding(sampleRate = 48_000): number[] {
  const audio = new Array(Math.floor(sampleRate * 0.3)).fill(0);
  const frames = extractFrames(audio, sampleRate);
  if (frames.length < 4) return new Array(EMBEDDING_DIM).fill(0);
  return extractSilenceEmbedding(frames) ?? new Array(EMBEDDING_DIM).fill(0);
}

export function silenceEmbeddingFromFrames(frames: Frame[]): number[] | null {
  if (frames.length < 4) return null;
  return extractSilenceEmbedding(frames);
}
