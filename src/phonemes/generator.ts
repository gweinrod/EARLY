import { GROUPS } from '../data';
import { isRealWord } from './blocklist';
import { GROUP_TEMPLATES } from './inventory';

export interface GeneratedWord {
  display: string;
  phonemeFocus: string;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function buildCvc(groupKey: string): string | null {
  const tpl = GROUP_TEMPLATES[groupKey];
  if (!tpl?.onsets?.length || !tpl.vowels?.length || !tpl.codas?.length) return null;

  const onset = pick(pick(tpl.onsets));
  const vowel = pick(tpl.vowels);
  const coda = pick(pick(tpl.codas));
  return onset + vowel + coda;
}

const MAX_ATTEMPTS = 80;

export function generateNonsenseWord(groupKey: string): GeneratedWord {
  const group = GROUPS[groupKey];
  const phonemeFocus = group.phonemes.join('  ');

  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const candidate = buildCvc(groupKey);
    if (!candidate || candidate.length < 3 || candidate.length > 8) continue;
    if (isRealWord(candidate)) continue;
    return { display: candidate, phonemeFocus };
  }

  // Fallback: append nonsense suffix to avoid blocklist collision
  const base = buildCvc(groupKey) ?? 'zo';
  let display = base + 'f';
  let n = 0;
  while (isRealWord(display) && n < 20) {
    display = base + String.fromCharCode(97 + (n % 26));
    n++;
  }
  return { display, phonemeFocus };
}

export function pickCurriculumWord(groupKey: string): GeneratedWord {
  const words = GROUPS[groupKey].words;
  const display = pick(words);
  return {
    display,
    phonemeFocus: `focus: ${GROUPS[groupKey].phonemes.join('  ')}`,
  };
}
