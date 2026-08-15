import type { AppSettings, ReviewMode, ReviewSession, ReviewStyle, StudyCard } from '../types.js';
import { createCard, persistCard, validateCardDraft, type CardDraft } from '../cards/cards.js';
import { selectCards } from '../review/select.js';
import { ReviewController } from '../review/controller.js';
import { exportCsv, exportJson, importJson } from '../storage/backup.js';
import { clearCurrentSession, getCards, getCurrentSession, getHistory, getQueue, getSettings, saveCard, saveQueueItem, saveSettings } from '../storage/db.js';
import { summarize, dailyCounts, tagAccuracy } from '../statistics/stats.js';
import { isAllowedGasUrl, syncNow } from '../sync/client.js';
import { button, clear, el } from '../ui/dom.js';
import { formatDuration, normalizeTags, nowIso, uid } from '../utils/core.js';
import { isDue } from '../scheduler/scheduler.js';

function byId<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node as T;
}

type Route = 'home' | 'cards' | 'stats' | 'settings';

export class App {
  private route: Route = 'home';
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
  private readonly review: ReviewController;
  private statusTimer = 0;

  constructor() {
    this.review = new ReviewController(async () => {
      await this.refresh();
      void this.autoSync();
    });
    this.bindGlobalEvents();
  }

  async init(): Promise<void> {
    await this.updateSyncBadge();
    await this.render();
    const session = await getCurrentSession();
    if (session && session.cursor < session.queue.length) this.renderResumeBanner(session);
    if (navigator.onLine) void this.autoSync();
  }

  private bindGlobalEvents(): void {
    document.querySelectorAll<HTMLButtonElement>('[data-route]').forEach((item) => {
      item.addEventListener('click', () => {
        const route = item.dataset.route as Route | undefined;
        if (route) void this.navigate(route);
      });
    });
    this.addButton.addEventListener('click', () => void this.openCardDialog());
    this.syncButton.addEventListener('click', () => void this.performSync());
    this.cardForm.addEventListener('submit', (event) => void this.handleCardSubmit(event));
    this.studyForm.addEventListener('submit', (event) => void this.handleStudySubmit(event));
    window.addEventListener('online', () => {
      this.showStatus('オンラインに戻りました。未同期データを送信します。');
      void this.autoSync();
    });
    window.addEventListener('offline', () => this.showStatus('オフラインです。学習記録はiPad内に保存されます。'));
  }

  private async navigate(route: Route): Promise<void> {
    this.route = route;
    document.querySelectorAll<HTMLButtonElement>('[data-route]').forEach((item) => item.classList.toggle('is-active', item.dataset.route === route));
    await this.render();
    this.view.focus({ preventScroll: true });
  }

  private async render(): Promise<void> {
    clear(this.view);
    if (this.route === 'home') await this.renderHome();
    else if (this.route === 'cards') await this.renderCards();
    else if (this.route === 'stats') await this.renderStats();
    else await this.renderSettings();
    await this.updateSyncBadge();
  }

