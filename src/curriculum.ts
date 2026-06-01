/**
 * EARLY scope and sequence - docs/EARLY_CURRICULUM_SCOPE.md
 * Units 1–7: see units.ts for stage pills; item lists fill in over time.
 */

export type { CurriculumStageId, CurriculumUnitId } from './units';
export {
  ALL_STAGE_IDS,
  CURRICULUM_UNITS,
  STAGE_PILL_LABEL,
  UNIT_NAV_VISIBLE,
  UNIT_ORDER,
  defaultStageForUnit,
  getStageIdsForUnit,
  getUnit,
  getUnitForStage,
  isKnownStageId,
  isKnownUnitId,
  isLetterWritingStage,
  isStageInUnit,
  wordPromptForUnitStage,
} from './units';

import { ALL_STAGE_IDS, STAGE_PILL_LABEL, type CurriculumStageId } from './units';

export interface CurriculumItem {
  /** Stable key for logging / TF (e.g. "b", "bat"). */
  key: string;
  /** Large display (e.g. "B"). */
  display: string;
  /** What the student should say (e.g. "bee"). */
  spokenName: string;
  /** Teacher-facing phoneme hook from the PDF. */
  phonemeNote: string;
  /** ASR / teacher-input aliases. */
  aliases: string[];
}

export interface CurriculumStage {
  id: CurriculumStageId;
  label: string;
  subtitle: string;
  items: CurriculumItem[];
}

/** Stage 1  all 26 letter names (American classroom). */
const ALPHABET_ITEMS: CurriculumItem[] = [
  { key: 'a', display: 'A', spokenName: 'ay', phonemeNote: 'vowel name = long /e?/ sound', aliases: ['a', 'ay', 'eh'] },
  { key: 'b', display: 'B', spokenName: 'bee', phonemeNote: 'name contains /b/', aliases: ['b', 'bee', 'be'] },
  { key: 'c', display: 'C', spokenName: 'see', phonemeNote: 'name contains /s/', aliases: ['c', 'see', 'cee', 'sea'] },
  { key: 'd', display: 'D', spokenName: 'dee', phonemeNote: 'name contains /d/', aliases: ['d', 'dee'] },
  { key: 'e', display: 'E', spokenName: 'ee', phonemeNote: 'vowel name = long /i?/ sound', aliases: ['e', 'ee'] },
  { key: 'f', display: 'F', spokenName: 'eff', phonemeNote: 'name contains /f/', aliases: ['f', 'eff', 'ef'] },
  { key: 'g', display: 'G', spokenName: 'jee', phonemeNote: 'name contains /g/', aliases: ['g', 'jee', 'gee'] },
  { key: 'h', display: 'H', spokenName: 'aitch', phonemeNote: 'name contains /h/', aliases: ['h', 'aitch', 'haitch'] },
  { key: 'i', display: 'I', spokenName: 'eye', phonemeNote: 'vowel name = long /a?/ sound', aliases: ['i', 'eye', 'aye'] },
  { key: 'j', display: 'J', spokenName: 'jay', phonemeNote: 'name contains /d?/', aliases: ['j', 'jay', 'jae'] },
  { key: 'k', display: 'K', spokenName: 'kay', phonemeNote: 'name contains /k/', aliases: ['k', 'kay', 'cae'] },
  { key: 'l', display: 'L', spokenName: 'el', phonemeNote: 'name contains /l/', aliases: ['l', 'el', 'ell'] },
  { key: 'm', display: 'M', spokenName: 'em', phonemeNote: 'name contains /m/', aliases: ['m', 'em'] },
  { key: 'n', display: 'N', spokenName: 'en', phonemeNote: 'name contains /n/', aliases: ['n', 'en', 'in', 'inn'] },
  { key: 'o', display: 'O', spokenName: 'oh', phonemeNote: 'vowel name = long /o?/ sound', aliases: ['o', 'oh', 'owe'] },
  { key: 'p', display: 'P', spokenName: 'pee', phonemeNote: 'name contains /p/', aliases: ['p', 'pee', 'pea'] },
  { key: 'q', display: 'Q', spokenName: 'cue', phonemeNote: 'name contains /k/', aliases: ['q', 'cue', 'que', 'kyu', 'queue'] },
  { key: 'r', display: 'R', spokenName: 'ar', phonemeNote: 'name contains /r/', aliases: ['r', 'ar', 'are'] },
  { key: 's', display: 'S', spokenName: 'ess', phonemeNote: 'name contains /s/', aliases: ['s', 'ess', 'es'] },
  { key: 't', display: 'T', spokenName: 'tee', phonemeNote: 'name contains /t/', aliases: ['t', 'tee', 'tea'] },
  { key: 'u', display: 'U', spokenName: 'you', phonemeNote: 'vowel name = long /ju?/ sound', aliases: ['u', 'you'] },
  { key: 'v', display: 'V', spokenName: 'vee', phonemeNote: 'name contains /v/', aliases: ['v', 'vee'] },
  {
    key: 'w',
    display: 'W',
    spokenName: 'double-u',
    phonemeNote: 'name contains /w/',
    aliases: ['w', 'double u', 'double-u', 'doubleyou', 'dubya'],
  },
  { key: 'x', display: 'X', spokenName: 'ex', phonemeNote: 'name contains /ks/', aliases: ['x', 'ex'] },
  { key: 'y', display: 'Y', spokenName: 'why', phonemeNote: 'name contains /j/', aliases: ['y', 'why', 'wye'] },
  { key: 'z', display: 'Z', spokenName: 'zee', phonemeNote: 'name contains /z/', aliases: ['z', 'zee', 'zed'] },
];

