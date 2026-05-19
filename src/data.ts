export type GroupType = 'onset-stop-liquid' | 'onset-sibilant' | 'vowel' | 'coda';

export interface PhonemeGroup {
  words: string[];
  phonemes: string[];
  type: GroupType;
}

export const GROUPS: Record<string, PhonemeGroup> = {
  'bl / cl / fl': {
    words: ['blip', 'clam', 'flab', 'blot', 'cleft', 'flop', 'blend', 'clunk', 'flint', 'bluff'],
    phonemes: ['/bl/', '/kl/', '/fl/'],
    type: 'onset-stop-liquid',
  },
  'str / spr / scr': {
    words: ['strop', 'sprig', 'scram', 'strip', 'spray', 'scrub', 'stress', 'spring', 'screen', 'strong'],
    phonemes: ['/str/', '/spr/', '/skr/'],
    type: 'onset-sibilant',
  },
  'short vowels': {
    words: ['bat', 'bet', 'bit', 'bot', 'but', 'cap', 'peg', 'tip', 'dog', 'cup', 'fan', 'hem', 'mud', 'hut'],
    phonemes: ['/æ/', '/ɛ/', '/ɪ/', '/ɒ/', '/ʌ/'],
    type: 'vowel',
  },
  'long vowels': {
    words: ['lake', 'feet', 'bike', 'coat', 'cute', 'bake', 'seed', 'kite', 'roam', 'fuse', 'mule', 'pool', 'tone', 'beam'],
    phonemes: ['/eɪ/', '/iː/', '/aɪ/', '/oʊ/', '/juː/'],
    type: 'vowel',
  },
  'ending blends': {
    words: ['lamp', 'dent', 'mask', 'raft', 'band', 'limp', 'went', 'desk', 'left', 'bond'],
    phonemes: ['/mp/', '/nt/', '/sk/', '/ft/', '/nd/'],
    type: 'coda',
  },
};

export const GROUP_KEYS = Object.keys(GROUPS);

export const VC = [
  { label: 'high-front', ipa: '/iː/ /ɪ/' },
  { label: 'mid-front', ipa: '/eɪ/ /ɛ/' },
  { label: 'low-front', ipa: '/æ/' },
  { label: 'low-back', ipa: '/ɑ/ /ɒ/ /aɪ/' },
  { label: 'high-back', ipa: '/uː/ /juː/' },
  { label: 'mid-central', ipa: '/ʌ/ /oʊ/' },
];

export const W2C: Record<string, number> = {
  feet: 0, seed: 0, bit: 0, tip: 0, beam: 0, hem: 0,
  lake: 1, bake: 1, bet: 1, peg: 1,
  bat: 2, cap: 2, fan: 2,
  bot: 3, dog: 3, bike: 3, kite: 3, mud: 3, tone: 3,
  cute: 4, fuse: 4, mule: 4, pool: 4,
  but: 5, cup: 5, coat: 5, roam: 5, hut: 5,
};

export interface VowelHint {
  label: string;
  ex: string;
  tip: string;
}

export const VH: Record<string, VowelHint> = {
  bat: { label: '/æ/', ex: 'low-front', tip: 'drop jaw wide, tongue low and front' },
  cap: { label: '/æ/', ex: 'low-front', tip: 'jaw wide open, lips slightly spread' },
  fan: { label: '/æ/', ex: 'low-front', tip: 'jaw wide, tongue low and front' },
  bet: { label: '/ɛ/', ex: 'mid-front', tip: 'half-open, tongue mid-height front' },
  peg: { label: '/ɛ/', ex: 'mid-front', tip: 'half-open mouth, tongue mid-front' },
  hem: { label: '/ɛ/', ex: 'mid-front', tip: 'half-open, relaxed mid-front vowel' },
  bit: { label: '/ɪ/', ex: 'high-front', tip: 'slight smile, tongue high and front' },
  tip: { label: '/ɪ/', ex: 'high-front', tip: 'small opening, tongue raised front' },
  bot: { label: '/ɒ/', ex: 'low-back', tip: 'rounded lips, jaw drops, tongue back' },
  dog: { label: '/ɒ/', ex: 'low-back', tip: 'rounded lips, tongue back and low' },
  mud: { label: '/ɒ/', ex: 'low-back', tip: 'rounded lips, tongue back' },
  but: { label: '/ʌ/', ex: 'mid-central', tip: 'relaxed jaw, tongue center of mouth' },
  cup: { label: '/ʌ/', ex: 'mid-central', tip: 'neutral jaw, tongue mid-central' },
  hut: { label: '/ʌ/', ex: 'mid-central', tip: 'relaxed central vowel' },
  lake: { label: '/eɪ/', ex: 'mid-front', tip: 'glide from mid-front upward' },
  bake: { label: '/eɪ/', ex: 'mid-front', tip: 'start mid and glide toward a smile' },
  feet: { label: '/iː/', ex: 'high-front', tip: 'spread lips wide, tongue high and front' },
  seed: { label: '/iː/', ex: 'high-front', tip: 'tense tongue very front and high' },
  beam: { label: '/iː/', ex: 'high-front', tip: 'tense high-front vowel' },
  bike: { label: '/aɪ/', ex: 'low-back', tip: 'glide from low-back to high-front' },
  kite: { label: '/aɪ/', ex: 'low-back', tip: 'open wide, then close into a smile' },
  coat: { label: '/oʊ/', ex: 'mid-central', tip: 'start mid-back, round and close lips' },
  roam: { label: '/oʊ/', ex: 'mid-central', tip: 'round lips and glide backward' },
  tone: { label: '/oʊ/', ex: 'mid-central', tip: 'round lips through the vowel' },
  cute: { label: '/juː/', ex: 'high-back', tip: 'begin with /j/ then round lips' },
  fuse: { label: '/juː/', ex: 'high-back', tip: '/j/ onset then tight lip rounding' },
  mule: { label: '/juː/', ex: 'high-back', tip: '/j/ glide then round lips' },
  pool: { label: '/uː/', ex: 'high-back', tip: 'round lips, tongue high and back' },
};

export const CODA_BLENDS: Record<string, string> = {
  lamp: '-mp', dent: '-nt', mask: '-sk', raft: '-ft', band: '-nd',
  limp: '-mp', went: '-nt', desk: '-sk', left: '-ft', bond: '-nd',
};
