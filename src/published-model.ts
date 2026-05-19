import type { CurriculumStageId } from './curriculum';

export interface PublishedModelManifest {
  version: number;
  stageId: string;
  modelUrl: string;
  trainedAt: string;
  sampleCount?: number;
}

const VERSION_KEY = (stageId: string) => `early.publishedModel.${stageId}`;

export function getStoredPublishedVersion(stageId: CurriculumStageId): number {
  const raw = localStorage.getItem(VERSION_KEY(stageId));
  const n = raw ? parseInt(raw, 10) : 0;
  return Number.isFinite(n) ? n : 0;
}

export function setStoredPublishedVersion(stageId: CurriculumStageId, version: number): void {
  localStorage.setItem(VERSION_KEY(stageId), String(version));
}

export async function fetchPublishedManifest(
  stageId: CurriculumStageId,
): Promise<PublishedModelManifest | null> {
  try {
    const res = await fetch(`/models/${stageId}/manifest.json`, { cache: 'no-store' });
    if (!res.ok) return null;
    const m = (await res.json()) as PublishedModelManifest;
    if (m.stageId !== stageId || !m.modelUrl || typeof m.version !== 'number') return null;
    return m;
  } catch {
    return null;
  }
}

/** True if a newer shared model is available than this device has loaded. */
export async function hasNewerPublishedModel(stageId: CurriculumStageId): Promise<boolean> {
  const m = await fetchPublishedManifest(stageId);
  if (!m) return false;
  return m.version > getStoredPublishedVersion(stageId);
}
