/**
 * EARLY scope and sequence - docs/EARLY_CURRICULUM_SCOPE.md
 * Unit 1 order: (1) letter names -> (2) consonant sounds -> (3) short vowels in CVC.
 */

export type CurriculumStageId = 'alphabet' | 'consonants' | 'short-vowels' | 'legacy-cvc';

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
  { key: 'j', display: 'J', spokenName: 'jay', phonemeNote: 'name contains /d?/', aliases: ['j', 'jay'] },
  { key: 'k', display: 'K', spokenName: 'kay', phonemeNote: 'name contains /k/', aliases: ['k', 'kay', 'cae'] },
  { key: 'l', display: 'L', spokenName: 'el', phonemeNote: 'name contains /l/', aliases: ['l', 'el', 'ell'] },
  { key: 'm', display: 'M', spokenName: 'em', phonemeNote: 'name contains /m/', aliases: ['m', 'em'] },
  { key: 'n', display: 'N', spokenName: 'en', phonemeNote: 'name contains /n/', aliases: ['n', 'en'] },
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

export const CURRICULUM_STAGES: Record<CurriculumStageId, CurriculumStage> = {
  alphabet: {
    id: 'alphabet',
    label: 'Stage 1  letter names',
    subtitle: 'Say the letter name (bee, dee, ). Consonant names contain their sound.',
    items: ALPHABET_ITEMS,
  },
  consonants: {
    id: 'consonants',
    label: 'Stage 2  consonant sounds',
    subtitle: 'Say the phoneme only (/b/, /d/, ). Letter name is the anchor.',
    items: CONSONANT_ITEMS,
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

export const STAGE_ORDER: CurriculumStageId[] = ['alphabet', 'consonants', 'short-vowels', 'legacy-cvc'];

export function getStage(id: CurriculumStageId): CurriculumStage {
  return CURRICULUM_STAGES[id];
}

export function normalizeHeardLabel(text: string): string {
  return text.trim().toLowerCase().replace(/[^a-z0-9'\s-]/g, '').replace(/\s+/g, ' ');
}

export function resolveItemKey(stageId: CurriculumStageId, heard: string): string | null {
  const label = normalizeHeardLabel(heard);
  if (!label) return null;
  const stage = getStage(stageId);
  for (const item of stage.items) {
    if (item.key === label || item.spokenName === label) return item.key;
    if (item.aliases.some((a) => normalizeHeardLabel(a) === label)) return item.key;
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
  const label = normalizeHeardLabel(heard);
  return (
    label === item.key ||
    label === normalizeHeardLabel(item.spokenName) ||
    item.aliases.some((a) => normalizeHeardLabel(a) === label)
  );
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
  // Interim lone letter (e.g. "b" while saying "bee") — wait for more audio or a final result.
  if (
    !isFinal &&
    tokens.length === 1 &&
    tokens[0].length === 1 &&
    tokens[0] === item.key
  ) {
    return false;
  }
  return true;
}

export function pickRandomItem(stageId: CurriculumStageId, excludeKey?: string): CurriculumItem {
  const items = getStage(stageId).items;
  if (!items.length) throw new Error(`Stage ${stageId} has no items`);
  const pool = excludeKey ? items.filter((i) => i.key !== excludeKey) : items;
  const list = pool.length ? pool : items;
  return list[Math.floor(Math.random() * list.length)];
}