  private async renderHome(): Promise<void> {
    this.title.textContent = '暗記カード';
    const [cards, history, settings] = await Promise.all([getCards(), getHistory(), getSettings()]);
    const now = new Date();
    const due = cards.filter((card) => card.schedule.reps > 0 && isDue(card.schedule, now)).length;
    const fresh = cards.filter((card) => card.schedule.reps === 0).length;
    const today = summarize(history, 1, now);

    const hero = el('section', { className: 'hero' });
    const lead = el('div', { className: 'hero-card' });
    lead.append(
      el('p', { className: 'eyebrow', text: 'TODAY' }),
      el('h2', { className: 'hero-title', text: due ? `復習が ${due} 枚あります` : '今日の復習は完了です' }),
      el('p', { className: 'muted', text: due ? '忘れそうなカードから始めます。' : '新規カードや苦手カードも学習できます。' })
    );
    const actions = el('div', { className: 'hero-actions' });
    const start = button(due ? '今日の復習を始める' : '学習モードを選ぶ', 'primary-button');
    start.addEventListener('click', () => void this.openStudyDialog(due ? 'due' : undefined));
    actions.append(start);
    if (await getCurrentSession()) {
      const resume = button('続きから再開');
      resume.addEventListener('click', () => void this.resumeSession());
      actions.append(resume);
    }
    lead.append(actions);
    hero.append(lead);

    const metrics = el('div', { className: 'metric-grid' });
    metrics.append(
      this.metric(String(due), '今日の復習'),
      this.metric(String(fresh), '新しいカード'),
      this.metric(String(today.studied), '今日の学習'),
      this.metric(`${Math.round(today.accuracy * 100)}%`, '今日の正答率')
    );
    hero.append(metrics);

    const section = el('section', { className: 'section' });
    section.append(el('div', { className: 'section-head' }));
    section.firstElementChild?.append(el('h2', { text: '学習モード' }));
    const modes = el('div', { className: 'mode-grid' });
    const modeData: Array<[ReviewMode, string, string]> = [
      ['due', '今日の復習', '復習日が来たカード'],
      ['new', '新規カード', `上限 ${settings.dailyNewLimit} 枚`],
      ['weak', '苦手カード', '正答率70%未満'],
      ['wrong', '最近の間違い', '最後に不正解だったカード'],
      ['favorite', 'お気に入り', '★を付けたカード'],
      ['random', 'ランダム', '全カードをシャッフル']
    ];
    for (const [mode, name, detail] of modeData) {
      const item = el('button', { className: 'mode-card', attrs: { type: 'button' } });
      item.append(el('strong', { text: name }), el('span', { text: detail }));
      item.addEventListener('click', () => void this.openStudyDialog(mode));
      modes.append(item);
    }
    section.append(modes);
    hero.append(section);
    this.view.append(hero);
  }

  private metric(value: string, label: string): HTMLElement {
    const node = el('div', { className: 'metric' });
    node.append(el('strong', { text: value }), el('span', { text: label }));
    return node;
  }

