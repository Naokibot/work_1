import type { ReviewMode, ReviewSession, ReviewStyle, StudyCard } from '../types.js';
import { refreshCardNumberOptions } from './card-number.js';
import { exportAnkiPackage, importAnkiPackage } from '../anki/anki-package.js';
import { AnkiCenter } from '../anki/center.js';
import { cardsInDeck, createDeck, createNote, importCollectionPackage, importTextCards, initializeAnkiCollection } from '../anki/collection.js';
import { DEFAULT_DECK_ID } from '../anki/defaults.js';
import { noteFieldDisplayName, noteTypeDisplayName } from '../anki/localization.js';
import { ReviewController } from '../review/controller.js';
import { selectCards } from '../review/select.js';
import { isDue } from '../scheduler/scheduler.js';
import { exportCsv, exportJson, importJson } from '../storage/backup.js';
import { getAnkiState, getCards, getCurrentSession, getHistory, getQueue, getSettings, saveSettings } from '../storage/db.js';
import { cardStateCounts, forecast, intervalHistogram, ratingCounts, streak, trueRetention } from '../statistics/anki-stats.js';
import { dailyCounts } from '../statistics/stats.js';
import { isAllowedGasUrl, syncNow } from '../sync/client.js';
import { button, clear, el } from '../ui/dom.js';
import { formatDuration, nowIso } from '../utils/core.js';

type Route = 'home' | 'anki' | 'stats' | 'settings';

function byId<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node as T;
}

function deckDepth(name: string): number { return Math.max(0, name.split('::').length - 1); }
function deckLeaf(name: string): string { return name.split('::').at(-1) ?? name; }
function usable(card: StudyCard, now = Date.now()): boolean {
  return !card.deletedAt && !card.suspended && (!card.buriedUntil || new Date(card.buriedUntil).getTime() <= now);
}

export class App {
  private route: Route = 'home';
  private selectedDeckId: string | null = null;
  private statusTimer = 0;
  private statsRange: 'week' | 'month' | 'year' | 'all' = 'week';
  private activeEditor: HTMLTextAreaElement | null = null;
  private readonly view = byId<HTMLElement>('view');
  private readonly title = byId<HTMLElement>('page-title');
  private readonly status = byId<HTMLElement>('status-message');
  private readonly syncButton = byId<HTMLButtonElement>('sync-button');
  private readonly syncBadge = byId<HTMLElement>('sync-badge');
  private readonly addButton = byId<HTMLButtonElement>('add-card-button');
  private readonly cardDialog = byId<HTMLDialogElement>('card-dialog');
  private readonly cardForm = byId<HTMLFormElement>('card-form');
  private readonly studyDialog = byId<HTMLDialogElement>('study-dialog');
  private readonly studyForm = byId<HTMLFormElement>('study-form');
  private readonly importFile = byId<HTMLInputElement>('import-file');
  private readonly profileLabel = byId<HTMLElement>('profile-label');
  private readonly review: ReviewController;
  private readonly anki: AnkiCenter;

  constructor() {
    this.review = new ReviewController(async () => { await this.refresh(); void this.autoSync(); });
    this.anki = new AnkiCenter({
      showStatus: (message, error) => this.showStatus(message, error),
      startCards: async (cards, mode, deckId, filteredDeckId) => this.startCards(cards, mode, deckId, filteredDeckId),
      refresh: () => this.refresh()
    });
    this.bindGlobalEvents();
  }

  async init(): Promise<void> {
    const migrated = await initializeAnkiCollection();
    await this.updateProfileLabel();
    await this.updateSyncBadge();
    await this.render();
    const session = await getCurrentSession();
    if (session && session.cursor < session.queue.length) {
      this.showStatus(`途中の学習を復元します（${session.cursor}/${session.queue.length}）。`, false, 7000);
      await this.review.resume(session);
    }
    if (migrated.migratedCards || migrated.notesAdded) this.showStatus(`既存データを移行しました：カード${migrated.migratedCards}件・ノート${migrated.notesAdded}件。`);
    if (navigator.onLine) void this.autoSync();
  }

