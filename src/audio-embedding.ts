import { buildRecordingBlob } from './recorder';
import { extractEmbedding, extractFrames, extractSilenceEmbedding, type Frame } from './dsp';

export async function embeddingFromRecording(
  audioCtx: AudioContext,
  recChunks: Blob[],
): Promise<{ embedding: number[]; frames: Frame[] } | null> {
  if (!recChunks.length) return null;
  const blob = buildRecordingBlob(recChunks);
  const ab = await blob.arrayBuffer();
  const decoded = await audioCtx.decodeAudioData(ab.slice(0));
  const audio = Array.from(decoded.getChannelData(0));
  const frames = extractFrames(audio, decoded.sampleRate);
  if (frames.length < 4) return null;
  const embedding = extractEmbedding(frames);
  if (!embedding) return null;
  return { embedding, frames };
}

/** Quiet-room capture for the silence DSP class (all frames, not voiced-only). */
export async function silenceEmbeddingFromRecording(
  audioCtx: AudioContext,
  recChunks: Blob[],
): Promise<{ embedding: number[]; frames: Frame[] } | null> {
  if (!recChunks.length) return null;
  const blob = buildRecordingBlob(recChunks);
  const ab = await blob.arrayBuffer();
  const decoded = await audioCtx.decodeAudioData(ab.slice(0));
  const audio = Array.from(decoded.getChannelData(0));
  const frames = extractFrames(audio, decoded.sampleRate);
  if (frames.length < 4) return null;
  const embedding = extractSilenceEmbedding(frames);
  if (!embedding) return null;
  return { embedding, frames };
}
