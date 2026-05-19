import type { CurriculumItem } from './curriculum';
import { normalizeHeardLabel } from './curriculum';

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
  /** One tap = one session; we call stop() when done (do not use false — dies mid-take). */
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';
  recognition.maxAlternatives = 1;
  return recognition;
}

export interface TranscriptSlice {
  text: string;
  isFinal: boolean;
}

/** "cc", "bbb" (no space) → single letter; leaves "see", "bee", "ee" unchanged. */
export function collapseRepeatedLetterRun(token: string): string {
  if (token.length < 2) return token;
  const ch = token[0];
  // "ee" is a letter name (E), not stutter — do not collapse to "e".
  if (ch === 'e' && [...token].every((c) => c === 'e')) return token;
  if ([...token].every((c) => c === ch)) return ch;
  return token;
}

/**
 * Merge ASR across Chrome restarts in one tap (e.g. "b" then "ee" → "bee").
 */
export function mergeTakeTranscript(
  accum: string,
  eventText: string,
  item: CurriculumItem,
): string {
  const a = collapseRepeatedTokens(accum);
  const e = collapseRepeatedTokens(eventText);
  if (!a) return e;
  if (!e) return a;
  if (e.startsWith(a) || a.startsWith(e)) return e.length >= a.length ? e : a;

  const compactA = a.replace(/\s+/g, '');
  const compactE = e.replace(/\s+/g, '');
  const joined = compactA + compactE;
  const sn = normalizeHeardLabel(item.spokenName).replace(/\s+/g, '');

  if (joined === sn) return item.spokenName.toLowerCase();
  if (item.aliases.some((al) => normalizeHeardLabel(al).replace(/\s+/g, '') === joined)) {
    return normalizeHeardLabel(item.aliases.find(
      (al) => normalizeHeardLabel(al).replace(/\s+/g, '') === joined,
    )!);
  }

  if (sn.endsWith('ee') && sn.startsWith(compactA) && (compactE === 'ee' || compactE === 'e')) {
    return item.spokenName.toLowerCase();
  }

  return collapseRepeatedTokens(`${a} ${e}`);
}

export function collapseRepeatedTokens(heard: string): string {
  const tokens = heard
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map(collapseRepeatedLetterRun);
  if (tokens.length <= 1) return tokens[0] ?? '';
  const out: string[] = [];
  for (const t of tokens) {
    if (out[out.length - 1] !== t) out.push(t);
  }
  return out.join(' ');
}

/** Full cumulative transcript (all result segments in this event). */
export function fullTranscriptFromEvent(e: SpeechRecognitionEvent): string {
  let text = '';
  for (let i = 0; i < e.results.length; i++) {
    text += e.results[i][0].transcript;
  }
  return collapseRepeatedTokens(text);
}

/** True if any segment in this event is marked final by the browser. */
export function eventHasFinalTranscript(e: SpeechRecognitionEvent): boolean {
  for (let i = 0; i < e.results.length; i++) {
    if (e.results[i].isFinal) return true;
  }
  return false;
}

/** Prefer the latest segment only (avoids duplicated letters across segments). */
export function transcriptFromEvent(e: SpeechRecognitionEvent): TranscriptSlice {
  const last = e.results.length > 0 ? e.results[e.results.length - 1] : null;
  let text = '';
  if (last) {
    for (let i = 0; i < last.length; i++) text += last[i].transcript;
  }
  text = collapseRepeatedTokens(text);
  const isFinal = last?.isFinal ?? false;
  return { text, isFinal };
}
