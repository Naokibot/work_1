import { computeExamPlan, studyPreset, type PlannerCard, type PlannerHistory, type StudyPresetName } from './learning-tools.js';

const DB_NAME = 'work_1_study_cards';
const DB_VERSION = 2;
const PLAN_KEY = 'work1.examPlans.v1';
const SPEECH_MODE_KEY = 'work1.studySpeechMode';
const SPEECH_RATE_KEY = 'work1.studySpeechRate';

type ExamPlans = Record<string, string>;

interface AnkiStateLite {
  activeProfileId: string;
  decks: Array<{ id: string; profileId: string; name: string }>;
}

interface CardLite extends PlannerCard {
  profileId?: string;
}

function byId<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDBを開けませんでした。'));
    request.onblocked = () => reject(new Error('別タブがデータベースを使用中です。'));
  });
}

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error ?? new Error('IndexedDBの読み込みに失敗しました。'));
  });
}

async function studyDataForDeck(deckId: string): Promise<{ cards: CardLite[]; history: PlannerHistory[]; deckName: string }> {
  const db = await openDatabase();
  try {
    const tx = db.transaction(['cards', 'history', 'anki'], 'readonly');
    const [cards, history, state] = await Promise.all([
      request(tx.objectStore('cards').getAll()) as Promise<CardLite[]>,
      request(tx.objectStore('history').getAll()) as Promise<PlannerHistory[]>,
      request(tx.objectStore('anki').get('anki')) as Promise<AnkiStateLite | undefined>
    ]);
    const selected = state?.decks.find((deck) => deck.id === deckId);
    const selectedName = selected?.name ?? '';
    const deckIds = new Set(
      (state?.decks ?? [])
        .filter((deck) => deck.id === deckId || (selectedName && deck.name.startsWith(`${selectedName}::`)))
        .map((deck) => deck.id)
    );
    if (!deckIds.size) deckIds.add(deckId);
    const activeProfile = state?.activeProfileId;
    const scopedCards = cards.filter((card) => deckIds.has(card.deckId ?? '') && (!activeProfile || (card.profileId ?? 'profile_default') === activeProfile));
    const cardIds = new Set(scopedCards.map((card) => card.id));
    return { cards: scopedCards, history: history.filter((item) => cardIds.has(item.cardId)), deckName: selectedName };
  } finally {
    db.close();
  }
}

async function findDeckByVisibleName(name: string): Promise<string | null> {
  const db = await openDatabase();
  try {
    const tx = db.transaction('anki', 'readonly');
    const state = await request(tx.objectStore('anki').get('anki')) as AnkiStateLite | undefined;
    return state?.decks.find((deck) => deck.profileId === state.activeProfileId && deck.name === name)?.id ?? null;
  } finally {
    db.close();
  }
}

function loadPlans(): ExamPlans {
  try {
    const parsed = JSON.parse(localStorage.getItem(PLAN_KEY) ?? '{}') as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const result: ExamPlans = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) if (typeof value === 'string') result[key] = value;
    return result;
  } catch {
    return {};
  }
}

function savePlan(deckId: string, value: string): void {
  const plans = loadPlans();
  if (value) plans[deckId] = value;
  else delete plans[deckId];
  localStorage.setItem(PLAN_KEY, JSON.stringify(plans));
}

