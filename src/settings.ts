import type { CurriculumStageId } from './curriculum';
import {
  type CurriculumUnitId,
  defaultStageForUnit,
  isKnownStageId,
  isKnownUnitId,
  isStageInUnit,
  isUnitNavVisible,
  UNIT_NAV_VISIBLE,
} from './units';

/** Runtime flags for EARLY Student (classroom iPad vs developer debug). */

export interface AppSettings {
  /** Show MFCC heatmap, NN bars, technical feedback (off in classroom). */
  showMlDebug: boolean;
  /** Teacher tools: debug, seeds, judgments (off = student mode). */
  teacherMode: boolean;
  /** @deprecated Use teacherMode. Loaded for migration only. */
  collectorMode?: boolean;
  /** @deprecated Hold for legacy mode only. */
  useNonsenseWords: boolean;
  /** Active unit (1–7). */
  curriculumUnit: CurriculumUnitId;
  /** Stage within the active unit. */
  curriculumStage: CurriculumStageId;
}

const STORAGE_KEY = 'early.settings.v1';

function fromQuery(): Partial<AppSettings> {
  const q = new URLSearchParams(window.location.search);
  const out: Partial<AppSettings> = {};
  if (q.has('debug')) out.showMlDebug = q.get('debug') === '1';
  if (q.has('teacher')) out.teacherMode = q.get('teacher') === '1';
  if (q.has('student')) out.teacherMode = q.get('student') !== '1';
  if (q.has('nonsense')) out.useNonsenseWords = q.get('nonsense') === '1';
  if (q.has('unit')) {
    const u = Number(q.get('unit'));
    if (isKnownUnitId(u)) out.curriculumUnit = u;
  }
  if (q.has('stage')) {
    const s = q.get('stage');
    if (s && isKnownStageId(s)) out.curriculumStage = s;
  }
  return out;
}

function fromStorage(): Partial<AppSettings> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<AppSettings>) : {};
  } catch {
    return {};
  }
}

function resolveCurriculum(
  stored: Partial<AppSettings>,
  query: Partial<AppSettings>,
): Pick<AppSettings, 'curriculumUnit' | 'curriculumStage'> {
  let unit: CurriculumUnitId =
    query.curriculumUnit ?? stored.curriculumUnit ?? 1;
  if (!isKnownUnitId(unit)) unit = 1;
  if (!isUnitNavVisible(unit)) {
    unit = UNIT_NAV_VISIBLE[0] ?? 1;
  }

  let stage: CurriculumStageId =
    query.curriculumStage ?? stored.curriculumStage ?? defaultStageForUnit(unit);
  if (!isKnownStageId(stage)) stage = defaultStageForUnit(unit);
  if (!isStageInUnit(stage, unit)) {
    stage = defaultStageForUnit(unit);
  }
  return { curriculumUnit: unit, curriculumStage: stage };
}

export function loadSettings(): AppSettings {
  const stored = fromStorage();
  const query = fromQuery();
  const curriculum = resolveCurriculum(stored, query);
  return {
    showMlDebug: query.showMlDebug ?? stored.showMlDebug ?? false,
    teacherMode:
      query.teacherMode ??
      stored.teacherMode ??
      (stored.collectorMode !== undefined ? stored.collectorMode : false),
    useNonsenseWords: query.useNonsenseWords ?? stored.useNonsenseWords ?? false,
    ...curriculum,
  };
}

export function saveSettings(settings: AppSettings): void {
  const { collectorMode: _legacy, ...toSave } = settings;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
}

export function applySettingsToDocument(settings: AppSettings): void {
  document.body.classList.toggle('teacher-mode', settings.teacherMode);
  document.body.classList.toggle('collector-mode', settings.teacherMode);
  document.body.classList.toggle('ml-debug', settings.showMlDebug);
  document.body.classList.toggle('student-face', !settings.teacherMode || !settings.showMlDebug);
}