  private bindGlobalEvents(): void {
    document.querySelectorAll<HTMLButtonElement>('[data-route]').forEach((item) => item.addEventListener('click', () => {
      const route = item.dataset.route as Route | undefined;
      if (route) void this.navigate(route);
    }));
    document.querySelectorAll<HTMLButtonElement>('[data-menu]').forEach((item) => item.addEventListener('click', () => this.handleMenu(item.dataset.menu ?? '')));
    this.addButton.addEventListener('click', () => void this.openAddDialog());
    byId<HTMLButtonElement>('note-deck-create').addEventListener('click', () => void this.quickCreateDeck());
    this.syncButton.addEventListener('click', () => void this.performSync());
    this.cardForm.addEventListener('submit', (event) => void this.handleAddNote(event));
    this.studyForm.addEventListener('submit', (event) => void this.handleStudySubmit(event));
    this.importFile.addEventListener('change', () => void this.handleFileImport());
    byId<HTMLSelectElement>('note-type').addEventListener('change', () => void this.rebuildNoteFields());
    byId<HTMLElement>('note-fields').addEventListener('focusin', (event) => {
      if (event.target instanceof HTMLTextAreaElement) this.activeEditor = event.target;
    });
    byId<HTMLElement>('note-editor-toolbar').addEventListener('click', (event) => {
      const target = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-editor-command]');
      if (target) this.editorCommand(target.dataset.editorCommand ?? '');
    });
    window.addEventListener('online', () => { this.showStatus('オンラインに戻りました。同期します。'); void this.autoSync(); });
    window.addEventListener('offline', () => this.showStatus('オフラインです。変更は端末に保存されます。'));
  }

  private handleMenu(menu: string): void {
    if (menu === 'file') {
      const choice = window.prompt('ファイル: 1=読み込み  2=完全JSON書き出し  3=CSV書き出し', '1');
      if (choice === '1') this.importFile.click();
      else if (choice === '2') void exportJson();
      else if (choice === '3') void exportCsv();
    } else if (menu === 'edit') {
      void this.navigate('anki');
      this.showStatus('ブラウザで一括編集とUndoを利用できます。');
    } else if (menu === 'tools') void this.navigate('settings');
    else if (menu === 'help') this.showStatus('Ankiの標準ワークフローに合わせたWeb実装です。');
  }

  private async navigate(route: Route): Promise<void> {
    this.route = route;
    if (route !== 'home') this.selectedDeckId = null;
    document.querySelectorAll<HTMLButtonElement>('[data-route]').forEach((item) => item.classList.toggle('is-active', item.dataset.route === route));
    await this.render();
    this.view.focus({ preventScroll: true });
  }

  private async render(): Promise<void> {
    clear(this.view);
    if (this.route === 'home') await this.renderDecks();
    else if (this.route === 'anki') await this.renderBrowser();
    else if (this.route === 'stats') await this.renderStats();
    else await this.renderSettings();
    await this.updateProfileLabel();
    await this.updateSyncBadge();
  }

  private async renderDecks(): Promise<void> {
    this.title.textContent = 'デッキ';
    const [cards, state] = await Promise.all([getCards(), getAnkiState()]);
    if (this.selectedDeckId) {
      const deck = state.decks.find((item) => item.id === this.selectedDeckId && item.profileId === state.activeProfileId);
      if (deck) { this.view.append(await this.deckOverview(deck.id, cards)); return; }
      this.selectedDeckId = null;
    }
    const page = el('section', { className: 'anki-page deck-page' });
    const header = el('div', { className: 'deck-title-row' });
    header.append(el('strong', { text: 'デッキ' }), el('strong', { text: '新規' }), el('strong', { text: '復習' }));
    page.append(header);
    const decks = state.decks.filter((deck) => deck.profileId === state.activeProfileId).sort((a, b) => a.name.localeCompare(b.name, 'ja'));
    const now = Date.now();
    for (const deck of decks) {
      const deckCards = cardsInDeck(cards, state, deck.id, true).filter((card) => usable(card, now));
      const fresh = deckCards.filter((card) => card.schedule.reps === 0).length;
      const due = deckCards.filter((card) => card.schedule.reps > 0 && isDue(card.schedule, new Date(now))).length;
      const row = el('div', { className: 'deck-row' });
      const name = el('button', { className: 'deck-name-button', attrs: { type: 'button' } });
      const inner = el('span', { className: 'deck-name-inner' });
      inner.style.paddingInlineStart = `${deckDepth(deck.name) * 20}px`;
      inner.append(el('span', { className: 'deck-caret', text: deck.name.includes('::') ? '↳' : '▾' }), el('span', { text: deckLeaf(deck.name) }));
      name.append(inner);
      name.addEventListener('click', () => { this.selectedDeckId = deck.id; void this.render(); });
      row.append(name, el('span', { className: 'deck-count new', text: String(fresh) }), el('span', { className: 'deck-count due', text: String(due) }));
      page.append(row);
    }
    if (!decks.length) page.append(el('p', { className: 'deck-empty', text: 'デッキがありません。' }));
    const footer = el('div', { className: 'deck-footer' });
    const create = button('デッキを作成', 'anki-button');
    const importButton = button('Ankiデッキを読み込む', 'anki-button');
    const custom = button('カスタム学習', 'anki-button');
    create.addEventListener('click', () => void this.promptCreateDeck());
    importButton.addEventListener('click', () => this.importFile.click());
    custom.addEventListener('click', () => void this.openStudyDialog());
    footer.append(create, importButton, custom);
    page.append(footer);
    this.view.append(page);
  }

  private async deckOverview(deckId: string, cards: StudyCard[]): Promise<HTMLElement> {
    const state = await getAnkiState();
    const deck = state.decks.find((item) => item.id === deckId);
    if (!deck) return el('p', { text: 'デッキが見つかりません。' });
    const deckCards = cardsInDeck(cards, state, deck.id, true).filter((card) => usable(card));
    const newCount = deckCards.filter((card) => card.schedule.reps === 0).length;
    const learning = deckCards.filter((card) => card.queue === 'learning' || card.queue === 'relearning').length;
    const review = deckCards.filter((card) => card.schedule.reps > 0 && isDue(card.schedule)).length;
    const node = el('section', { className: 'deck-overview' });
    node.append(el('h2', { text: deck.name }));
    if (deck.description) node.append(el('p', { className: 'deck-description', text: deck.description }));
    const table = el('table', { className: 'study-counts' });
    const body = document.createElement('tbody');
    for (const [label, count, className] of [['新規', newCount, 'count-new'], ['学習中', learning, 'count-learn'], ['復習', review, 'count-review']] as const) {
      const row = document.createElement('tr'); row.append(el('td', { className, text: label }), el('td', { className, text: String(count) })); body.append(row);
    }
    table.append(body); node.append(table);
    const start = button('今すぐ学習', 'anki-primary study-now');
    start.addEventListener('click', () => void this.studyDeck(deck.id));
    const actions = el('div', { className: 'overview-actions' });
    const options = button('オプション', 'anki-button'); options.addEventListener('click', () => void this.navigate('anki'));
    const custom = button('カスタム学習', 'anki-button'); custom.addEventListener('click', () => void this.openStudyDialog(undefined, deck.id));
    const exportDeck = button('デッキを書き出す (.apkg)', 'anki-button');
    exportDeck.addEventListener('click', () => void exportAnkiPackage(deck.id).then(() => this.showStatus(`${deck.name} をAnki形式で書き出しました。`)).catch((error) => this.showStatus(error instanceof Error ? error.message : 'デッキの書き出しに失敗しました。', true)));
    const back = button('デッキ一覧', 'anki-button'); back.addEventListener('click', () => { this.selectedDeckId = null; void this.render(); });
    actions.append(start, custom, options, exportDeck, back); node.append(actions);
    return node;
  }

  private async studyDeck(deckId: string): Promise<void> {
    const [cards, history, state] = await Promise.all([getCards(), getHistory(), getAnkiState()]);
    const deck = state.decks.find((item) => item.id === deckId);
    const preset = state.presets.find((item) => item.id === deck?.presetId) ?? state.presets[0];
    const selected = selectCards(cards, history, { mode: 'deck', state, deckId, newLimit: preset?.dailyNewLimit ?? 20, reviewLimit: preset?.dailyReviewLimit ?? 200 });
    if (!selected.length) { this.showStatus('このデッキの今日の学習は完了しています。'); return; }
    await this.startCards(selected, 'deck', deckId);
  }

  private async promptCreateDeck(): Promise<void> {
    const name = window.prompt('デッキ名（「親::子」でサブデッキも作れます）');
    if (!name?.trim()) return;
    try {
      const created = await createDeck(name.trim());
      this.selectedDeckId = created.id;
      this.showStatus('デッキを作成しました。すぐにカードを追加できます。');
      await this.render();
    } catch (error) { this.showStatus(error instanceof Error ? error.message : 'デッキを作成できませんでした。', true); }
  }

  private async quickCreateDeck(): Promise<void> {
    const name = window.prompt('新しいデッキ名（「親::子」でサブデッキも作れます）');
    if (!name?.trim()) return;
    try {
      const created = await createDeck(name.trim());
      const state = await getAnkiState();
      const deck = byId<HTMLSelectElement>('note-deck');
      deck.replaceChildren(...state.decks.filter((item) => item.profileId === state.activeProfileId).map((item) => new Option(item.name, item.id, false, item.id === created.id)));
      deck.value = created.id;
      this.showStatus(created.name + ' を作成して選択しました。');
    } catch (error) { byId<HTMLElement>('card-form-error').textContent = error instanceof Error ? error.message : 'デッキを作成できませんでした。'; }
  }

  private async openAddDialog(): Promise<void> {
    const state = await getAnkiState();
    const noteType = byId<HTMLSelectElement>('note-type');
    const deck = byId<HTMLSelectElement>('note-deck');
    noteType.replaceChildren(...state.noteTypes.map((item) => new Option(noteTypeDisplayName(item), item.id)));
    deck.replaceChildren(...state.decks.filter((item) => item.profileId === state.activeProfileId).map((item) => new Option(item.name, item.id, false, item.id === (this.selectedDeckId ?? DEFAULT_DECK_ID))));
    byId<HTMLInputElement>('note-tags').value = '';
    byId<HTMLElement>('card-form-error').textContent = '';
    await this.rebuildNoteFields();
    await refreshCardNumberOptions();
    this.cardDialog.showModal();
  }

  private async rebuildNoteFields(): Promise<void> {
    const state = await getAnkiState();
    const type = state.noteTypes.find((item) => item.id === byId<HTMLSelectElement>('note-type').value);
    const fields = byId<HTMLElement>('note-fields'); clear(fields); this.activeEditor = null;
    if (!type) return;
    if (type.kind === 'image-occlusion') {
      fields.append(el('p', { className: 'help', text: '画像穴埋めはブラウザ画面の専用エディタから作成できます。' }));
      const open = button('画像穴埋めエディタを開く', 'anki-button');
      open.dataset.action = 'image-occlusion-editor';
      open.addEventListener('click', () => { this.cardDialog.close(); void this.navigate('anki'); });
      fields.append(open); return;
    }
    for (const field of type.fields) {
      const label = el('label', { className: 'note-field-wrap', text: noteFieldDisplayName(field.name) });
      const textarea = el('textarea', { className: 'note-field', attrs: { rows: field.name.toLowerCase().includes('text') ? '6' : '3' } });
      textarea.dataset.field = field.name; textarea.dir = field.rtl ? 'rtl' : 'auto';
      if (type.kind === 'cloze' && field.name.toLowerCase() === 'text') textarea.placeholder = '例: 日本の首都は {{c1::東京}} です。';
      label.append(textarea); fields.append(label);
    }
    this.activeEditor = fields.querySelector('textarea');
  }

  private editorCommand(command: string): void {
    const textarea = this.activeEditor;
    if (!textarea) return;
    const start = textarea.selectionStart, end = textarea.selectionEnd, selected = textarea.value.slice(start, end);
    const wrappers: Record<string, [string, string]> = { bold: ['<b>', '</b>'], italic: ['<i>', '</i>'], underline: ['<u>', '</u>'], mathjax: ['\\(', '\\)'], cloze: ['{{c1::', '}}'] };
    const pair = wrappers[command]; if (!pair) return;
    textarea.setRangeText(`${pair[0]}${selected}${pair[1]}`, start, end, 'select'); textarea.focus();
  }

  private async handleAddNote(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    try {
      const state = await getAnkiState();
      const typeId = byId<HTMLSelectElement>('note-type').value;
      const type = state.noteTypes.find((item) => item.id === typeId);
      if (!type) throw new Error('ノートタイプが見つかりません。');
      if (type.kind === 'image-occlusion') throw new Error('画像穴埋めは専用エディタを使用してください。');
      const values: Record<string, string> = {};
      byId<HTMLElement>('note-fields').querySelectorAll<HTMLTextAreaElement | HTMLSelectElement>('textarea[data-field], select[data-field]').forEach((input) => { values[input.dataset.field ?? ''] = input.value; });
      const first = type.fields[0]?.name; if (first && !values[first]?.trim()) throw new Error('最初のフィールドを入力してください。');
      const tags = byId<HTMLInputElement>('note-tags').value.split(/[\s,]+/).map((value) => value.trim()).filter(Boolean);
      const cards = await createNote({ profileId: state.activeProfileId, deckId: byId<HTMLSelectElement>('note-deck').value || DEFAULT_DECK_ID, noteTypeId: typeId, fields: values, tags });
      if (!cards.length) throw new Error('カードが生成されませんでした。テンプレートまたはCloze番号を確認してください。');
      this.showStatus(`${cards.length}枚のカードを追加しました。`); await this.rebuildNoteFields(); await this.refresh(); void this.autoSync();
    } catch (error) { byId<HTMLElement>('card-form-error').textContent = error instanceof Error ? error.message : '追加に失敗しました。'; }
  }

  private async renderBrowser(): Promise<void> {
    this.title.textContent = 'ブラウザ';
    const heading = el('div', { className: 'page-heading' });
    heading.append(el('div', {}, [el('h2', { text: 'ブラウザ' }), el('p', { className: 'help', text: '検索、タグ、ノートタイプ、カード情報、一括編集、フィルターデッキ、オプションを管理します。' })]));
    this.view.append(heading); await this.anki.render(this.view);
  }

  private metric(value: string, label: string): HTMLElement {
    const node = el('div', { className: 'metric' }); node.append(el('strong', { text: value }), el('span', { text: label })); return node;
  }

  private async renderStats(): Promise<void> {
    this.title.textContent = '統計';
    const [cards, history] = await Promise.all([getCards(), getHistory()]);
    const ranges = [
      { key: 'week' as const, label: '過去1週間', days: 7 },
      { key: 'month' as const, label: '過去1か月', days: 30 },
      { key: 'year' as const, label: '過去1年', days: 365 },
      { key: 'all' as const, label: '全期間', days: null }
    ];
    const selected = ranges.find((item) => item.key === this.statsRange) ?? ranges[0]!;
    const cutoff = selected.days == null ? null : (() => { const date = new Date(); date.setHours(0, 0, 0, 0); date.setDate(date.getDate() - selected.days + 1); return date.getTime(); })();
    const periodHistory = cutoff == null ? history : history.filter((item) => new Date(item.reviewedAt).getTime() >= cutoff);
    const correct = periodHistory.filter((item) => item.isCorrect).length;
    const totalMs = periodHistory.reduce((sum, item) => sum + Math.max(0, item.responseMs), 0);
    const periodDays = selected.days ?? (() => { if (!history.length) return 1; const timestamps = history.map((item) => new Date(item.reviewedAt).getTime()).filter(Number.isFinite); if (!timestamps.length) return 1; const first = Math.min(...timestamps); return Math.max(1, Math.floor((Date.now() - first) / 86400000) + 1); })();

    const tabs = el('div', { className: 'stats-tabs', attrs: { role: 'tablist', 'aria-label': '統計期間' } });
    for (const range of ranges) {
      const tab = button(range.label, `stats-tab${range.key === this.statsRange ? ' is-active' : ''}`);
      tab.dataset.statRange = range.key;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(range.key === this.statsRange));
      tab.addEventListener('click', () => { this.statsRange = range.key; void this.render(); });
      tabs.append(tab);
    }
    this.view.append(tabs);

    const top = el('section', { className: 'settings-card stats-period-summary' });
    top.append(el('h2', { text: `期間サマリー — ${selected.label}` }));
    const metrics = el('div', { className: 'metric-grid' });
    metrics.append(
      this.metric(String(periodHistory.length), '復習数'),
      this.metric(`${periodHistory.length ? Math.round(correct / periodHistory.length * 100) : 0}%`, '正答率'),
      this.metric(formatDuration(totalMs), '学習時間'),
      this.metric((periodHistory.length / Math.max(1, periodDays)).toFixed(1), '1日平均')
    );
    top.append(metrics); this.view.append(top);

    const states = cardStateCounts(cards), ratings = ratingCounts(periodHistory), retention = trueRetention(periodHistory);
    const overview = el('section', { className: 'settings-card' }); overview.append(el('h2', { text: '現在のカード状態 / 選択期間の保持率' }));
    const stateMetrics = el('div', { className: 'metric-grid' });
    stateMetrics.append(
      this.metric(String(states.new), '新規'),
      this.metric(String(states.learning + states.relearning), '学習中'),
      this.metric(String(states.review), '復習'),
      this.metric(String(states.suspended), '保留'),
      this.metric(`${Math.round(retention.rate * 100)}%`, '真の保持率'),
      this.metric(String(streak(history)), '連続学習日数'),
      this.metric(String(ratings.again), 'もう一度'),
      this.metric(String(ratings.easy), '簡単')
    );
    overview.append(stateMetrics); this.view.append(overview);

    const chart = el('section', { className: 'settings-card' });
    const bars = el('div', { className: 'bar-list' });
    let buckets: Array<{ day: string; count: number }> = [];
    let chartTitle = '';
    if (this.statsRange === 'week' || this.statsRange === 'month') {
      const days = this.statsRange === 'week' ? 7 : 30;
      buckets = dailyCounts(history, days);
      chartTitle = this.statsRange === 'week' ? '日別推移 — 過去1週間' : '日別推移 — 過去1か月';
    } else if (this.statsRange === 'year') {
      chartTitle = '月別推移 — 過去1年';
      const now = new Date();
      for (let offset = 11; offset >= 0; offset -= 1) {
        const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        buckets.push({ day: `${date.getMonth() + 1}月`, count: periodHistory.filter((item) => item.reviewedAt.startsWith(key)).length });
      }
    } else {
      chartTitle = '年別推移 — 全期間';
      const years = new Map<string, number>();
      for (const item of periodHistory) { const year = item.reviewedAt.slice(0, 4); years.set(year, (years.get(year) ?? 0) + 1); }
      buckets = [...years].sort(([a], [b]) => a.localeCompare(b)).map(([day, count]) => ({ day, count }));
      if (!buckets.length) buckets = [{ day: new Date().getFullYear().toString(), count: 0 }];
    }
    chart.append(el('h2', { text: chartTitle }));
    const max = Math.max(1, ...buckets.map((item) => item.count));
    for (const item of buckets) { const row = el('div', { className: 'bar-row' }), track = el('div', { className: 'bar-track' }), fill = el('div', { className: 'bar-fill' }); fill.style.width = `${item.count / max * 100}%`; track.append(fill); row.append(el('span', { text: item.day }), track, el('strong', { text: String(item.count) })); bars.append(row); }
    chart.append(bars); this.view.append(chart);

    const tagMap = new Map<string, { correct: number; total: number }>();
    for (const item of periodHistory) for (const tagName of item.tags) { const value = tagMap.get(tagName) ?? { correct: 0, total: 0 }; value.total += 1; if (item.isCorrect) value.correct += 1; tagMap.set(tagName, value); }
    const tagStats = [...tagMap].filter(([, value]) => value.total > 0).map(([tagName, value]) => ({ tag: tagName, accuracy: value.correct / value.total, total: value.total })).sort((a, b) => a.accuracy - b.accuracy).slice(0, 12);

    const extra = el('section', { className: 'settings-card' }); extra.append(el('h2', { text: '予測 / 間隔' }));
    const prediction = forecast(cards, 30).reduce((sum, item) => sum + item.count, 0); extra.append(el('p', { text: `今後30日の予定復習: ${prediction}枚` }));
    for (const bin of intervalHistogram(cards)) extra.append(el('p', { className: 'help', text: `${bin.label}: ${bin.count}枚` }));
    if (tagStats.length) extra.append(el('h2', { text: `タグ別正答率 — ${selected.label}` }));
    for (const item of tagStats) extra.append(el('p', { className: 'help', text: `${item.tag}: ${Math.round(item.accuracy * 100)}% (${item.total})` }));
    this.view.append(extra);
  }

  private async renderSettings(): Promise<void> {
    this.title.textContent = '設定'; const settings = await getSettings(); const grid = el('div', { className: 'settings-grid' });
    const sync = el('section', { className: 'settings-card' }); sync.append(el('h2', { text: '同期' }));
    const urlLabel = el('label', { text: 'Google Apps Script Web App URL' }), url = el('input', { attrs: { type: 'url' } }); url.value = settings.gasUrl; urlLabel.append(url);
    const secretLabel = el('label', { text: '同期シークレット' }), secret = el('input', { attrs: { type: 'password', placeholder: settings.syncSecret ? '保存済み（変更時のみ入力）' : '16文字以上' } }); secretLabel.append(secret);
    const save = button('保存', 'anki-primary'); save.addEventListener('click', () => void this.saveSyncSettings(url.value, secret.value)); sync.append(urlLabel, secretLabel, save); grid.append(sync);
    const review = el('section', { className: 'settings-card' }); review.append(el('h2', { text: '復習' }));
    const toggles: Array<[keyof typeof settings, string, boolean]> = [['showRemainingCount', '残りカード数を表示', settings.showRemainingCount !== false], ['showNextReviewTime', '回答ボタンに次回間隔を表示', settings.showNextReviewTime !== false], ['spacebarAnswers', 'Spaceキーで答えを表示', settings.spacebarAnswers !== false], ['interruptAudioOnAnswer', '回答時に音声を停止', settings.interruptAudioOnAnswer !== false], ['autoSync', '自動同期', settings.autoSync !== false]];
    for (const [key, labelText, checked] of toggles) { const label = el('label', { className: 'check-row', text: labelText }), input = el('input', { attrs: { type: 'checkbox' } }); input.checked = checked; input.addEventListener('change', () => void (async () => { const current = await getSettings(); await saveSettings({ ...current, [key]: input.checked }); })()); label.prepend(input); review.append(label); }
    grid.append(review);
    const data = el('section', { className: 'settings-card' }); data.append(el('h2', { text: '読み込み / 書き出し' })); const row = el('div', { className: 'button-row' });
    const imp = button('Ankiデッキを読み込む', 'anki-button'), anki = button('Anki形式で書き出す', 'anki-button'), json = button('完全JSON', 'anki-button'), csv = button('CSV', 'anki-button'); imp.addEventListener('click', () => this.importFile.click()); anki.addEventListener('click', () => void exportAnkiPackage().then(() => this.showStatus('コレクションをAnki形式で書き出しました。')).catch((error) => this.showStatus(error instanceof Error ? error.message : '書き出しに失敗しました。', true))); json.addEventListener('click', () => void exportJson()); csv.addEventListener('click', () => void exportCsv()); row.append(imp, anki, json, csv); data.append(row); grid.append(data); this.view.append(grid);
  }

  private async saveSyncSettings(url: string, secret: string): Promise<void> {
    const settings = await getSettings(); const trimmed = url.trim();
    if (trimmed && !isAllowedGasUrl(trimmed)) { this.showStatus('Apps ScriptのHTTPS Web App URLを入力してください。', true); return; }
    if (secret && secret.length < 16) { this.showStatus('同期シークレットは16文字以上にしてください。', true); return; }
    await saveSettings({ ...settings, gasUrl: trimmed, syncSecret: secret || settings.syncSecret }); this.showStatus('同期設定を保存しました。');
  }

  private async openStudyDialog(mode?: ReviewMode, deckId?: string): Promise<void> {
    const [cards, state] = await Promise.all([getCards(), getAnkiState()]);
    const tags = [...new Set(cards.flatMap((card) => card.tags))].sort((a, b) => a.localeCompare(b, 'ja'));
    const tag = byId<HTMLSelectElement>('study-tag'); tag.replaceChildren(new Option('すべて', '')); for (const value of tags) tag.append(new Option(value, value));
    const deck = byId<HTMLSelectElement>('study-deck'); deck.replaceChildren(); for (const item of state.decks.filter((entry) => entry.profileId === state.activeProfileId)) deck.append(new Option(item.name, item.id, false, item.id === (deckId ?? DEFAULT_DECK_ID)));
    if (mode) byId<HTMLSelectElement>('study-mode').value = mode; this.studyDialog.showModal();
  }

  private async handleStudySubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const mode = byId<HTMLSelectElement>('study-mode').value as ReviewMode, style = byId<HTMLSelectElement>('study-style').value as ReviewStyle, tag = byId<HTMLSelectElement>('study-tag').value, deckId = byId<HTMLSelectElement>('study-deck').value || DEFAULT_DECK_ID, examSize = Number(byId<HTMLSelectElement>('study-size').value) || 20;
    const [cards, history, state] = await Promise.all([getCards(), getHistory(), getAnkiState()]); const deck = state.decks.find((item) => item.id === deckId); const preset = state.presets.find((item) => item.id === deck?.presetId) ?? state.presets[0];
    const selected = selectCards(cards, history, { mode, tag, examSize, newLimit: preset?.dailyNewLimit ?? 20, reviewLimit: preset?.dailyReviewLimit ?? 200, state, deckId });
    if (!selected.length) { this.studyDialog.close(); this.showStatus('この条件で学習するカードがありません。'); return; }
    this.studyDialog.close(); await this.startCards(selected, mode, deckId, undefined, style, tag, examSize);
  }

  private async startCards(cards: StudyCard[], mode: ReviewMode, deckId?: string, filteredDeckId?: string, style: ReviewStyle = 'self', tag = '', examSize = 20): Promise<void> {
    const session: ReviewSession = { id: 'current', mode, style, queue: cards.map((card) => card.id), cursor: 0, answered: 0, tag, examSize, startedAt: nowIso(), deckId, filteredDeckId };
    await this.review.start(session);
  }

  private async handleFileImport(): Promise<void> {
    const file = this.importFile.files?.[0]; if (!file) return;
    try {
      const name = file.name.toLowerCase();
      if (name.endsWith('.json')) {
        const text = await file.text();
        if (text.includes('"work-1-anki-collection"')) { if (!confirm('現在のコレクションを置き換えますか？')) return; const result = await importCollectionPackage(text); this.showStatus(`${result.cards}枚・${result.notes}ノートを読み込みました。`); }
        else { if (!confirm('バックアップで現在のデータを置き換えますか？')) return; const result = await importJson(file); this.showStatus(`${result.cards}枚・履歴${result.history}件を復元しました。`); }
      } else if (name.endsWith('.csv') || name.endsWith('.tsv') || name.endsWith('.txt')) {
        const count = await importTextCards(await file.text(), this.selectedDeckId ?? DEFAULT_DECK_ID); this.showStatus(`${count}ノートを読み込みました。`);
      } else if (name.endsWith('.apkg') || name.endsWith('.colpkg')) { const result = await importAnkiPackage(file); this.showStatus(`Ankiデッキを読み込みました：デッキ${result.decks}・ノート${result.notes}・カード${result.cards}・履歴${result.history}・メディア${result.media}`); }
      else this.showStatus('対応していないファイル形式です。', true);
      await this.refresh();
    } catch (error) { this.showStatus(error instanceof Error ? error.message : '読み込みに失敗しました。', true); }
    finally { this.importFile.value = ''; }
  }

  private async performSync(): Promise<void> {
    this.syncButton.disabled = true;
    try { const result = await syncNow((message) => this.showStatus(message, false, 0)); this.showStatus(`同期完了：送信${result.pushed}・カード受信${result.pulledCards}・履歴受信${result.pulledHistory}・未同期${result.pending}`); await this.refresh(); }
    catch (error) { this.showStatus(error instanceof Error ? error.message : '同期に失敗しました。端末データは保持されています。', true, 7000); }
    finally { this.syncButton.disabled = false; }
  }

  private async autoSync(): Promise<void> { const settings = await getSettings(); if (navigator.onLine && settings.gasUrl && settings.syncSecret && settings.autoSync !== false) await this.performSync(); }
  private async updateSyncBadge(): Promise<void> { const count = (await getQueue()).length; this.syncBadge.textContent = String(count); this.syncBadge.hidden = count === 0; }
  private async updateProfileLabel(): Promise<void> { const state = await getAnkiState(); this.profileLabel.textContent = state.profiles.find((profile) => profile.id === state.activeProfileId)?.name ?? ''; }
  private showStatus(message: string, error = false, duration = 4500): void { clearTimeout(this.statusTimer); this.status.textContent = message; this.status.classList.toggle('is-error', error); this.status.hidden = false; if (duration > 0) this.statusTimer = window.setTimeout(() => { this.status.hidden = true; }, duration); }
  private async refresh(): Promise<void> { await this.render(); await this.updateSyncBadge(); }
}
