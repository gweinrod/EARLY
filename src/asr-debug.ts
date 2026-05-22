type AsrLogEntry = { t: number; event: string; detail?: Record<string, unknown> };

const ASR_LOG_RING: AsrLogEntry[] = [];
const ASR_LOG_MAX = 48;

/** Console ASR trace — on by default; disable: localStorage.setItem('early.asrDebug', '0') */
export function isAsrDebugEnabled(): boolean {
  try {
    if (typeof window !== 'undefined') {
      const q = new URLSearchParams(window.location.search);
      if (q.get('asrDebug') === '1') return true;
      if (q.get('asrDebug') === '0') return false;
    }
    if (typeof localStorage !== 'undefined' && localStorage.getItem('early.asrDebug') === '0') {
      return false;
    }
  } catch {
    /* private mode */
  }
  return true;
}

function pushRing(event: string, detail?: Record<string, unknown>): void {
  const entry: AsrLogEntry = {
    t: typeof performance !== 'undefined' ? Math.round(performance.now()) : 0,
    event,
    detail,
  };
  ASR_LOG_RING.push(entry);
  if (ASR_LOG_RING.length > ASR_LOG_MAX) ASR_LOG_RING.shift();
  const w = window as Window & { __earlyAsrLog?: AsrLogEntry[] };
  w.__earlyAsrLog = ASR_LOG_RING;
}

/** Last N ASR events (for UI when console is unavailable). */
export function getAsrLogTail(n = 8): AsrLogEntry[] {
  return ASR_LOG_RING.slice(-n);
}

export function formatAsrLogTail(n = 6): string {
  return getAsrLogTail(n)
    .map((e) => e.event)
    .join(' → ');
}

export function asrLog(event: string, detail?: Record<string, unknown>): void {
  if (!isAsrDebugEnabled()) return;
  pushRing(event, detail);
  const t = typeof performance !== 'undefined' ? Math.round(performance.now()) : 0;
  const msg = `[EARLY ASR +${t}ms] ${event}`;
  if (detail && Object.keys(detail).length > 0) {
    console.log(msg, detail);
  } else {
    console.log(msg);
  }
}

/** Always logged (warn level — visible with default DevTools filters). */
export function asrWarn(event: string, detail?: Record<string, unknown>): void {
  pushRing(`!${event}`, detail);
  const t = typeof performance !== 'undefined' ? Math.round(performance.now()) : 0;
  const msg = `[EARLY ASR +${t}ms] ${event}`;
  if (detail && Object.keys(detail).length > 0) {
    console.warn(msg, detail);
  } else {
    console.warn(msg);
  }
}

/** Serialize a SpeechRecognition result event for DevTools. */
export function dumpSpeechResultEvent(e: SpeechRecognitionEvent): Record<string, unknown> {
  const rows: { i: number; final: boolean; alts: { transcript: string; confidence: number }[] }[] =
    [];
  for (let i = 0; i < e.results.length; i++) {
    const r = e.results[i];
    const alts: { transcript: string; confidence: number }[] = [];
    for (let a = 0; a < r.length; a++) {
      alts.push({ transcript: r[a].transcript, confidence: r[a].confidence });
    }
    rows.push({ i, final: r.isFinal, alts });
  }
  return { resultIndex: e.resultIndex, length: e.results.length, rows };
}
