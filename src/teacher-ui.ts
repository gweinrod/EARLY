import type { CurriculumStageId } from './curriculum';
import { STAGE_PILL_LABEL } from './units';
import { isLetterWritingStage } from './units';
import type { AppSettings } from './settings';
import { $, hide, show } from './ui';

function isSpeechSeedStage(stageId: CurriculumStageId): boolean {
  return stageId === 'alphabet' || stageId === 'consonants';
}

export function applyTeacherToolsUi(settings: AppSettings, stageId: CurriculumStageId): void {
  const teacherTools = $('teacherTools');
  if (settings.teacherMode) {
    show('teacherTools');
    teacherTools.hidden = false;
  } else {
    hide('teacherTools');
    teacherTools.hidden = true;
  }

  const debugLabel = document.querySelector('#debugMode')?.closest('label');
  if (debugLabel instanceof HTMLElement) {
    debugLabel.style.display = settings.teacherMode ? '' : 'none';
  }

  const voiceBtn = $('btnRedoVoiceBank');
  const writingBtn = $('btnRedoWritingBank');
  const showVoice = settings.teacherMode && isSpeechSeedStage(stageId);
  const showWriting = settings.teacherMode && isLetterWritingStage(stageId);

  voiceBtn.hidden = !showVoice;
  voiceBtn.style.display = showVoice ? '' : 'none';
  if (showVoice) {
    const label = STAGE_PILL_LABEL[stageId] ?? 'Voice';
    voiceBtn.textContent = `Record teacher voice (seed) — ${label}`;
  }

  writingBtn.hidden = !showWriting;
  writingBtn.style.display = showWriting ? '' : 'none';
}
