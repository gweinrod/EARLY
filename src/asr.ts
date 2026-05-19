export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const d: number[][] = [];
  for (let i = 0; i <= m; i++) {
    d[i] = [];
    for (let j = 0; j <= n; j++) {
      d[i][j] = i === 0 ? j : j === 0 ? i : 0;
    }
  }
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      d[i][j] =
        a[i - 1] === b[j - 1]
          ? d[i - 1][j - 1]
          : 1 + Math.min(d[i - 1][j], d[i][j - 1], d[i - 1][j - 1]);
    }
  }
  return d[m][n];
}

/** Strip punctuation so ASR trailing periods do not break equality. */
export function normalizeWord(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9']/g, '');
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * True when speech-to-text said the target word.
 * Intentionally strict on short words: edit distance 1 treated "clit" as "flit".
 */
export function transcriptMatchesTarget(heard: string, target: string): boolean {
  const t = normalizeWord(target);
  if (!t) return false;

  const raw = heard.trim().toLowerCase();
  const tokens = raw.split(/\s+/).map(normalizeWord).filter(Boolean);

  if (tokens.some((tok) => tok === t)) return true;

  // Phrase heard as one string without spaces, e.g. "sayflit" — rare; keep whole-string exact.
  if (normalizeWord(raw) === t) return true;

  // Multi-word transcript containing the target as its own word.
  if (/\s/.test(raw) && new RegExp(`\\b${escapeRegExp(t)}\\b`, 'i').test(raw)) return true;

  // One-slip tolerance only on longer words with same length and onset (not clit/flit).
  if (t.length >= 6) {
    return tokens.some(
      (tok) => tok.length === t.length && tok[0] === t[0] && levenshtein(tok, t) === 1,
    );
  }

  return false;
}

type SpeechRecognitionCtor = new () => SpeechRecognition;

export function createSpeechRecognition(): SpeechRecognition | null {
  const w = window as Window & {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!SR) return null;
  const recognition = new SR();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';
  recognition.maxAlternatives = 1;
  return recognition;
}

/** Best final transcript from a Chrome / webkit recognition result event. */
export function transcriptFromEvent(e: SpeechRecognitionEvent): string {
  let text = '';
  for (let i = e.resultIndex; i < e.results.length; i++) {
    const chunk = e.results[i];
    if (chunk.isFinal) text += chunk[0].transcript;
  }
  if (!text && e.results.length > 0) {
    text = e.results[e.results.length - 1][0].transcript;
  }
  return text.trim().toLowerCase();
}
