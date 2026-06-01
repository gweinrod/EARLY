/**
 * EARLY units 1–7 and per-unit stage pills (scope & sequence skeleton).
 */

export type CurriculumUnitId = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type CurriculumStageId =
  | 'alphabet'
  | 'consonants'
  | 'letter-writing'
  | 'short-vowels'
  | 'legacy-cvc'
  | 'u2-cv'
  | 'u2-vc'
  | 'u2-cvc'
  | 'u3-ccv'
  | 'u3-vcc'
  | 'u3-ccvc'
  | 'u3-cvcc'
  | 'u3-ccvcc'
  | 'u4-consonant-teams'
  | 'u4-vowel-teams'
  | 'u5-ccv'
  | 'u5-vcc'
  | 'u5-cvcc'
  | 'u6-first-ten'
  | 'u6-second-ten'
  | 'u6-third-ten'
  | 'u6-fourth-ten'
  | 'u6-fifth-ten'
  | 'u6-sixth-ten'
  | 'u6-seventh-ten'
  | 'u6-eighth-ten'
  | 'u6-ninth-ten'
  | 'u6-last-ten'
  | 'u7-first-hundred'
  | 'u7-second-hundred'
  | 'u7-third-hundred'
  | 'u7-fourth-hundred'
  | 'u7-fifth-hundred'
  | 'u7-sixth-hundred'
  | 'u7-seventh-hundred'
  | 'u7-eighth-hundred'
  | 'u7-ninth-hundred'
  | 'u7-last-hundred';

export interface CurriculumUnitDef {
  id: CurriculumUnitId;
  /** Pill label, e.g. "Unit 1". */
  pillLabel: string;
  /** Heading above stage pills for this unit. */
  stageSectionLabel: string;
  stageIds: CurriculumStageId[];
}

const U6_TEN_LABELS = [
  'First Ten',
  'Second Ten',
  'Third Ten',
  'Fourth Ten',
  'Fifth Ten',
  'Sixth Ten',
  'Seventh Ten',
  'Eighth Ten',
  'Ninth Ten',
  'Last Ten',
] as const;

const U7_HUNDRED_LABELS = [
  'First Hundred',
  'Second Hundred',
  'Third Hundred',
  'Fourth Hundred',
  'Fifth Hundred',
  'Sixth Hundred',
  'Seventh Hundred',
  'Eighth Hundred',
  'Ninth Hundred',
  'Last Hundred',
] as const;

function tenStageId(label: (typeof U6_TEN_LABELS)[number]): CurriculumStageId {
  const slug = label.toLowerCase().replace(/ /g, '-');
  return `u6-${slug}` as CurriculumStageId;
}

function hundredStageId(label: (typeof U7_HUNDRED_LABELS)[number]): CurriculumStageId {
  const slug = label.toLowerCase().replace(/ /g, '-');
  return `u7-${slug}` as CurriculumStageId;
}

export const UNIT_ORDER: CurriculumUnitId[] = [1, 2, 3, 4, 5, 6, 7];

/** Units shown as pills in the UI (units 2–7 hidden until ready). */
export const UNIT_NAV_VISIBLE: readonly CurriculumUnitId[] = [1];

export function isUnitNavVisible(unitId: CurriculumUnitId): boolean {
  return (UNIT_NAV_VISIBLE as readonly number[]).includes(unitId);
}

export const CURRICULUM_UNITS: Record<CurriculumUnitId, CurriculumUnitDef> = {
  1: {
    id: 1,
    pillLabel: 'Unit 1',
    stageSectionLabel: 'Letter Names and Sounds',
    stageIds: ['alphabet', 'consonants', 'letter-writing'],
  },
  2: {
    id: 2,
    pillLabel: 'Unit 2',
    stageSectionLabel: 'Synthesizing Basic Sounds',
    stageIds: ['u2-cv', 'u2-vc', 'u2-cvc'],
  },
  3: {
    id: 3,
    pillLabel: 'Unit 3',
    stageSectionLabel: 'Blending Basic Sounds',
    stageIds: ['u3-ccv', 'u3-vcc', 'u3-ccvc', 'u3-cvcc', 'u3-ccvcc'],
  },
  4: {
    id: 4,
    pillLabel: 'Unit 4',
    stageSectionLabel: 'Letter Teams',
    stageIds: ['u4-consonant-teams', 'u4-vowel-teams'],
  },
  5: {
    id: 5,
    pillLabel: 'Unit 5',
    stageSectionLabel: 'Blending Letter Teams',
    stageIds: ['u5-ccv', 'u5-vcc', 'u5-cvcc'],
  },
  6: {
    id: 6,
    pillLabel: 'Unit 6',
    stageSectionLabel: 'Frequent Irregular Words',
    stageIds: U6_TEN_LABELS.map(tenStageId),
  },
  7: {
    id: 7,
    pillLabel: 'Unit 7',
    stageSectionLabel: 'More Irregular Words',
    stageIds: U7_HUNDRED_LABELS.map(hundredStageId),
  },
};

