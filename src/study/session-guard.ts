const SPEECH_MODE_KEY = 'work1.studySpeechMode';

function clearSpellModeForNormalStudy(event: Event): void {
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (!target.closest('.study-now')) return;
  sessionStorage.removeItem(SPEECH_MODE_KEY);
}

document.addEventListener('click', clearSpellModeForNormalStudy, true);
