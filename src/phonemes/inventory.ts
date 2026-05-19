import type { GroupType } from '../data';

export interface PhonemeSlot {
  grapheme: string;
  ipa: string;
}

export interface GroupTemplate {
  type: GroupType;
  /** Letter pools per syllable position for nonsense generation */
  onsets?: string[][];
  vowels?: string[];
  codas?: string[][];
}

export const GROUP_TEMPLATES: Record<string, GroupTemplate> = {
  'bl / cl / fl': {
    type: 'onset-stop-liquid',
    onsets: [
      ['bl', 'cl', 'fl'],
    ],
    vowels: ['i', 'a', 'o', 'u', 'e'],
    codas: [['p', 't', 'b', 'k', 'f', 'm', 'n']],
  },
  'str / spr / scr': {
    type: 'onset-sibilant',
    onsets: [['str', 'spr', 'scr']],
    vowels: ['a', 'e', 'i', 'o', 'u'],
    codas: [['p', 'g', 'm', 'b', 't']],
  },
  'short vowels': {
    type: 'vowel',
    onsets: [['b', 'c', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'm', 'n', 'p', 'r', 's', 't', 'v', 'w', 'z']],
    vowels: ['a', 'e', 'i', 'o', 'u'],
    codas: [['b', 'd', 'g', 'p', 't', 'k', 'm', 'n', 's', 'x']],
  },
  'long vowels': {
    type: 'vowel',
    onsets: [['b', 'c', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'm', 'n', 'p', 'r', 's', 't', 'v', 'w', 'z']],
    vowels: ['a', 'e', 'i', 'o', 'u'],
    codas: [['b', 'd', 'g', 'p', 't', 'k', 'm', 'n', 's', 'x']],
  },
  'ending blends': {
    type: 'coda',
    onsets: [['l', 'd', 'm', 'r', 'b', 'w', 'f', 'h']],
    vowels: ['a', 'e', 'i', 'o', 'u'],
    codas: [['mp', 'nt', 'sk', 'ft', 'nd']],
  },
};
