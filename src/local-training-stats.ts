import type { CurriculumStageId } from './curriculum';
import { getTrainingReadiness } from './letter-writing-training';
import { isLetterWritingStage } from './units';
import { $ } from './ui';
import { countCalibrationQueueForStage } from './cloud-calibration';
import { countVoiceQueueForStage } from './cloud-voice-bank';
import { loadAttempts } from './session-log';
import { loadVoiceBank } from './voice-bank';

export function countLocalVoiceSamples(stageId: CurriculumStageId): number {
  const bank = loadVoiceBank(stageId);
  let n = 0;
  for (const list of Object.values(bank.samples)) {
    n += list?.length ?? 0;
  }
  return n + countVoiceQueueForStage(stageId);
}

export function countLocalJudgments(stageId: CurriculumStageId): number {
  const judged = loadAttempts().filter(
    (a) =>
      a.curriculumStage === stageId &&
      (a.teacherAgrees !== null || (a.teacherHeard !== null && a.teacherHeard.length > 0)),
  ).length;
  return judged + countCalibrationQueueForStage(stageId);
}

export function formatLocalTrainingLine(stageId: CurriculumStageId): string {
  const voice = countLocalVoiceSamples(stageId);
  const judgments = countLocalJudgments(stageId);
  return `Local training: ${voice} voice on local · ${judgments} judgments on local`;
}

export function refreshLocalTrainingStatus(stageId: CurriculumStageId): void {
  if (isLetterWritingStage(stageId)) {
    $('localTrainingStatus').textContent =
      `Letter writing: ${getTrainingReadiness().message}`;
    return;
  }
  $('localTrainingStatus').textContent = formatLocalTrainingLine(stageId);
}