/** Stage 2  consonant phonemes (letter name as anchor). */
/**
 * Letter-writing stage — A–Z then a–z (52 items).
 *
 * Distinct keys (`U-a`, `L-a`) keep upper- and lowercase as separate curriculum
 * items so pickNextItemInOrder cycles A → … → Z → a → … → z → A.
 */
const LETTER_WRITING_ITEMS: CurriculumItem[] = [
  ...ALPHABET_ITEMS.map((x) => ({
    ...x,
    key: `U-${x.key}`,
    display: x.key.toUpperCase(),
    aliases: [x.key, x.key.toUpperCase()],
  })),
  ...ALPHABET_ITEMS.map((x) => ({
    ...x,
    key: `L-${x.key}`,
    display: x.key.toLowerCase(),
    aliases: [x.key.toLowerCase()],
  })),
];

const CONSONANT_ITEMS: CurriculumItem[] = ALPHABET_ITEMS.filter((x) => !'aeiou'.includes(x.key)).map((x) => ({
  ...x,
  spokenName: x.key,
  phonemeNote: `phoneme /${x.key}/ (from ${x.spokenName === x.key ? ALPHABET_ITEMS.find((a) => a.key === x.key)?.spokenName : x.spokenName})`,
  aliases: [x.key, ...(ALPHABET_ITEMS.find((a) => a.key === x.key)?.aliases ?? [])],
}));

/** Stage 3  short vowels in CVC (subset; full list expands later). */
const SHORT_VOWEL_CVC: CurriculumItem[] = [
  { key: 'bat', display: 'bat', spokenName: 'bat', phonemeNote: 'short //', aliases: ['bat', 'at'] },
  { key: 'bet', display: 'bet', spokenName: 'bet', phonemeNote: 'short /?/', aliases: ['bet', 'et'] },
  { key: 'bit', display: 'bit', spokenName: 'bit', phonemeNote: 'short /?/', aliases: ['bit', 'it'] },
  { key: 'bot', display: 'bot', spokenName: 'bot', phonemeNote: 'short /?/', aliases: ['bot', 'ot'] },
  { key: 'but', display: 'but', spokenName: 'but', phonemeNote: 'short /?/', aliases: ['but', 'ut'] },
];

export const CURRICULUM_STAGES: Partial<Record<CurriculumStageId, CurriculumStage>> = {
  alphabet: {
    id: 'alphabet',
    label: 'Letter Names',
    subtitle: '',
    items: ALPHABET_ITEMS,
  },
  consonants: {
    id: 'consonants',
    label: 'Letter Sounds',
    subtitle: '',
    items: CONSONANT_ITEMS,
  },
  'letter-writing': {
    id: 'letter-writing',
    label: 'Letter Writing',
    subtitle: '',
    items: LETTER_WRITING_ITEMS,
  },
  'short-vowels': {
    id: 'short-vowels',
    label: 'Stage 3  short vowels (CVC)',
    subtitle: 'CVC words  vowel says its short sound.',
    items: SHORT_VOWEL_CVC,
  },
  'legacy-cvc': {
    id: 'legacy-cvc',
    label: 'Legacy  blend groups',
    subtitle: 'Original demo word lists (hold for later units).',
    items: [],
  },
};

