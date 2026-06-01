/**
 * Session + mastery summary for speech stages (letter names, letter sounds).
 */

import type { CurriculumStageId } from './curriculum';
import { getStage } from './curriculum';
import { getSessionMeta, loadAttempts } from './session-log';

const MASTERY_MIN_ATTEMPTS = 3;
const MASTERY_PASS_RATE = 0.8;

export interface SpeechStageProgress {
  sessionAttempts: number;
  sessionPassRate: number;
  mastered: number;
  totalTargets: number;
  overallAccuracy: number;
}

export function getSpeechStageProgress(stageId: CurriculumStageId): SpeechStageProgress {
  const stage = getStage(stageId);
  const totalTargets = stage.items.length;
  const meta = getSessionMeta();
  const attempts = loadAttempts().filter((a) => a.curriculumStage === stageId);
  const sessionAttempts = attempts.filter((a) => a.sessionId === meta.sessionId);
  const sessionPasses = sessionAttempts.filter((a) => a.appPass || a.teacherAgrees === true).length;

  const byKey = new Map<string, typeof attempts>();
  for (const a of attempts) {
    const list = byKey.get(a.targetKey) ?? [];
    list.push(a);
    byKey.set(a.targetKey, list);
  }

  let mastered = 0;
  for (const item of stage.items) {
    const list = byKey.get(item.key) ?? [];
    if (list.length < MASTERY_MIN_ATTEMPTS) continue;
    const passes = list.filter((a) => a.appPass || a.teacherAgrees === true).length;
    if (passes / list.length >= MASTERY_PASS_RATE) mastered++;
  }

  const totalPass = attempts.filter((a) => a.appPass || a.teacherAgrees === true).length;

  return {
    sessionAttempts: sessionAttempts.length,
    sessionPassRate:
      sessionAttempts.length > 0 ? sessionPasses / sessionAttempts.length : 0,
    mastered,
    totalTargets,
    overallAccuracy: attempts.length > 0 ? totalPass / attempts.length : 0,
  };
}