function localDateInput(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function ensureStudyOptions(): void {
  const mode = byId<HTMLSelectElement>('study-mode');
  const style = byId<HTMLSelectElement>('study-style');
  if (mode && !mode.querySelector('option[value="deck"]')) mode.prepend(new Option('学習コース（復習＋新規）', 'deck'));
  if (style && !style.querySelector('option[value="spell"]')) style.append(new Option('音声スペル', 'spell'));

  const form = byId<HTMLFormElement>('study-form');
  if (!form || form.dataset.enhancedStudyReady === '1') return;
  form.dataset.enhancedStudyReady = '1';

  const size = byId<HTMLSelectElement>('study-size');
  if (size && !byId<HTMLInputElement>('study-exam-date')) {
    const label = document.createElement('label');
    label.className = 'enhanced-exam-date';
    label.textContent = '試験日（任意）';
    const input = document.createElement('input');
    input.id = 'study-exam-date';
    input.type = 'date';
    input.min = localDateInput();
    label.append(input);
    size.closest('label')?.after(label);
  }

  form.addEventListener('submit', () => {
    const styleSelect = byId<HTMLSelectElement>('study-style');
    const deckSelect = byId<HTMLSelectElement>('study-deck');
    const examDate = byId<HTMLInputElement>('study-exam-date');
    const spell = styleSelect?.value === 'spell';
    sessionStorage.setItem(SPEECH_MODE_KEY, spell ? 'spell' : '');
    if (spell && styleSelect) styleSelect.value = 'type';
    if (deckSelect?.value && examDate?.value) savePlan(deckSelect.value, examDate.value);
  }, true);
}

function configureStudy(presetName: StudyPresetName, deckId: string, examDate = ''): void {
  const custom = [...document.querySelectorAll<HTMLButtonElement>('.overview-actions button')]
    .find((button) => button.textContent?.includes('カスタム学習'));
  if (!custom) return;
  custom.click();
  window.setTimeout(() => {
    ensureStudyOptions();
    const preset = studyPreset(presetName);
    const mode = byId<HTMLSelectElement>('study-mode');
    const style = byId<HTMLSelectElement>('study-style');
    const deck = byId<HTMLSelectElement>('study-deck');
    const size = byId<HTMLSelectElement>('study-size');
    const date = byId<HTMLInputElement>('study-exam-date');
    if (mode) mode.value = preset.mode;
    if (style) style.value = preset.speech ? 'spell' : preset.style;
    if (deck) deck.value = deckId;
    if (size) {
      if (![...size.options].some((option) => Number(option.value) === preset.size)) size.append(new Option(String(preset.size), String(preset.size)));
      size.value = String(preset.size);
    }
    if (date) date.value = examDate;
  }, 0);
}

function presetButton(label: string, description: string, name: StudyPresetName, deckId: string, examDate: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'enhanced-study-button';
  const strong = document.createElement('strong');
  strong.textContent = label;
  const small = document.createElement('small');
  small.textContent = description;
  button.append(strong, small);
  button.addEventListener('click', () => configureStudy(name, deckId, examDate));
  return button;
}

async function renderExamPlan(panel: HTMLElement, deckId: string, examDate: string): Promise<void> {
  const result = panel.querySelector<HTMLElement>('.enhanced-plan-result');
  if (!result) return;
  if (!examDate) {
    result.textContent = '試験日を入れると、未学習・苦手・試験日までに復習予定のカードから1日の目安を計算します。';
    return;
  }
  try {
    const data = await studyDataForDeck(deckId);
    const plan = computeExamPlan(data.cards, data.history, examDate);
    if (!plan.valid) {
      result.textContent = '今日以降の有効な試験日を設定してください。';
      return;
    }
    result.replaceChildren();
    const summary = document.createElement('div');
    summary.className = 'enhanced-plan-metrics';
    const values: Array<[string, string]> = [
      [`${plan.daysLeft}日`, '試験まで'],
      [`${plan.dailyTarget}枚`, '1日の目安'],
      [`${plan.workloadCards}枚`, '要強化'],
      [`${plan.readiness}%`, '準備度']
    ];
    for (const [value, label] of values) {
      const item = document.createElement('span');
      item.innerHTML = `<strong>${value}</strong><small>${label}</small>`;
      summary.append(item);
    }
    const progress = document.createElement('div');
    progress.className = 'enhanced-plan-progress';
    const track = document.createElement('span');
    const fill = document.createElement('i');
    fill.style.width = `${Math.round(plan.progressToday * 100)}%`;
    track.append(fill);
    const text = document.createElement('small');
    text.textContent = plan.dailyTarget ? `今日 ${plan.reviewedToday}/${plan.dailyTarget}枚` : '今日の追加課題はありません';
    progress.append(track, text);
    result.append(summary, progress);
  } catch {
    result.textContent = '学習計画を読み込めませんでした。データは変更されていません。';
  }
}

async function enhanceDeckOverview(): Promise<void> {
  const overview = document.querySelector<HTMLElement>('.deck-overview');
  if (!overview || overview.dataset.studyExperienceReady === '1') return;
  const heading = overview.querySelector('h2')?.textContent?.trim();
  if (!heading) return;
  const deckId = await findDeckByVisibleName(heading).catch(() => null);
  if (!deckId || !overview.isConnected) return;
  overview.dataset.studyExperienceReady = '1';

  const savedDate = loadPlans()[deckId] ?? '';
  const section = document.createElement('section');
  section.className = 'enhanced-study-section';
  const title = document.createElement('div');
  title.className = 'enhanced-study-heading';
  title.innerHTML = '<div><strong>学習モード</strong><small>目的に合わせて1タップで開始</small></div>';
  const buttons = document.createElement('div');
  buttons.className = 'enhanced-study-grid';
  buttons.append(
    presetButton('Learn', '復習＋新規を順に', 'learn', deckId, savedDate),
    presetButton('テスト', 'ランダム選択問題', 'test', deckId, savedDate),
    presetButton('筆記', '答えを入力して確認', 'write', deckId, savedDate),
    presetButton('スペル', '音声を聞いて入力', 'spell', deckId, savedDate),
    presetButton('間違い', '直近のミスだけ', 'wrong', deckId, savedDate)
  );
  section.append(title, buttons);

  const planPanel = document.createElement('section');
  planPanel.className = 'enhanced-plan-panel';
  const planHeader = document.createElement('div');
  planHeader.className = 'enhanced-plan-header';
  const planTitle = document.createElement('div');
  planTitle.innerHTML = '<strong>試験プラン</strong><small>試験日から今日の学習量を逆算</small>';
  const dateWrap = document.createElement('div');
  dateWrap.className = 'enhanced-plan-date';
  const input = document.createElement('input');
  input.type = 'date';
  input.min = localDateInput();
  input.value = savedDate;
  input.setAttribute('aria-label', '試験日');
  const save = document.createElement('button');
  save.type = 'button';
  save.textContent = '保存';
  save.addEventListener('click', () => {
    savePlan(deckId, input.value);
    void renderExamPlan(planPanel, deckId, input.value);
  });
  dateWrap.append(input, save);
  planHeader.append(planTitle, dateWrap);
  const planResult = document.createElement('div');
  planResult.className = 'enhanced-plan-result';
  planPanel.append(planHeader, planResult);

  const actions = overview.querySelector('.overview-actions');
  if (actions) actions.before(section, planPanel);
  else overview.append(section, planPanel);
  await renderExamPlan(planPanel, deckId, savedDate);
}

function speechRate(): number {
  const value = Number(localStorage.getItem(SPEECH_RATE_KEY) ?? '0.9');
  return Number.isFinite(value) && value >= 0.5 && value <= 1.5 ? value : 0.9;
}

function speak(text: string): void {
  if (!text || !('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = speechRate();
  utterance.lang = /[ぁ-んァ-ヶ一-龯]/u.test(text) ? 'ja-JP' : 'en-US';
  speechSynthesis.speak(utterance);
}

let lastSpokenKey = '';
function applySpeechMode(): void {
  const screen = byId<HTMLElement>('review-screen');
  const answer = byId<HTMLElement>('review-answer');
  const question = byId<HTMLElement>('review-question');
  if (!screen || !answer || !question) return;
  const active = sessionStorage.getItem(SPEECH_MODE_KEY) === 'spell' && !screen.hidden;
  screen.classList.toggle('enhanced-spell-session', active);
  let prompt = byId<HTMLElement>('enhanced-spell-prompt');
  if (active && !prompt) {
    prompt = document.createElement('div');
    prompt.id = 'enhanced-spell-prompt';
    prompt.className = 'enhanced-spell-prompt';
    const label = document.createElement('strong');
    label.textContent = '🔊 音声を聞いて入力してください';
    const controls = document.createElement('div');
    for (const [rate, text] of [[0.7, 'ゆっくり'], [0.9, '標準'], [1.1, '速め']] as const) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = text;
      button.addEventListener('click', () => {
        localStorage.setItem(SPEECH_RATE_KEY, String(rate));
        speak(answer.textContent?.trim() ?? '');
      });
      controls.append(button);
    }
    prompt.append(label, controls);
    question.before(prompt);
  }
  if (!active) {
    prompt?.remove();
    lastSpokenKey = '';
    return;
  }
  const text = answer.textContent?.trim() ?? '';
  const progress = byId<HTMLElement>('review-progress')?.textContent ?? '';
  const key = `${progress}\n${text}`;
  if (text && key !== lastSpokenKey) {
    lastSpokenKey = key;
    window.setTimeout(() => speak(text), 80);
  }
}

function installReplaySpeech(): void {
  const replay = byId<HTMLButtonElement>('review-replay');
  if (!replay || replay.dataset.enhancedSpeechReady === '1') return;
  replay.dataset.enhancedSpeechReady = '1';
  replay.addEventListener('click', (event) => {
    const screen = byId<HTMLElement>('review-screen');
    if (sessionStorage.getItem(SPEECH_MODE_KEY) !== 'spell' || screen?.hidden) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    speak(byId<HTMLElement>('review-answer')?.textContent?.trim() ?? '');
  }, true);
}

function installStyles(): void {
  if (byId('enhanced-study-styles')) return;
  const style = document.createElement('style');
  style.id = 'enhanced-study-styles';
  style.textContent = `
    .enhanced-study-section,.enhanced-plan-panel{margin:22px 0;padding:18px;border:2px solid #171717;border-radius:22px;background:#fff}
    .enhanced-study-heading,.enhanced-plan-header{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:14px}
    .enhanced-study-heading strong,.enhanced-plan-header strong{display:block;font-size:18px}.enhanced-study-heading small,.enhanced-plan-header small{display:block;margin-top:3px;color:#6b685f}
    .enhanced-study-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px}.enhanced-study-button{min-height:72px;padding:10px;border:1.5px solid #171717;border-radius:16px;background:#faf8f1;text-align:left}.enhanced-study-button:hover,.enhanced-study-button:focus-visible{background:#dfff4f}.enhanced-study-button strong,.enhanced-study-button small{display:block}.enhanced-study-button strong{font-size:15px}.enhanced-study-button small{margin-top:4px;color:#6b685f;font-size:11px;line-height:1.25}
    .enhanced-plan-date{display:flex;gap:6px}.enhanced-plan-date input,.enhanced-exam-date input{min-height:40px;padding:7px 10px;border:1.5px solid #171717;border-radius:12px;background:#fff}.enhanced-plan-date button{min-height:40px;padding:7px 13px;border:1.5px solid #171717;border-radius:12px;background:#dfff4f;font-weight:800}
    .enhanced-plan-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.enhanced-plan-metrics span{padding:12px;border:1px solid #d4d0c4;border-radius:14px;background:#faf8f1}.enhanced-plan-metrics strong,.enhanced-plan-metrics small{display:block}.enhanced-plan-metrics strong{font-size:22px}.enhanced-plan-metrics small{margin-top:3px;color:#6b685f}
    .enhanced-plan-progress{margin-top:12px}.enhanced-plan-progress>span{display:block;height:10px;overflow:hidden;border:1px solid #171717;border-radius:999px;background:#ece8dc}.enhanced-plan-progress i{display:block;height:100%;background:#dfff4f}.enhanced-plan-progress small{display:block;margin-top:6px;color:#6b685f}
    .enhanced-spell-session #review-question{display:none!important}.enhanced-spell-prompt{margin:10px 0 24px;padding:18px;border:2px solid #171717;border-radius:18px;background:#efffb0}.enhanced-spell-prompt strong{display:block;font-size:clamp(22px,4vw,34px)}.enhanced-spell-prompt div{display:flex;gap:6px;margin-top:12px}.enhanced-spell-prompt button{padding:7px 11px;border:1.5px solid #171717;border-radius:999px;background:#fff;font-weight:700}
    @media(max-width:760px){.enhanced-study-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.enhanced-plan-header{align-items:flex-start;flex-direction:column}.enhanced-plan-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.enhanced-study-button{min-height:68px}}
  `;
  document.head.append(style);
}

let enhancementQueued = false;
function queueEnhancement(): void {
  if (enhancementQueued) return;
  enhancementQueued = true;
  window.setTimeout(() => {
    enhancementQueued = false;
    ensureStudyOptions();
    installReplaySpeech();
    void enhanceDeckOverview();
    applySpeechMode();
  }, 30);
}

function boot(): void {
  installStyles();
  ensureStudyOptions();
  installReplaySpeech();
  queueEnhancement();
  const view = byId<HTMLElement>('view');
  const review = byId<HTMLElement>('review-screen');
  if (view) new MutationObserver(queueEnhancement).observe(view, { childList: true, subtree: true });
  if (review) new MutationObserver(queueEnhancement).observe(review, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