/** @deprecated Use ALL_STAGE_IDS */
export const STAGE_ORDER: CurriculumStageId[] = ALL_STAGE_IDS;

function skeletonItem(stageId: CurriculumStageId, display: string): CurriculumItem {
  return {
    key: `${stageId}-placeholder`,
    display,
    spokenName: display,
    phonemeNote: 'Placeholder — content coming soon',
    aliases: [display.toLowerCase()],
  };
}

function skeletonStage(stageId: CurriculumStageId): CurriculumStage {
  const label = STAGE_PILL_LABEL[stageId];
  return {
    id: stageId,
    label,
    subtitle: '',
    items: [skeletonItem(stageId, label)],
  };
}

export function pickPreviousItemInOrder(
  stageId: CurriculumStageId,
  currentKey?: string,
): CurriculumItem {
  const items = getStage(stageId).items;
  if (!items.length) throw new Error(`Stage ${stageId} has no items`);
  if (!currentKey) return items[items.length - 1];
  const idx = items.findIndex((i) => i.key === currentKey);
  const prevIdx = idx <= 0 ? items.length - 1 : idx - 1;
  return items[prevIdx];
}

export function getStage(id: CurriculumStageId): CurriculumStage {
  return CURRICULUM_STAGES[id] ?? skeletonStage(id);
}