/** Pill label for each stage (shown under the unit-specific section heading). */
export const STAGE_PILL_LABEL: Record<CurriculumStageId, string> = {
  alphabet: 'Letter Names',
  consonants: 'Letter Sounds',
  'letter-writing': 'Letter Writing',
  'short-vowels': 'Short Vowels',
  'legacy-cvc': 'Legacy',
  'u2-cv': 'CV',
  'u2-vc': 'VC',
  'u2-cvc': 'CVC',
  'u3-ccv': 'CCV',
  'u3-vcc': 'VCC',
  'u3-ccvc': 'CCVC',
  'u3-cvcc': 'CVCC',
  'u3-ccvcc': 'CCVCC',
  'u4-consonant-teams': 'Consonant Teams',
  'u4-vowel-teams': 'Vowel Teams',
  'u5-ccv': 'CCV',
  'u5-vcc': 'VCC',
  'u5-cvcc': 'CVCC',
  'u6-first-ten': 'First Ten',
  'u6-second-ten': 'Second Ten',
  'u6-third-ten': 'Third Ten',
  'u6-fourth-ten': 'Fourth Ten',
  'u6-fifth-ten': 'Fifth Ten',
  'u6-sixth-ten': 'Sixth Ten',
  'u6-seventh-ten': 'Seventh Ten',
  'u6-eighth-ten': 'Eighth Ten',
  'u6-ninth-ten': 'Ninth Ten',
  'u6-last-ten': 'Last Ten',
  'u7-first-hundred': 'First Hundred',
  'u7-second-hundred': 'Second Hundred',
  'u7-third-hundred': 'Third Hundred',
  'u7-fourth-hundred': 'Fourth Hundred',
  'u7-fifth-hundred': 'Fifth Hundred',
  'u7-sixth-hundred': 'Sixth Hundred',
  'u7-seventh-hundred': 'Seventh Hundred',
  'u7-eighth-hundred': 'Eighth Hundred',
  'u7-ninth-hundred': 'Ninth Hundred',
  'u7-last-hundred': 'Last Hundred',
};

export const STAGE_TO_UNIT: Record<CurriculumStageId, CurriculumUnitId> = Object.fromEntries(
  UNIT_ORDER.flatMap((unitId) =>
    CURRICULUM_UNITS[unitId].stageIds.map((stageId) => [stageId, unitId] as const),
  ),
) as Record<CurriculumStageId, CurriculumUnitId>;

/** All stage ids (including legacy / skeleton). */
export const ALL_STAGE_IDS = [
  ...new Set([
    ...UNIT_ORDER.flatMap((u) => CURRICULUM_UNITS[u].stageIds),
    'short-vowels',
    'legacy-cvc',
  ]),
] as CurriculumStageId[];

export function getUnit(unitId: CurriculumUnitId): CurriculumUnitDef {
  return CURRICULUM_UNITS[unitId];
}

export function getUnitForStage(stageId: CurriculumStageId): CurriculumUnitId {
  return STAGE_TO_UNIT[stageId] ?? 1;
}

export function getStageIdsForUnit(unitId: CurriculumUnitId): CurriculumStageId[] {
  return CURRICULUM_UNITS[unitId].stageIds;
}

export function isStageInUnit(stageId: CurriculumStageId, unitId: CurriculumUnitId): boolean {
  return CURRICULUM_UNITS[unitId].stageIds.includes(stageId);
}

export function defaultStageForUnit(unitId: CurriculumUnitId): CurriculumStageId {
  return CURRICULUM_UNITS[unitId].stageIds[0];
}

export function isLetterWritingStage(stageId: CurriculumStageId): boolean {
  return stageId === 'letter-writing';
}

/** Practice prompt above the target display. */
export function wordPromptForUnitStage(unitId: CurriculumUnitId, stageId: CurriculumStageId): string {
  if (unitId === 1) {
    if (stageId === 'alphabet') return 'Say this letter name';
    if (stageId === 'consonants') return 'Say this letter sound';
    if (stageId === 'letter-writing') return 'Practice writing this letter';
    return 'Say this letter name';
  }
  if (unitId === 2 || unitId === 3) return 'Say this nonsense word';
  if (unitId === 4) return "Say this letter team's sound";
  if (unitId === 5) return 'Say this nonsense word';
  if (unitId === 6 || unitId === 7) return 'Say this irregular word';
  return 'Say this word';
}

export function isKnownStageId(id: string): id is CurriculumStageId {
  return id in STAGE_PILL_LABEL;
}

export function isKnownUnitId(n: number): n is CurriculumUnitId {
  return n >= 1 && n <= 7 && Number.isInteger(n);
}