  private async renderCards(): Promise<void> {
    this.title.textContent = 'カード';
    const cards = (await getCards()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const wrapper = el('section');
    const searchRow = el('div', { className: 'search-row' });
    const search = el('input', { attrs: { type: 'search', placeholder: '番号・問題・答え・解説・タグを検索', 'aria-label': 'カードを検索' } });
    const tagButton = button('タグ学習');
    tagButton.addEventListener('click', () => void this.openStudyDialog('tag'));
    searchRow.append(search, tagButton);
    const list = el('div', { className: 'card-list' });
    wrapper.append(searchRow, list);
    this.view.append(wrapper);

    const draw = (query = '') => {
      clear(list);
      const normalized = query.trim().toLowerCase();
      const filtered = cards.filter((card) => !normalized || [card.cardNumber ?? '', card.question, card.answer, card.explanation, ...card.tags].join('\n').toLowerCase().includes(normalized));
      if (!filtered.length) {
        list.append(el('p', { className: 'empty', text: cards.length ? '該当するカードがありません。' : 'まだカードがありません。「＋」から追加できます。' }));
        return;
      }
      for (const card of filtered) list.append(this.cardRow(card));
    };
    draw();
    search.addEventListener('input', () => draw(search.value));
  }

  private cardRow(card: StudyCard): HTMLElement {
    const row = el('article', { className: 'card-row' });
    const content = el('div');
    if (card.cardNumber) content.append(el('p', { className: 'card-number', text: `No. ${card.cardNumber}` }));
    const title = el('h3', { text: card.question });
    const answer = el('p', { text: `答え：${card.answer}` });
    content.append(title, answer);
    for (const tag of card.tags) content.append(el('span', { className: 'tag-chip', text: tag }));
    if (card.favorite) content.append(el('span', { className: 'tag-chip', text: '★ お気に入り' }));

    const actions = el('div', { className: 'row-actions' });
    const edit = button('編集', 'small-button');
    edit.addEventListener('click', () => void this.openCardDialog(card));
    const duplicate = button('複製', 'small-button');
    duplicate.addEventListener('click', () => void this.duplicateCard(card));
    const remove = button('削除', 'small-button');
    remove.addEventListener('click', () => void this.deleteCard(card));
    actions.append(edit, duplicate, remove);
    row.append(content, actions);
    return row;
  }

  private async renderStats(): Promise<void> {
    this.title.textContent = '学習記録';
    const [cards, history] = await Promise.all([getCards(), getHistory()]);
    const today = summarize(history, 1);
    const week = summarize(history, 7);
    const month = summarize(history, 30);
    const metrics = el('div', { className: 'metric-grid' });
    metrics.append(
      this.metric(String(today.studied), '今日の学習'),
      this.metric(`${Math.round(today.accuracy * 100)}%`, '今日の正答率'),
      this.metric(String(week.studied), '7日間'),
      this.metric(formatDuration(month.totalMs), '30日学習時間')
    );
    this.view.append(metrics);

    const dailySection = el('section', { className: 'section' });
    dailySection.append(el('h2', { text: '直近7日' }));
    const dailyList = el('div', { className: 'bar-list' });
    const days = dailyCounts(history, 7);
    const max = Math.max(1, ...days.map((day) => day.count));
    for (const day of days) dailyList.append(this.barRow(day.day, day.count / max, `${day.count}枚`));
    dailySection.append(dailyList);
    this.view.append(dailySection);

    const tagSection = el('section', { className: 'section' });
    tagSection.append(el('h2', { text: 'タグ別正答率' }));
    const tagList = el('div', { className: 'bar-list' });
    const tags = tagAccuracy(cards);
    if (!tags.length) tagList.append(el('p', { className: 'empty', text: '学習記録がたまるとタグ別の傾向を表示します。' }));
    for (const item of tags.slice(0, 15)) tagList.append(this.barRow(item.tag, item.accuracy, `${Math.round(item.accuracy * 100)}%`));
    tagSection.append(tagList);
    this.view.append(tagSection);

    const weak = [...cards]
      .filter((card) => card.stats.correct + card.stats.incorrect >= 2)
      .sort((a, b) => {
        const aa = a.stats.correct / (a.stats.correct + a.stats.incorrect);
        const bb = b.stats.correct / (b.stats.correct + b.stats.incorrect);
        return aa - bb;
      })
      .slice(0, 10);
    const weakSection = el('section', { className: 'section' });
    weakSection.append(el('h2', { text: '苦手ランキング' }));
    const weakList = el('div', { className: 'card-list' });
    for (const card of weak) {
      const total = card.stats.correct + card.stats.incorrect;
      const row = el('div', { className: 'card-row' });
      row.append(el('div', { text: card.question }), el('strong', { text: `${Math.round(card.stats.correct / total * 100)}%` }));
      weakList.append(row);
    }
    if (!weak.length) weakList.append(el('p', { className: 'empty', text: 'まだ十分な学習記録がありません。' }));
    weakSection.append(weakList);
    this.view.append(weakSection);
  }

  private barRow(label: string, ratio: number, value: string): HTMLElement {
    const row = el('div', { className: 'bar-row' });
    const track = el('div', { className: 'bar-track' });
    const fill = el('div', { className: 'bar-fill' });
    fill.style.width = `${Math.max(0, Math.min(100, ratio * 100))}%`;
    track.append(fill);
    row.append(el('span', { text: label }), track, el('strong', { text: value }));
    return row;
  }

  private async renderSettings(): Promise<void> {
    this.title.textContent = '設定';
    const settings = await getSettings();
    const grid = el('div', { className: 'settings-grid' });

    const syncCard = el('section', { className: 'settings-card' });
    syncCard.append(el('h2', { text: 'Google Sheets 同期' }));
    const urlLabel = el('label', { text: 'Apps Script Web App URL' });
    const urlInput = el('input', { attrs: { type: 'url', id: 'settings-gas-url', placeholder: 'https://script.google.com/macros/s/.../exec', autocomplete: 'off' } });
    urlInput.value = settings.gasUrl;
    urlLabel.append(urlInput);
    const secretLabel = el('label', { text: '同期シークレット' });
    const secretInput = el('input', { attrs: { type: 'password', id: 'settings-secret', placeholder: settings.syncSecret ? '保存済み（変更時のみ入力）' : '16文字以上', autocomplete: 'new-password' } });
    secretLabel.append(secretInput);
    const syncHelp = el('p', { className: 'help', text: 'シークレットはGitHubには保存されず、この端末のIndexedDBだけに保存されます。Apps Script側ではScript Propertiesに同じ値を設定してください。' });
    const saveSync = button('同期設定を保存', 'primary-button');
    saveSync.addEventListener('click', () => void this.saveSyncSettings(urlInput.value, secretInput.value));
    syncCard.append(urlLabel, secretLabel, syncHelp, saveSync);

    const studyCard = el('section', { className: 'settings-card' });
    studyCard.append(el('h2', { text: '学習設定' }));
    const newInput = this.numberSetting('1日の新規カード上限', settings.dailyNewLimit, 1, 500);
    const reviewInput = this.numberSetting('1日の復習上限', settings.dailyReviewLimit, 1, 2000);
    const idleInput = this.numberSetting('回答時間の放置判定（秒）', settings.idleTimeoutSeconds, 60, 3600);
    const saveStudy = button('学習設定を保存', 'primary-button');
    saveStudy.addEventListener('click', () => void this.saveStudySettings(newInput.input.valueAsNumber, reviewInput.input.valueAsNumber, idleInput.input.valueAsNumber));
    studyCard.append(newInput.label, reviewInput.label, idleInput.label, saveStudy);

    const backupCard = el('section', { className: 'settings-card' });
    backupCard.append(el('h2', { text: 'バックアップ' }), el('p', { className: 'help', text: 'JSONにはカードと学習履歴を含みます。同期シークレットは含めません。' }));
    const backupActions = el('div', { className: 'button-row' });
    const jsonButton = button('JSONを書き出す');
    jsonButton.addEventListener('click', () => void exportJson());
    const csvButton = button('CSVを書き出す');
    csvButton.addEventListener('click', () => void exportCsv());
    const importButton = button('JSONを読み込む');
    const fileInput = el('input', { attrs: { type: 'file', accept: 'application/json,.json' } });
    fileInput.hidden = true;
    importButton.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => void this.handleImport(fileInput));
    backupActions.append(jsonButton, csvButton, importButton, fileInput);
    backupCard.append(backupActions);

    const localCard = el('section', { className: 'settings-card' });
    localCard.append(el('h2', { text: '端末データ' }));
    const queueCount = (await getQueue()).length;
    localCard.append(el('p', { className: 'help', text: `未同期データ：${queueCount}件。同期に失敗してもローカルデータは削除しません。` }));
    const clearSession = button('保存中の学習セッションを破棄', 'danger-button');
    clearSession.addEventListener('click', () => void this.discardSession());
    localCard.append(clearSession);

    grid.append(syncCard, studyCard, backupCard, localCard);
    this.view.append(grid);
  }

