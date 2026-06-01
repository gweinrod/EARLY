/**
 * Per-stage progress panel (Unit 1: letter names, letter sounds, letter writing).
 * Shown above unit/stage pills — not inside the ML debug panel.
 */

import type { CurriculumStageId } from './curriculum';
import { STAGE_PILL_LABEL } from './units';
import {
  getAllMasteryStats,
  getSessionSummary,
} from './letter-writing-training';
import { getSpeechStageProgress } from './speech-stage-progress';
import { isLetterWritingStage } from './units';

const UNIT1_STAGES: CurriculumStageId[] = ['alphabet', 'consonants', 'letter-writing'];

function isUnit1Stage(stageId: CurriculumStageId): boolean {
  return UNIT1_STAGES.includes(stageId);
}

function panelTitle(stageId: CurriculumStageId): string {
  const label = STAGE_PILL_LABEL[stageId] ?? stageId;
  return `${label} Progress`;
}

function pct(n: number): number {
  return Math.round(n * 100);
}

export function mountStageProgressPanel(container: HTMLElement): {
  refresh: (stageId: CurriculumStageId) => void;
} {
  container.className = 'stage-progress-panel';

  function refresh(stageId: CurriculumStageId): void {
    if (!isUnit1Stage(stageId)) {
      container.innerHTML = '';
      container.hidden = true;
      return;
    }
    container.hidden = false;

    if (isLetterWritingStage(stageId)) {
      const session = getSessionSummary();
      const stats = getAllMasteryStats();
      container.innerHTML = `
        <div class="stage-progress-title">${panelTitle(stageId)}</div>
        <div class="stage-progress-line">Session: ${session.totalAttempts} attempts · ${pct(session.accuracy)}% pass rate</div>
        <div class="stage-progress-line">Mastered: ${stats.mastered} / ${stats.totalLetters} letters</div>
        <div class="stage-progress-line">Overall accuracy: ${pct(stats.overallAccuracy)}%</div>
      `;
      return;
    }

    const p = getSpeechStageProgress(stageId);
    container.innerHTML = `
      <div class="stage-progress-title">${panelTitle(stageId)}</div>
      <div class="stage-progress-line">Session: ${p.sessionAttempts} attempts · ${pct(p.sessionPassRate)}% pass rate</div>
      <div class="stage-progress-line">Mastered: ${p.mastered} / ${p.totalTargets} letters</div>
      <div class="stage-progress-line">Overall accuracy: ${pct(p.overallAccuracy)}%</div>
    `;
  }

  return { refresh };
}

export function showStageProgressSection(visible: boolean): void {
  const el = document.getElementById('stageProgressSection');
  if (el) el.style.display = visible ? 'block' : 'none';
}
