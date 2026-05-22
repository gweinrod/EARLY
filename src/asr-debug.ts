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

export function asrLog(event: string, detail?: Record<string, unknown>): void {
  if (!isAsrDebugEnabled()) return;
  const t = typeof performance !== 'undefined' ? Math.round(performance.now()) : 0;
  if (detail && Object.keys(detail).length > 0) {
    console.debug(`[EARLY ASR +${t}ms] ${event}`, detail);
  } else {
    console.debug(`[EARLY ASR +${t}ms] ${event}`);
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