  private numberSetting(text: string, value: number, min: number, max: number): { label: HTMLLabelElement; input: HTMLInputElement } {
    const label = el('label', { text });
    const input = el('input', { attrs: { type: 'number', min: String(min), max: String(max), step: '1' } });
    input.value = String(value);
    label.append(input);
    return { label, input };
  }

  private async saveSyncSettings(urlRaw: string, secretRaw: string): Promise<void> {
    const settings = await getSettings();
    const url = urlRaw.trim();
    if (url && !isAllowedGasUrl(url)) {
      this.showStatus('Apps Scriptの /exec URLを入力してください。', true);
      return;
    }
    const secret = secretRaw || settings.syncSecret;
    if (secret && secret.length < 16) {
      this.showStatus('同期シークレットは16文字以上にしてください。', true);
      return;
    }
    await saveSettings({ ...settings, gasUrl: url, syncSecret: secret });
    this.showStatus('同期設定を端末内に保存しました。');
  }

  private async saveStudySettings(newLimit: number, reviewLimit: number, idle: number): Promise<void> {
    const settings = await getSettings();
    const safe = (value: number, min: number, max: number) => Math.max(min, Math.min(max, Number.isFinite(value) ? Math.round(value) : min));
    await saveSettings({ ...settings, dailyNewLimit: safe(newLimit, 1, 500), dailyReviewLimit: safe(reviewLimit, 1, 2000), idleTimeoutSeconds: safe(idle, 60, 3600) });
    this.showStatus('学習設定を保存しました。');
  }

  private async handleImport(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    if (!file) return;
    if (!window.confirm('現在のカードと履歴をバックアップ内容で置き換えます。続けますか？')) return;
    try {
      const result = await importJson(file);
      this.showStatus(`${result.cards}枚のカードと${result.history}件の履歴を読み込みました。`);
      await this.refresh();
    } catch (error) {
      this.showStatus(error instanceof Error ? error.message : 'インポートに失敗しました。', true);
    } finally {
      input.value = '';
    }
  }