export function normalizeHeardLabel(text: string): string {
  return text.trim().toLowerCase().replace(/[^a-z0-9'\s-]/g, '').replace(/\s+/g, ' ');
}

/** American letter names ending in long-E: bee, see, dee, ee, jee, pee, tee, vee, zee. */
export function spokenNameEndsWithEeSound(item: CurriculumItem): boolean {
  const sn = item.spokenName.toLowerCase();
  return sn.endsWith('ee');
}

/**
 * Chrome often ends the session after the consonant ("b") before "ee" in "bee".
 * Do not treat as a finished answer yet.
 */
export function isIncompleteEeNamePrefix(heard: string, item: CurriculumItem): boolean {
  if (!spokenNameEndsWithEeSound(item)) return false;
  const sn = normalizeHeardLabel(item.spokenName).replace(/\s+/g, '');
  const h = normalizeHeardLabel(heard).replace(/\s+/g, '');
  if (!h || h.length >= sn.length) return false;
  // "bee"/"dee" = key + "ee"; "see" starts with "s" not "c" — avoid treating "c" as a prefix.
  if (sn[0] !== item.key) return false;
  return sn.startsWith(h);
}

/** Letter name spelled as key + "ee" (bee, dee) — not "see" where key is not a literal prefix. */
export function letterNameIsKeyPlusEe(item: CurriculumItem): boolean {
  const sn = normalizeHeardLabel(item.spokenName).replace(/\s+/g, '');
  return spokenNameEndsWithEeSound(item) && sn.length > 1 && sn[0] === item.key;
}

/**
 * Short names where the spoken label does not start with the letter key (en, em, el, ar, eff).
 * Chrome often returns nothing, only the key, or a near-homophone ("in" for "en").
 */
export function spokenNameIsSchwaStyle(item: CurriculumItem): boolean {
  const sn = normalizeHeardLabel(item.spokenName).replace(/\s+/g, '');
  if (sn.length < 2 || sn.length > 3) return false;
  if (letterNameIsKeyPlusEe(item) || spokenNameIsDoubledLetter(item)) return false;
  return sn[0] !== item.key;
}

/** Partial transcript while the student is still saying en / em / el (or only the key). */
export function isIncompleteSchwaNamePrefix(heard: string, item: CurriculumItem): boolean {
  if (!spokenNameIsSchwaStyle(item)) return false;
  const sn = normalizeHeardLabel(item.spokenName).replace(/\s+/g, '');
  const h = normalizeHeardLabel(heard).replace(/\s+/g, '');
  if (!h || h.length >= sn.length) return false;
  if (sn.startsWith(h)) return true;
  return h === item.key;
}

/**
 * Spoken name starts with the letter key but is not key+ee (jay, kay).
 * Chrome often returns only "j" or nothing while the student says "jay".
 */
export function letterNameIsKeyLedSpokenName(item: CurriculumItem): boolean {
  if (item.key.length !== 1) return false;
  const sn = normalizeHeardLabel(item.spokenName).replace(/\s+/g, '');
  if (sn.length < 2 || sn.length > 4) return false;
  if (letterNameIsKeyPlusEe(item) || spokenNameIsDoubledLetter(item)) return false;
  return sn.startsWith(item.key);
}

export function isIncompleteKeyLedNamePrefix(heard: string, item: CurriculumItem): boolean {
  if (!letterNameIsKeyLedSpokenName(item)) return false;
  const sn = normalizeHeardLabel(item.spokenName).replace(/\s+/g, '');
  const h = normalizeHeardLabel(heard).replace(/\s+/g, '');
  if (!h || h.length >= sn.length) return false;
  return sn.startsWith(h);
}

/** Letters that need no-result watchdog / chrome-tail recovery (bee, en, jay, …). */
export function letterNameNeedsAsrRecovery(item: CurriculumItem): boolean {
  return (
    letterNameIsKeyPlusEe(item) ||
    spokenNameIsSchwaStyle(item) ||
    letterNameIsKeyLedSpokenName(item)
  );
}

/** Incomplete bee/dee tail, en/em/el, or jay/kay prefix. */
export function isIncompleteLetterNamePrefix(heard: string, item: CurriculumItem): boolean {
  return (
    isIncompleteEeNamePrefix(heard, item) ||
    isIncompleteSchwaNamePrefix(heard, item) ||
    isIncompleteKeyLedNamePrefix(heard, item)
  );
}

/** Common Chrome mis-hearings for a specific letter (only when transcript does not already match). */
const ASR_MISHEAR_BY_KEY: Partial<Record<string, Record<string, string>>> = {
  n: { in: 'en', inn: 'en' },
  m: { am: 'em', im: 'em' },
  l: { al: 'el', ill: 'el' },
  j: { jae: 'jay' },
};

export function remapAsrMishearForItem(
  stageId: CurriculumStageId,
  heard: string,
  item: CurriculumItem,
): string {
  const label = normalizeHeardLabel(heard);
  if (!label || transcriptMatchesItem(stageId, heard, item)) return heard;
  const mapped = ASR_MISHEAR_BY_KEY[item.key]?.[label];
  return mapped ? normalizeHeardLabel(mapped) : heard;
}

/**
 * Chrome onend often fires after only "b"; the student already said "ee" but ASR missed it.
 * Same idea for "en" / "em" / "el" when only "e", "n", etc. appear.
 */
export function resolveHeardForEeChromeTail(
  heard: string,
  item: CurriculumItem,
  chromeAteEeTail: boolean,
): string {
  if (!chromeAteEeTail) return heard;
  if (letterNameIsKeyPlusEe(item) && isIncompleteEeNamePrefix(heard, item)) {
    return normalizeHeardLabel(item.spokenName);
  }
  if (spokenNameIsSchwaStyle(item) && isIncompleteSchwaNamePrefix(heard, item)) {
    return normalizeHeardLabel(item.spokenName);
  }
  if (letterNameIsKeyLedSpokenName(item) && isIncompleteKeyLedNamePrefix(heard, item)) {
    return normalizeHeardLabel(item.spokenName);
  }
  return heard;
}

/**
 * ASR often says the letter then the name: "c see", "b bee". Keep the name token for matching.
 */
export function canonicalizeHeardForItem(heard: string, item: CurriculumItem): string {
  const tokens = normalizeHeardLabel(heard).split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return normalizeHeardLabel(heard);

  const sn = normalizeHeardLabel(item.spokenName);
  const aliases = new Set(item.aliases.map((a) => normalizeHeardLabel(a)));
  const hasNameToken = tokens.some((t) => t === sn || aliases.has(t));
  const hasKeyToken = tokens.some((t) => t === item.key);

  if (hasNameToken && hasKeyToken) {
    const nameTok = tokens.find((t) => t === sn || aliases.has(t));
    return nameTok ?? sn;
  }

  return normalizeHeardLabel(heard);
}

/** Letter name is the key repeated (e.g. E → "ee"). ASR often finalizes as lone "e". */
export function spokenNameIsDoubledLetter(item: CurriculumItem): boolean {
  const { key, spokenName } = item;
  if (key.length !== 1 || spokenName.length < 2) return false;
  return [...spokenName].every((c) => c === key);
}

export function resolveItemKey(stageId: CurriculumStageId, heard: string): string | null {
  const label = normalizeHeardLabel(heard);
  if (!label) return null;
  const stage = getStage(stageId);
  for (const item of stage.items) {
    const canon = canonicalizeHeardForItem(heard, item);
    if (item.key === label || item.key === canon || item.spokenName === label) return item.key;
    if (canon === normalizeHeardLabel(item.spokenName)) return item.key;
    if (item.aliases.some((a) => normalizeHeardLabel(a) === label || normalizeHeardLabel(a) === canon)) {
      return item.key;
    }
  }
  return null;
}

export function transcriptMatchesItem(
  stageId: CurriculumStageId,
  heard: string,
  item: CurriculumItem,
): boolean {
  const key = resolveItemKey(stageId, heard);
  if (key === item.key) return true;
  const label = canonicalizeHeardForItem(heard, item);
  return (
    label === item.key ||
    label === normalizeHeardLabel(item.spokenName) ||
    item.aliases.some((a) => normalizeHeardLabel(a) === label)
  );
}

/**
 * Like transcriptMatchesItem but requires the full letter name for key+ee names
 * in the alphabet stage. "b" alone is not a pass for B — student must say "bee".
 * Not applied to "see", "jee", "cue", etc. (spoken name does not start with the key);
 * Chrome often returns just the letter (e.g. "g" for G / "jee") and that is a valid alias.
 */
export function transcriptMatchesItemForScoring(
  stageId: CurriculumStageId,
  heard: string,
  item: CurriculumItem,
): boolean {
  if (!transcriptMatchesItem(stageId, heard, item)) return false;
  if (stageId === 'alphabet' && letterNameIsKeyPlusEe(item)) {
    const tokens = normalizeHeardLabel(heard).split(/\s+/).filter(Boolean);
    if (tokens.length === 1 && tokens[0] === item.key) return false;
  }
  return true;
}

/**
 * Stricter than transcriptMatchesItem for mic auto-stop: ignore a lone interim letter
 * (e.g. "b" while the user is still saying "bee").
 */
export function transcriptMatchesItemForAutoStop(
  stageId: CurriculumStageId,
  heard: string,
  item: CurriculumItem,
  isFinal: boolean,
): boolean {
  if (!transcriptMatchesItem(stageId, heard, item)) return false;
  const tokens = normalizeHeardLabel(heard).split(/\s+/).filter(Boolean);
  if (tokens.length === 1 && tokens[0].length === 1 && tokens[0] === item.key) {
    // E → "ee" often transcribes as final-quality "e" before the session ends.
    if (spokenNameIsDoubledLetter(item)) return isFinal;
    // Chrome marks "b" final mid-word for "bee" — never auto-stop on consonant alone.
    if (stageId === 'alphabet' && letterNameIsKeyPlusEe(item)) return false;
    if (!isFinal) return false;
  }
  return true;
}

/** Chrome ended the mic session — safe to stop without a second utterance? */
export function transcriptMatchesItemForSessionEnd(
  stageId: CurriculumStageId,
  heard: string,
  item: CurriculumItem,
): boolean {
  if (!transcriptMatchesItemForScoring(stageId, heard, item)) return false;
  if (isIncompleteLetterNamePrefix(heard, item)) return false;
  return true;
}

/** Next item in curriculum order; wraps A→…→Z→A for alphabet. */
export function pickNextItemInOrder(
  stageId: CurriculumStageId,
  currentKey?: string,
): CurriculumItem {
  const items = getStage(stageId).items;
  if (!items.length) throw new Error(`Stage ${stageId} has no items`);
  if (!currentKey) return items[0];
  const idx = items.findIndex((i) => i.key === currentKey);
  return items[(idx < 0 ? 0 : idx + 1) % items.length];
}
