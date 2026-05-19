/** Runtime flags for EARLY Student (classroom iPad vs developer debug). */

export interface AppSettings {
  /** Show MFCC heatmap, NN bars, technical feedback (off in classroom). */
  showMlDebug: boolean;
  /** Teacher session logging + agree/disagree (on by default). */
  collectorMode: boolean;
  /** Generated nonsense words vs curriculum word lists. */
  useNonsenseWords: boolean;
}

const STORAGE_KEY = 'early.settings.v1';

function fromQuery(): Partial<AppSettings> {
  const q = new URLSearchParams(window.location.search);
  const out: Partial<AppSettings> = {};
  if (q.has('debug')) out.showMlDebug = q.get('debug') === '1';
  if (q.has('student')) out.collectorMode = q.get('student') !== '1';
  if (q.has('nonsense')) out.useNonsenseWords = q.get('nonsense') === '1';
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

export function loadSettings(): AppSettings {
  const stored = fromStorage();
  const query = fromQuery();
  return {
    showMlDebug: query.showMlDebug ?? stored.showMlDebug ?? false,
    collectorMode: query.collectorMode ?? stored.collectorMode ?? true,
    useNonsenseWords: query.useNonsenseWords ?? stored.useNonsenseWords ?? false,
  };
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function applySettingsToDocument(settings: AppSettings): void {
  document.body.classList.toggle('collector-mode', settings.collectorMode);
  document.body.classList.toggle('ml-debug', settings.showMlDebug);
  document.body.classList.toggle('student-face', settings.collectorMode && !settings.showMlDebug);
}