  private async openCardDialog(card?: StudyCard): Promise<void> {
    byId<HTMLInputElement>('card-id').value = card?.id ?? '';
    byId<HTMLInputElement>('card-number').value = card?.cardNumber ?? '';
    byId<HTMLTextAreaElement>('card-question').value = card?.question ?? '';
    byId<HTMLTextAreaElement>('card-answer').value = card?.answer ?? '';
    byId<HTMLInputElement>('card-wrong-1').value = card?.distractors[0] ?? '';
    byId<HTMLInputElement>('card-wrong-2').value = card?.distractors[1] ?? '';
    byId<HTMLInputElement>('card-wrong-3').value = card?.distractors[2] ?? '';
    byId<HTMLTextAreaElement>('card-explanation').value = card?.explanation ?? '';
    byId<HTMLInputElement>('card-tags').value = card?.tags.join(', ') ?? '';
    byId<HTMLInputElement>('card-favorite').checked = card?.favorite ?? false;
    byId<HTMLElement>('card-dialog-title').textContent = card ? 'カードを編集' : 'カードを追加';
    byId<HTMLElement>('card-form-error').textContent = '';
    this.cardDialog.showModal();
  }

  private cardDraftFromForm(): CardDraft {
    return {
      cardNumber: byId<HTMLInputElement>('card-number').value,
      question: byId<HTMLTextAreaElement>('card-question').value,
      answer: byId<HTMLTextAreaElement>('card-answer').value,
      distractors: [byId<HTMLInputElement>('card-wrong-1').value, byId<HTMLInputElement>('card-wrong-2').value, byId<HTMLInputElement>('card-wrong-3').value],
      explanation: byId<HTMLTextAreaElement>('card-explanation').value,
      tagsText: byId<HTMLInputElement>('card-tags').value,
      favorite: byId<HTMLInputElement>('card-favorite').checked
    };
  }

