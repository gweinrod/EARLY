import type { CurriculumStageId } from './curriculum';

export interface PublishedModelManifest {
  version: number;
  stageId: string;
  modelUrl: string;
  trainedAt: string;
  sampleCount?: number;
}

/** Float manifest versions (0.9, 0.91, …); major releases use 1.0, 2.0, … */
const VERSION_KEY = (stageId: string) => `early.publishedModel.v2.${stageId}`;

/** Legacy integer manifests (1–9) map to 0.1–0.9 for comparison. */
export function normalizeManifestVersion(raw: number): number {
  const v = Number(raw);
  if (!Number.isFinite(v)) return 0;
  if (v >= 1 && v < 10 && Number.isInteger(v)) return Math.round((v / 10) * 100) / 100;
  return Math.round(v * 100) / 100;
}

export function formatPublishedModelVersion(version: number): string {
  const v = normalizeManifestVersion(version);
  if (Math.abs(v - Math.round(v)) < 1e-6) return v.toFixed(1);
  return String(parseFloat(v.toFixed(2)));
}

export function getStoredPublishedVersion(stageId: CurriculumStageId): number {
  const raw = localStorage.getItem(VERSION_KEY(stageId));
  if (!raw) return 0;
  return normalizeManifestVersion(parseFloat(raw));
}

export function setStoredPublishedVersion(stageId: CurriculumStageId, version: number): void {
  localStorage.setItem(VERSION_KEY(stageId), String(normalizeManifestVersion(version)));
}

export async function fetchPublishedManifest(
  stageId: CurriculumStageId,
): Promise<PublishedModelManifest | null> {
  try {
    const res = await fetch(`/models/${stageId}/manifest.json`, { cache: 'no-store' });
    if (!res.ok) return null;
    const m = (await res.json()) as PublishedModelManifest;
    if (m.stageId !== stageId || !m.modelUrl || typeof m.version !== 'number') return null;
    return { ...m, version: normalizeManifestVersion(m.version) };
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
