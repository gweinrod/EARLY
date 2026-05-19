import { extractFrames, extractNucleusMfcc, type Frame } from './dsp';

export interface ReferenceFeatures {
  url: string;
  sampleRate: number;
  frameCount: number;
  nucleusMfcc: number[] | null;
  frames: Frame[];
}

/**
 * Decode a reference audio file via OfflineAudioContext and extract MFCC features.
 * Used to build training benchmarks (Phase 1 pipeline).
 */
export async function analyzeReferenceAudio(
  url: string,
  sampleRate = 44100,
): Promise<ReferenceFeatures> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load reference audio: ${url} (${response.status})`);
  }
  const arrayBuffer = await response.arrayBuffer();

  const offline = new OfflineAudioContext(1, sampleRate * 10, sampleRate);
  const decoded = await offline.decodeAudioData(arrayBuffer.slice(0));

  const channel = decoded.getChannelData(0);
  const audio = Array.from(channel);
  const frames = extractFrames(audio, decoded.sampleRate);
  const nucleusMfcc = extractNucleusMfcc(frames);

  return {
    url,
    sampleRate: decoded.sampleRate,
    frameCount: frames.length,
    nucleusMfcc,
    frames,
  };
}

/** Log feature summary for all reference files (dev console). */
export async function analyzeReferenceCatalog(paths: string[]): Promise<ReferenceFeatures[]> {
  const results: ReferenceFeatures[] = [];
  for (const path of paths) {
    try {
      const feat = await analyzeReferenceAudio(path);
      results.push(feat);
      console.info('[reference-offline]', path, {
        sr: feat.sampleRate,
        frames: feat.frameCount,
        nucleus: feat.nucleusMfcc?.map((v) => v.toFixed(2)),
      });
    } catch (err) {
      console.warn('[reference-offline] skip', path, err);
    }
  }
  return results;
}