  private async handleCardSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const submitter = event.submitter as HTMLButtonElement | null;
    if (submitter?.value === 'cancel') {
      this.cardDialog.close();
      return;
    }
    const draft = this.cardDraftFromForm();
    const errors = validateCardDraft(draft);
    if (errors.length) {
      byId<HTMLElement>('card-form-error').textContent = errors.join(' ');
      return;
    }
    const id = byId<HTMLInputElement>('card-id').value;
    if (!id) {
      await persistCard(createCard(draft));
    } else {
      const original = (await getCards(true)).find((card) => card.id === id);
      if (!original) {
        byId<HTMLElement>('card-form-error').textContent = '編集対象のカードが見つかりません。';
        return;
      }
      const requestId = uid('req');
      const updated: StudyCard = {
        ...original,
        cardNumber: draft.cardNumber?.trim() ?? '',
        question: draft.question.trim(),
        answer: draft.answer.trim(),
        distractors: draft.distractors.map((value) => value.trim()).filter(Boolean).slice(0, 3),
        explanation: draft.explanation.trim(),
        tags: normalizeTags(draft.tagsText),
        favorite: draft.favorite,
        updatedAt: nowIso(),
        version: original.version + 1,
        lastRequestId: requestId
      };
      await saveCard(updated);
      await saveQueueItem({ requestId, action: 'upsertCard', payload: { card: updated }, createdAt: nowIso(), attempts: 0 });
    }
    this.cardDialog.close();
    this.showStatus('カードを保存しました。');
    await this.refresh();
    void this.autoSync();
  }

  private async duplicateCard(card: StudyCard): Promise<void> {
    const duplicate = createCard({ question: `${card.question}（コピー）`, answer: card.answer, distractors: card.distractors, explanation: card.explanation, tagsText: card.tags.join(','), favorite: card.favorite });
    await persistCard(duplicate);
    this.showStatus('カードを複製しました。');
    await this.refresh();
  }

  private async deleteCard(card: StudyCard): Promise<void> {
    if (!window.confirm(`「${card.question.slice(0, 80)}」を削除しますか？\n同期後も削除情報を保持して他端末へ反映します。`)) return;
    const requestId = uid('req');
    const timestamp = nowIso();
    const deleted: StudyCard = { ...card, deletedAt: timestamp, updatedAt: timestamp, version: card.version + 1, lastRequestId: requestId };
    await saveCard(deleted);
    await saveQueueItem({ requestId, action: 'deleteCard', payload: { card: deleted }, createdAt: timestamp, attempts: 0 });
    this.showStatus('カードを削除しました。');
    await this.refresh();
    void this.autoSync();
  }

  private async openStudyDialog(mode?: ReviewMode): Promise<void> {
    const cards = await getCards();
    const tags = [...new Set(cards.flatMap((card) => card.tags))].sort((a, b) => a.localeCompare(b, 'ja'));
    const tagSelect = byId<HTMLSelectElement>('study-tag');
    tagSelect.replaceChildren(new Option('すべて', ''));
    for (const tag of tags) tagSelect.append(new Option(tag, tag));
    if (mode) byId<HTMLSelectElement>('study-mode').value = mode;
    this.studyDialog.showModal();
  }

  private async handleStudySubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const submitter = event.submitter as HTMLButtonElement | null;
    if (submitter?.value === 'cancel') {
      this.studyDialog.close();
      return;
    }
    const mode = byId<HTMLSelectElement>('study-mode').value as ReviewMode;
    const style = byId<HTMLSelectElement>('study-style').value as ReviewStyle;
    const tag = byId<HTMLSelectElement>('study-tag').value;
    const examSize = Number(byId<HTMLSelectElement>('study-size').value) || 20;
    const [cards, history, settings] = await Promise.all([getCards(), getHistory(), getSettings()]);
    const selected = selectCards(cards, history, { mode, tag, examSize, newLimit: settings.dailyNewLimit, reviewLimit: settings.dailyReviewLimit });
    if (!selected.length) {
      this.studyDialog.close();
      this.showStatus('この条件で学習するカードがありません。', true);
      return;
    }
    const session: ReviewSession = { id: 'current', mode, style, queue: selected.map((card) => card.id), cursor: 0, answered: 0, tag, examSize, startedAt: nowIso() };
    this.studyDialog.close();
    await this.review.start(session);
  }

  private async resumeSession(): Promise<void> {
    const session = await getCurrentSession();
    if (!session) {
      this.showStatus('再開できるセッションがありません。', true);
      return;
    }
    await this.review.resume(session);
  }

  private renderResumeBanner(session: ReviewSession): void {
    this.showStatus(`途中の学習があります（${session.cursor}/${session.queue.length}）。ホームの「続きから再開」から再開できます。`);
  }

  private async discardSession(): Promise<void> {
    if (!window.confirm('保存中の学習セッションだけを破棄しますか？カードや履歴は削除されません。')) return;
    await clearCurrentSession();
    this.showStatus('学習セッションを破棄しました。');
  }

  private async performSync(): Promise<void> {
    this.syncButton.disabled = true;
    try {
      const report = await syncNow((message) => this.showStatus(message, false, 0));
      this.showStatus(`同期完了：送信${report.pushed}件・カード受信${report.pulledCards}件・履歴受信${report.pulledHistory}件・未同期${report.pending}件${report.conflicts ? `・競合${report.conflicts}件` : ''}`);
      await this.refresh();
    } catch (error) {
      this.showStatus(error instanceof Error ? error.message : '同期に失敗しました。データは端末内に保持されています。', true, 7000);
      await this.updateSyncBadge();
    } finally {
      this.syncButton.disabled = false;
    }
  }

  private async autoSync(): Promise<void> {
    const settings = await getSettings();
    if (!navigator.onLine || !settings.gasUrl || !settings.syncSecret) return;
    await this.performSync();
  }

  private async updateSyncBadge(): Promise<void> {
    const count = (await getQueue()).length;
    this.syncBadge.textContent = String(count);
    this.syncBadge.hidden = count === 0;
  }

  private showStatus(message: string, error = false, duration = 4500): void {
    window.clearTimeout(this.statusTimer);
    this.status.textContent = message;
    this.status.classList.toggle('is-error', error);
    this.status.hidden = false;
    if (duration > 0) this.statusTimer = window.setTimeout(() => { this.status.hidden = true; }, duration);
  }

  private async refresh(): Promise<void> {
    await this.render();
    await this.updateSyncBadge();
  }
}
