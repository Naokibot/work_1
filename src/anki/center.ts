import type {
  AnkiState,
  CardFlag,
  DeckOptionsPreset,
  ImageOcclusionMask,
  NoteTypeDefinition,
  ReviewMode,
  StudyCard,
  StudyNote
} from '../types.js';
import { button, clear, el } from '../ui/dom.js';
import {
  getAnkiState,
  getCards,
  getHistory,
  getSnapshots,
  saveAnkiState,
  saveCards
} from '../storage/db.js';
import {
  activeProfileCards,
  cardsForFilteredDeck,
  cardsInDeck,
  checkCollection,
  cloneNoteType,
  createDeck,
  createFilteredDeck,
  createNote,
  createSnapshot,
  deleteDeck,
  deleteEmptyCards,
  exportCollectionPackage,
  importCollectionPackage,
  importTextCards,
  presetForCard,
  removeSnapshot,
  renameDeck,
  resetCards,
  restoreSnapshot,
  setDueDate,
  unburyAll,
  undoLast,
  pushUndo,
  updateNote,
  regenerateNote
} from './collection.js';
import { searchCards } from './search.js';
import { DEFAULT_DECK_ID, IMAGE_OCCLUSION_NOTE_TYPE_ID } from './defaults.js';
import { noteFieldDisplayName, noteTypeDisplayName, noteTypeKindDisplayName } from './localization.js';
import { exportAnkiPackage } from './anki-package.js';
import { downloadText, nowIso, uid } from '../utils/core.js';
import { evaluateFsrs, minimumRecommendedRetention, optimizeFsrsParameters, rescheduleForRetention } from './fsrs-tools.js';

interface Callbacks {
  showStatus: (message: string, error?: boolean) => void;
  startCards: (cards: StudyCard[], mode: ReviewMode, deckId?: string, filteredDeckId?: string) => Promise<void>;
  refresh: () => Promise<void>;
}

function section(title: string, help?: string): HTMLElement {
  const node = el('section', { className: 'anki-panel settings-card' });
  node.append(el('h2', { text: title }));
  if (help) node.append(el('p', { className: 'help', text: help }));
  return node;
}

function labeledInput(labelText: string, value = '', type = 'text'): { label: HTMLLabelElement; input: HTMLInputElement } {
  const label = el('label', { text: labelText });
  const input = el('input', { attrs: { type } });
  input.value = value;
  label.append(input);
  return { label, input };
}

function labeledTextarea(labelText: string, value = '', rows = 4): { label: HTMLLabelElement; textarea: HTMLTextAreaElement } {
  const label = el('label', { text: labelText });
  const textarea = el('textarea', { attrs: { rows: String(rows) } });
  textarea.value = value;
  label.append(textarea);
  return { label, textarea };
}

function selectFrom<T extends { id: string; name: string }>(items: T[], value?: string): HTMLSelectElement {
  const select = el('select');
  for (const item of items) select.append(new Option(item.name, item.id, false, item.id === value));
  return select;
}

function selectNoteTypes(items: NoteTypeDefinition[], value?: string): HTMLSelectElement {
  const select = el('select');
  for (const item of items) select.append(new Option(noteTypeDisplayName(item), item.id, false, item.id === value));
  return select;
}

function tomorrowIso(): string {
  const date = new Date();
  date.setHours(24, 0, 0, 0);
  return date.toISOString();
}

class ImageOcclusionEditor {
  readonly root = el('div', { className: 'io-editor' });
  private readonly file = el('input', { attrs: { type: 'file', accept: 'image/*' } });
  private readonly stage = el('div', { className: 'io-stage' });
  private readonly image = el('img', { attrs: { alt: 'Image Occlusion source' } });
  private readonly status = el('p', { className: 'help', text: '画像を選び、隠したい範囲をドラッグしてください。' });
  private masks: ImageOcclusionMask[] = [];
  private dataUrl = '';
  private dragStart: { x: number; y: number } | null = null;
  private draft: HTMLElement | null = null;

  constructor() {
    const controls = el('div', { className: 'button-row' });
    const undo = button('最後のマスクを戻す');
    const clearButton = button('マスクを全消去');
    undo.addEventListener('click', () => { this.masks.pop(); this.drawMasks(); });
    clearButton.addEventListener('click', () => { this.masks = []; this.drawMasks(); });
    controls.append(undo, clearButton);
    this.stage.append(this.image);
    this.root.append(this.file, this.status, this.stage, controls);
    this.file.addEventListener('change', () => void this.loadImage());
    this.stage.addEventListener('pointerdown', (event) => this.pointerDown(event));
    this.stage.addEventListener('pointermove', (event) => this.pointerMove(event));
    this.stage.addEventListener('pointerup', (event) => this.pointerUp(event));
    this.stage.addEventListener('pointercancel', () => this.cancelDraft());
  }

  private async loadImage(): Promise<void> {
    const file = this.file.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) throw new Error('画像ファイルを選択してください。');
    if (file.size > 8 * 1024 * 1024) throw new Error('画像は8MB以内にしてください。');
    this.dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(reader.error ?? new Error('画像を読み込めませんでした。'));
      reader.readAsDataURL(file);
    });
    this.image.src = this.dataUrl;
    this.masks = [];
    this.status.textContent = '画像上をドラッグしてマスクを追加します。マスクごとに答えを登録できます。';
    this.drawMasks();
  }

  private percent(event: PointerEvent): { x: number; y: number } {
    const rect = this.stage.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(100, (event.clientX - rect.left) / Math.max(1, rect.width) * 100)),
      y: Math.max(0, Math.min(100, (event.clientY - rect.top) / Math.max(1, rect.height) * 100))
    };
  }

  private pointerDown(event: PointerEvent): void {
    if (!this.dataUrl || event.button > 0) return;
    event.preventDefault();
    this.stage.setPointerCapture(event.pointerId);
    this.dragStart = this.percent(event);
    this.draft = el('div', { className: 'io-mask io-mask-draft' });
    this.stage.append(this.draft);
  }

  private pointerMove(event: PointerEvent): void {
    if (!this.dragStart || !this.draft) return;
    const point = this.percent(event);
    const x = Math.min(this.dragStart.x, point.x);
    const y = Math.min(this.dragStart.y, point.y);
    const width = Math.abs(point.x - this.dragStart.x);
    const height = Math.abs(point.y - this.dragStart.y);
    Object.assign(this.draft.style, { left: `${x}%`, top: `${y}%`, width: `${width}%`, height: `${height}%` });
  }

  private pointerUp(event: PointerEvent): void {
    if (!this.dragStart) return;
    const point = this.percent(event);
    const x = Math.min(this.dragStart.x, point.x);
    const y = Math.min(this.dragStart.y, point.y);
    const width = Math.abs(point.x - this.dragStart.x);
    const height = Math.abs(point.y - this.dragStart.y);
    this.cancelDraft();
    if (width < 1 || height < 1) return;
    const answer = window.prompt('このマスクの答えを入力してください。', '') ?? '';
    this.masks.push({ id: uid('mask'), x, y, width, height, answer });
    this.drawMasks();
  }

  private cancelDraft(): void {
    this.draft?.remove();
    this.draft = null;
    this.dragStart = null;
  }

  private drawMasks(): void {
    this.stage.querySelectorAll('.io-mask').forEach((node) => node.remove());
    this.masks.forEach((mask, index) => {
      const node = el('div', { className: 'io-mask', text: String(index + 1) });
      Object.assign(node.style, { left: `${mask.x}%`, top: `${mask.y}%`, width: `${mask.width}%`, height: `${mask.height}%` });
      node.title = mask.answer || `Mask ${index + 1}`;
      this.stage.append(node);
    });
  }

  values(): { image: string; masks: ImageOcclusionMask[] } {
    return { image: this.dataUrl, masks: [...this.masks] };
  }
}

export class AnkiCenter {
  constructor(private readonly callbacks: Callbacks) {}

  private decorateEditor(textarea: HTMLTextAreaElement, cloze = false): HTMLElement {
    const toolbar=el('div',{className:'editor-toolbar button-row'});
    const wrap=(before:string,after:string=before)=>{const start=textarea.selectionStart,end=textarea.selectionEnd,value=textarea.value;const selected=value.slice(start,end);textarea.value=value.slice(0,start)+before+selected+after+value.slice(end);textarea.focus();textarea.setSelectionRange(start+before.length,end+before.length);};
    const bold=button('B','small-button');bold.title='太字';bold.addEventListener('click',()=>wrap('<b>','</b>'));
    const italic=button('I','small-button');italic.title='斜体';italic.addEventListener('click',()=>wrap('<i>','</i>'));
    const underline=button('U','small-button');underline.addEventListener('click',()=>wrap('<u>','</u>'));
    const math=button('MathJax','small-button');math.addEventListener('click',()=>wrap('\\(','\\)'));
    const latex=button('LaTeX','small-button');latex.addEventListener('click',()=>wrap('[latex]','[/latex]'));
    const clozeButton=button('穴埋め','small-button');clozeButton.hidden=!cloze;clozeButton.addEventListener('click',()=>wrap('{{c1::','}}'));
    const attach=button('画像/音声/動画','small-button');const file=el('input',{attrs:{type:'file',accept:'image/*,audio/*,video/*'}});file.hidden=true;attach.addEventListener('click',()=>file.click());file.addEventListener('change',()=>void(async()=>{const f=file.files?.[0];if(!f)return;if(f.size>15*1024*1024){this.callbacks.showStatus('メディアは15MB以内にしてください。',true);return;}const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result??''));reader.onerror=()=>reject(reader.error);reader.readAsDataURL(f)});const tag=f.type.startsWith('image/')?`<img src="${data}" alt="${f.name}">`:f.type.startsWith('audio/')?`<audio controls src="${data}"></audio>`:`<video controls playsinline src="${data}"></video>`;const pos=textarea.selectionStart;textarea.value=textarea.value.slice(0,pos)+tag+textarea.value.slice(textarea.selectionEnd);file.value='';})());
    toolbar.append(bold,italic,underline,math,latex,clozeButton,attach,file);
    if(typeof MediaRecorder!=='undefined'&&navigator.mediaDevices?.getUserMedia){const record=button('録音','small-button');let recorder:MediaRecorder|null=null,chunks:BlobPart[]=[];record.addEventListener('click',()=>void(async()=>{if(recorder&&recorder.state==='recording'){recorder.stop();record.textContent='録音';return;}try{const stream=await navigator.mediaDevices.getUserMedia({audio:true});chunks=[];recorder=new MediaRecorder(stream);recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};recorder.onstop=()=>{const blob=new Blob(chunks,{type:recorder?.mimeType||'audio/webm'});const reader=new FileReader();reader.onload=()=>{textarea.value+=`<audio controls src="${String(reader.result??'')}"></audio>`};reader.readAsDataURL(blob);stream.getTracks().forEach(t=>t.stop())};recorder.start();record.textContent='停止';}catch{this.callbacks.showStatus('マイクを利用できませんでした。',true);}}));toolbar.append(record)}
    return toolbar;
  }

  async render(container: HTMLElement): Promise<void> {
    const [state, cards, history] = await Promise.all([getAnkiState(), getCards(), getHistory()]);
    const activeCards = activeProfileCards(cards, state);
    const wrapper = el('div', { className: 'anki-center settings-grid' });
    wrapper.append(this.renderOverview(state, activeCards, history.length));
    wrapper.append(await this.renderDecks(state, activeCards));
    wrapper.append(this.renderAddNote(state));
    wrapper.append(this.renderBrowser(state, activeCards, history));
    wrapper.append(this.renderFilteredDecks(state));
    wrapper.append(this.renderNoteTypes(state));
    wrapper.append(this.renderScheduler(state));
    wrapper.append(this.renderProfiles(state));
    wrapper.append(await this.renderBackupAndImport(state));
    wrapper.append(this.renderMaintenance(state));
    container.append(wrapper);
  }

  private renderOverview(state: AnkiState, cards: StudyCard[], historyCount: number): HTMLElement {
    const node = section('Anki互換センター', 'デッキ、ノートタイプ、テンプレート、穴埋め、画像穴埋め、検索、フィルターデッキ、FSRS設定、バックアップ等を管理します。');
    const noteCount = state.notes.filter((note) => note.profileId === state.activeProfileId && !note.deletedAt).length;
    const metrics = el('div', { className: 'metric-grid' });
    const metric = (value: string, label: string) => { const m = el('div', { className: 'metric' }); m.append(el('strong', { text: value }), el('span', { text: label })); return m; };
    metrics.append(metric(String(cards.length), 'カード'), metric(String(noteCount), 'ノート'), metric(String(state.decks.filter((d) => d.profileId === state.activeProfileId).length), 'デッキ'), metric(String(historyCount), '復習履歴'));
    node.append(metrics);
    return node;
  }

  private async renderDecks(state: AnkiState, cards: StudyCard[]): Promise<HTMLElement> {
    const node = section('デッキ / サブデッキ');
    const create = labeledInput('新しいデッキ名');
    const createButton = button('デッキを作成', 'primary-button');
    createButton.addEventListener('click', () => void (async () => {
      try { await createDeck(create.input.value); this.callbacks.showStatus('デッキを作成しました。'); await this.callbacks.refresh(); }
      catch (error) { this.callbacks.showStatus(error instanceof Error ? error.message : '作成に失敗しました。', true); }
    })());
    node.append(create.label, createButton);

    const list = el('div', { className: 'anki-list' });
    const decks = state.decks.filter((deck) => deck.profileId === state.activeProfileId).sort((a, b) => a.name.localeCompare(b.name, 'ja'));
    for (const deck of decks) {
      const item = el('div', { className: 'anki-row' });
      const deckCards = cardsInDeck(cards, state, deck.id, true).filter((card) => !card.suspended && (!card.buriedUntil || new Date(card.buriedUntil).getTime() <= Date.now()));
      const due = deckCards.filter((card) => card.schedule.reps > 0 && new Date(card.schedule.due).getTime() <= Date.now()).length;
      const fresh = deckCards.filter((card) => card.schedule.reps === 0).length;
      const info = el('div');
      info.append(el('strong', { text: deck.name }), el('p', { className: 'help', text: `復習 ${due} / 新規 ${fresh} / 合計 ${deckCards.length}` }));
      const actions = el('div', { className: 'row-actions' });
      const study = button('学習', 'small-button');
      study.addEventListener('click', () => void this.studyDeck(deck.id));
      const child = button('サブデッキ', 'small-button');
      child.addEventListener('click', () => void (async () => {
        const name = window.prompt('サブデッキ名', ''); if (!name) return;
        await createDeck(name, deck.id); await this.callbacks.refresh();
      })());
      const exportDeck = button('書き出し', 'small-button');
      exportDeck.addEventListener('click', () => void exportAnkiPackage(deck.id).then(() => this.callbacks.showStatus(`${deck.name} をAnki形式で書き出しました。`)).catch((error) => this.callbacks.showStatus(error instanceof Error ? error.message : '書き出しに失敗しました。', true)));
      const rename = button('名前変更', 'small-button');
      rename.addEventListener('click', () => void (async () => {
        const name = window.prompt('新しいデッキ名', deck.name); if (!name || name === deck.name) return;
        await renameDeck(deck.id, name); await this.callbacks.refresh();
      })());
      if (deck.id !== DEFAULT_DECK_ID) {
        const remove = button('削除', 'small-button');
        remove.addEventListener('click', () => void (async () => {
          if (!window.confirm(`${deck.name} を削除し、カードをDefaultへ移動しますか？`)) return;
          await deleteDeck(deck.id); await this.callbacks.refresh();
        })());
        actions.append(remove);
      }
      actions.prepend(study, child, rename, exportDeck);
      item.append(info, actions);
      list.append(item);
    }
    node.append(list);
    return node;
  }

  private async studyDeck(deckId: string): Promise<void> {
    const [state, cards] = await Promise.all([getAnkiState(), getCards()]);
    const deckCards = cardsInDeck(activeProfileCards(cards, state), state, deckId, true)
      .filter((card) => !card.suspended && (!card.buriedUntil || new Date(card.buriedUntil).getTime() <= Date.now()));
    const sample = deckCards[0];
    const preset = sample ? presetForCard(sample, state) : state.presets[0];
    let due = deckCards.filter((card) => card.schedule.reps > 0 && new Date(card.schedule.due).getTime() <= Date.now());
    if(preset?.reviewOrder==='random') due=shuffleLocal(due); else if(preset?.reviewOrder==='difficulty') due.sort((a,b)=>b.schedule.difficulty-a.schedule.difficulty); else if(preset?.reviewOrder==='retrievability') due.sort((a,b)=>a.schedule.stability-b.schedule.stability); else due.sort((a,b)=>a.schedule.due.localeCompare(b.schedule.due));
    due=due.slice(0,preset?.dailyReviewLimit??200);
    let fresh=deckCards.filter((card)=>card.schedule.reps===0);
    if(preset?.newGatherOrder==='random') fresh=shuffleLocal(fresh); else if(preset?.newGatherOrder==='descending') fresh.sort((a,b)=>(b.position??0)-(a.position??0)); else fresh.sort((a,b)=>(a.position??0)-(b.position??0));
    fresh=fresh.slice(0,preset?.dailyNewLimit??20);
    const queue = preset?.newReviewOrder === 'before' ? [...fresh, ...due] : preset?.newReviewOrder === 'after' ? [...due, ...fresh] : due.flatMap((card, index) => fresh[index] ? [card, fresh[index] as StudyCard] : [card]).concat(fresh.slice(due.length));
    if (!queue.length) { this.callbacks.showStatus('このデッキに学習対象カードはありません。', true); return; }
    await this.callbacks.startCards(queue, 'deck', deckId);
  }

  private renderAddNote(state: AnkiState): HTMLElement {
    const node = section('ノートを追加', '基本 / 表裏カード / 解答入力 / 穴埋め / 画像穴埋め / カスタムノートタイプに対応します。');
    const typeLabel = el('label', { text: 'ノートタイプ' });
    const typeSelect = selectNoteTypes(state.noteTypes);
    typeLabel.append(typeSelect);
    const deckLabel = el('label', { text: 'デッキ' });
    const deckSelect = selectFrom(state.decks.filter((deck) => deck.profileId === state.activeProfileId), DEFAULT_DECK_ID);
    deckLabel.append(deckSelect);
    const tags = labeledInput('タグ（空白またはカンマ区切り）');
    const fields = el('div', { className: 'anki-fields' });
    let ioEditor: ImageOcclusionEditor | null = null;

    const rebuild = () => {
      clear(fields);
      ioEditor = null;
      const type = state.noteTypes.find((item) => item.id === typeSelect.value);
      if (!type) return;
      if (type.kind === 'image-occlusion') {
        ioEditor = new ImageOcclusionEditor();
        fields.append(ioEditor.root);
        const extra = labeledTextarea('補足', '', 3); extra.textarea.dataset.field = 'Extra'; fields.append(extra.label);
        return;
      }
      for (const field of type.fields) {
        const control = labeledTextarea(noteFieldDisplayName(field.name), '', field.name.toLowerCase().includes('text') ? 6 : 3);
        control.textarea.dataset.field = field.name;
        if (field.name === 'Add Reverse') { control.textarea.placeholder = '逆向きカードを作る場合は何か入力'; }
        const isCloze=type.kind === 'cloze' && field.name.toLowerCase() === 'text';
        if (isCloze) control.textarea.placeholder = '例: 日本の首都は {{c1::東京}} です。';
        control.label.append(this.decorateEditor(control.textarea,isCloze));
        fields.append(control.label);
      }
    };
    typeSelect.addEventListener('change', rebuild);
    rebuild();
    const save = button('ノートを保存してカード生成', 'primary-button');
    save.addEventListener('click', () => void (async () => {
      try {
        const type = state.noteTypes.find((item) => item.id === typeSelect.value);
        if (!type) throw new Error('ノートタイプが見つかりません。');
        const values: Record<string, string> = {};
        fields.querySelectorAll<HTMLTextAreaElement>('textarea[data-field]').forEach((input) => { values[input.dataset.field ?? ''] = input.value; });
        if (type.kind === 'image-occlusion') {
          const io = ioEditor?.values();
          if (!io?.image || !io.masks.length) throw new Error('画像と1つ以上のマスクを登録してください。');
          values.Image = io.image;
          values.Masks = JSON.stringify(io.masks);
        }
        const tagList = tags.input.value.split(/[\s,]+/).map((value) => value.trim()).filter(Boolean);
        const cards = await createNote({ profileId: state.activeProfileId, deckId: deckSelect.value || DEFAULT_DECK_ID, noteTypeId: type.id, fields: values, tags: tagList });
        if (!cards.length) throw new Error('カードが生成されませんでした。テンプレートまたはCloze番号を確認してください。');
        this.callbacks.showStatus(`${cards.length}枚のカードを生成しました。`);
        await this.callbacks.refresh();
      } catch (error) { this.callbacks.showStatus(error instanceof Error ? error.message : '保存に失敗しました。', true); }
    })());
    node.append(typeLabel, deckLabel, tags.label, fields, save);
    return node;
  }

  private renderBrowser(state: AnkiState, cards: StudyCard[], history: Awaited<ReturnType<typeof getHistory>>): HTMLElement {
    const node = section('ブラウザ / 高度な検索', 'tag:, deck:, note:, card:, is:due/new/review/learn/suspended/buried/marked, flag:, prop:, added:, edited:, rated:, cid:, nid:, -除外, /正規表現/ を使えます。');
    const search = labeledInput('検索', '');
    search.input.placeholder = '例: deck:数学 tag:図形 is:due -flag:1';
    const controls = el('div', { className: 'browser-toolbar' });
    const action = el('select');
    const actions = [
      ['suspend','選択カードを一時停止'], ['unsuspend','一時停止解除'], ['bury','明日まで埋める'], ['unbury','埋める解除'],
      ['mark','Markedを付ける'], ['unmark','Marked解除'], ['flag1','赤フラグ'], ['flag2','オレンジ'], ['flag3','緑'], ['flag4','青'],
      ['flag5','ピンク'], ['flag6','ターコイズ'], ['flag7','紫'], ['flag0','フラグ解除'], ['due','期日を設定'], ['reset','新規へリセット'],
      ['reposition','新規位置を変更'], ['move','デッキ移動'], ['addtag','タグ追加'], ['removetag','タグ削除'], ['findreplace','検索置換'], ['editnote','ノート編集'], ['info','カード情報'], ['delete','削除']
    ];
    actions.forEach(([value, label]) => action.append(new Option(label, value)));
    const execute = button('実行', 'primary-button');
    const undo = button('最後の操作を取り消す');
    const saveSearch = button('検索を保存');
    controls.append(action, execute, undo, saveSearch);
    const summary = el('p', { className: 'help' });
    const list = el('div', { className: 'anki-browser-list' });
    const selected = new Set<string>();

    const draw = () => {
      clear(list); selected.clear();
      const result = searchCards(cards, state, history, search.input.value).slice(0, 300);
      summary.textContent = `${result.length}件表示（最大300件）`;
      for (const card of result) {
        const row = el('label', { className: 'anki-browser-row' });
        const checkbox = el('input', { attrs: { type: 'checkbox' } });
        checkbox.addEventListener('change', () => checkbox.checked ? selected.add(card.id) : selected.delete(card.id));
        const deck = state.decks.find((item) => item.id === card.deckId)?.name ?? 'Default';
        const meta = `${deck} · ${card.schedule.reps === 0 ? 'New' : card.queue ?? 'Review'} · Flag ${card.flag ?? 0}${card.suspended ? ' · Suspended' : ''}${card.buriedUntil ? ' · Buried' : ''}`;
        const text = el('div');
        text.append(el('strong', { text: card.cardNumber ? `No.${card.cardNumber} ${stripForList(card.question)}` : stripForList(card.question) }), el('p', { className: 'help', text: meta }));
        row.append(checkbox, text);
        list.append(row);
      }
    };
    search.input.addEventListener('input', draw);
    draw();

    execute.addEventListener('click', () => void this.executeBrowserAction(action.value, selected, state));
    undo.addEventListener('click', () => void (async () => {
      const label = await undoLast();
      this.callbacks.showStatus(label ? `「${label}」を取り消しました。` : '取り消せる操作がありません。', !label);
      await this.callbacks.refresh();
    })());
    saveSearch.addEventListener('click', () => void (async () => {
      const name = window.prompt('保存する検索名', ''); if (!name) return;
      const current = await getAnkiState();
      await saveAnkiState({ ...current, savedSearches: [...current.savedSearches, { id: uid('search'), name, query: search.input.value }] });
      this.callbacks.showStatus('検索を保存しました。');
    })());
    if (state.savedSearches.length) {
      const saved = el('div', { className: 'button-row' });
      state.savedSearches.forEach((item) => {
        const b = button(item.name, 'small-button'); b.addEventListener('click', () => { search.input.value = item.query; draw(); }); saved.append(b);
      });
      node.append(saved);
    }
    node.append(search.label, controls, summary, list);
    return node;
  }

  private async executeBrowserAction(action: string, selected: Set<string>, state: AnkiState): Promise<void> {
    if (!selected.size) { this.callbacks.showStatus('カードを選択してください。', true); return; }
    const cards = (await getCards(true)).filter((card) => selected.has(card.id));
    if(action==='info') { const card=cards[0]; if(!card)return; const total=card.stats.correct+card.stats.incorrect; window.alert(`Card ID: ${card.id}\nNote ID: ${card.noteId??''}\nDue: ${card.schedule.due}\nReps: ${card.schedule.reps}\nLapses: ${card.schedule.lapses}\nStability: ${card.schedule.stability.toFixed(3)}\nDifficulty: ${card.schedule.difficulty.toFixed(3)}\nAccuracy: ${total?Math.round(card.stats.correct/total*100):0}%`); return; }
    if(action==='editnote') { const card=cards[0]; const note=state.notes.find(n=>n.id===card?.noteId); if(!note){this.callbacks.showStatus('ノートが見つかりません。',true);return;} const fields={...note.fields}; for(const key of Object.keys(fields)){const value=window.prompt(`${key} を編集`,fields[key]??'');if(value===null)return;fields[key]=value;} await updateNote({...note,fields});this.callbacks.showStatus('ノートを更新し、カードを再生成しました。');await this.callbacks.refresh();return; }
    if(action==='addtag'||action==='removetag'||action==='findreplace') { const current=await getAnkiState();const noteIds=new Set(cards.map(c=>c.noteId).filter(Boolean));let nextNotes=[...current.notes];if(action==='addtag'||action==='removetag'){const tag=window.prompt(action==='addtag'?'追加するタグ':'削除するタグ','')?.trim();if(!tag)return;nextNotes=nextNotes.map(n=>noteIds.has(n.id)?{...n,tags:action==='addtag'?[...new Set([...n.tags,tag])]:n.tags.filter(t=>t!==tag),updatedAt:nowIso()}:n);}else{const find=window.prompt('検索文字列','');if(!find)return;const replacement=window.prompt('置換後','')??'';nextNotes=nextNotes.map(n=>noteIds.has(n.id)?{...n,fields:Object.fromEntries(Object.entries(n.fields).map(([k,v])=>[k,v.replaceAll(find,replacement)])),updatedAt:nowIso()}:n);}await saveAnkiState({...current,notes:nextNotes});for(const noteId of noteIds)await regenerateNote(noteId as string);this.callbacks.showStatus('ノートを更新しました。');await this.callbacks.refresh();return;}
    await pushUndo(action, cards);
    const timestamp = nowIso();
    if (action === 'reset') await resetCards([...selected]);
    else if (action === 'due') {
      const value = Number(window.prompt('何日後を期日にしますか？ 0=今日、1=明日', '0'));
      if (!Number.isFinite(value)) return;
      await setDueDate([...selected], value);
    } else {
      let positionStart = 0;
      let moveDeck = '';
      if (action === 'reposition') positionStart = Number(window.prompt('新しい開始位置', '1')) || 1;
      if (action === 'move') {
        const choices = state.decks.filter((deck) => deck.profileId === state.activeProfileId).map((deck) => `${deck.id}: ${deck.name}`).join('\n');
        moveDeck = window.prompt(`移動先のデッキIDを入力\n${choices}`, DEFAULT_DECK_ID) ?? '';
        if (!state.decks.some((deck) => deck.id === moveDeck)) { this.callbacks.showStatus('デッキIDが不正です。', true); return; }
      }
      const updated = cards.map((card, index) => {
        const base = { ...card, updatedAt: timestamp, version: card.version + 1 };
        if (action === 'suspend') return { ...base, suspended: true, buriedUntil: null };
        if (action === 'unsuspend') return { ...base, suspended: false };
        if (action === 'bury') return { ...base, buriedUntil: tomorrowIso(), suspended: false };
        if (action === 'unbury') return { ...base, buriedUntil: null };
        if (action === 'mark') return { ...base, marked: true, favorite: true, tags: [...new Set([...card.tags, 'marked'])] };
        if (action === 'unmark') return { ...base, marked: false, favorite: false, tags: card.tags.filter((tag) => tag !== 'marked') };
        if (/^flag[0-7]$/.test(action)) return { ...base, flag: Number(action.at(-1)) as CardFlag };
        if (action === 'reposition') return { ...base, position: positionStart + index };
        if (action === 'move') return { ...base, deckId: moveDeck };
        if (action === 'delete') return { ...base, deletedAt: timestamp };
        return base;
      });
      await saveCards(updated);
    }
    this.callbacks.showStatus(`${selected.size}枚を更新しました。`);
    await this.callbacks.refresh();
  }

  private renderFilteredDecks(state: AnkiState): HTMLElement {
    const node = section('フィルターデッキ / Custom Study');
    const name = labeledInput('名前', 'Filtered Deck');
    const query = labeledInput('検索条件', 'is:due');
    const limit = labeledInput('上限', '100', 'number');
    const rescheduleLabel = el('label', { className: 'check-row', text: '学習結果を通常のスケジュールへ反映' });
    const reschedule = el('input', { attrs: { type: 'checkbox' } }); reschedule.checked = true; rescheduleLabel.prepend(reschedule);
    const create = button('フィルターデッキを作成', 'primary-button');
    create.addEventListener('click', () => void (async () => {
      await createFilteredDeck(name.input.value, query.input.value, Number(limit.input.value), reschedule.checked);
      await this.callbacks.refresh();
    })());
    node.append(name.label, query.label, limit.label, rescheduleLabel, create);
    const list = el('div', { className: 'anki-list' });
    for (const filtered of state.filteredDecks.filter((item) => item.profileId === state.activeProfileId)) {
      const row = el('div', { className: 'anki-row' });
      const info = el('div'); info.append(el('strong', { text: filtered.name }), el('p', { className: 'help', text: `${filtered.search} · 上限${filtered.limit}` }));
      const study = button('学習', 'small-button');
      study.addEventListener('click', () => void (async () => {
        const cards = await cardsForFilteredDeck(filtered.id);
        if (!cards.length) { this.callbacks.showStatus('該当カードがありません。', true); return; }
        await this.callbacks.startCards(cards, 'filtered', undefined, filtered.id);
      })());
      const remove = button('削除', 'small-button');
      remove.addEventListener('click', () => void (async () => {
        const current = await getAnkiState();
        await saveAnkiState({ ...current, filteredDecks: current.filteredDecks.filter((item) => item.id !== filtered.id) });
        await this.callbacks.refresh();
      })());
      const actions = el('div', { className: 'row-actions' }); actions.append(study, remove); row.append(info, actions); list.append(row);
    }
    node.append(list);
    return node;
  }

  private renderNoteTypes(state: AnkiState): HTMLElement {
    const node = section('ノートタイプ / フィールド / カードテンプレート');
    const baseLabel = el('label', { text: '複製元' });
    const base = selectNoteTypes(state.noteTypes); baseLabel.append(base);
    const name = labeledInput('新しいノートタイプ名', 'Custom');
    const fields = labeledInput('フィールド（カンマ区切り）', 'Front,Back,Extra');
    const front = labeledTextarea('表テンプレート', '{{Front}}', 4);
    const back = labeledTextarea('裏テンプレート', '{{FrontSide}}<hr id="answer">{{Back}}', 4);
    const css = labeledTextarea('カードCSS', '.card { font-size: 20px; text-align: center; }', 3);
    const create = button('カスタムノートタイプを作成', 'primary-button');
    base.addEventListener('change', () => {
      const source = state.noteTypes.find((item) => item.id === base.value); if (!source) return;
      fields.input.value = source.fields.map((field) => field.name).join(',');
      front.textarea.value = source.templates[0]?.front ?? '{{Front}}'; back.textarea.value = source.templates[0]?.back ?? '{{Back}}'; css.textarea.value = source.css;
    });
    create.addEventListener('click', () => void (async () => {
      const source = state.noteTypes.find((item) => item.id === base.value); if (!source) return;
      const cloned = cloneNoteType(source, name.input.value);
      cloned.fields = fields.input.value.split(',').map((value) => value.trim()).filter(Boolean).map((fieldName) => ({ id: uid('field'), name: fieldName }));
      cloned.templates = [{ id: uid('template'), name: 'Card 1', front: front.textarea.value, back: back.textarea.value }];
      cloned.css = css.textarea.value;
      const current = await getAnkiState(); await saveAnkiState({ ...current, noteTypes: [...current.noteTypes, cloned] });
      this.callbacks.showStatus('ノートタイプを作成しました。'); await this.callbacks.refresh();
    })());
    node.append(baseLabel, name.label, fields.label, front.label, back.label, css.label, create);
    const list = el('div', { className: 'anki-list' });
    for (const type of state.noteTypes) {
      const row = el('div', { className: 'anki-row' });
      const info = el('div'); info.append(el('strong', { text: noteTypeDisplayName(type) }), el('p', { className: 'help', text: `${noteTypeKindDisplayName(type.kind)} · ${type.fields.map((field) => noteFieldDisplayName(field.name)).join(', ')} · テンプレート${type.templates.length}件` }));
      const actions = el('div', { className: 'row-actions' });
      if (!type.builtin) {
        const remove = button('削除', 'small-button');
        remove.addEventListener('click', () => void (async () => {
          if (state.notes.some((note) => note.noteTypeId === type.id && !note.deletedAt)) { this.callbacks.showStatus('使用中のノートタイプは削除できません。', true); return; }
          const current = await getAnkiState(); await saveAnkiState({ ...current, noteTypes: current.noteTypes.filter((item) => item.id !== type.id) }); await this.callbacks.refresh();
        })()); actions.append(remove);
      }
      row.append(info, actions); list.append(row);
    }
    node.append(list);
    return node;
  }

  private renderScheduler(state: AnkiState): HTMLElement {
    const node = section('FSRS-6 / デッキオプション', '希望保持率、学習/再学習ステップ、日次上限、兄弟カードのbury、表示順、タイマー、音声を設定します。');
    const deckLabel = el('label', { text: '対象デッキ' });
    const decks = state.decks.filter((deck) => deck.profileId === state.activeProfileId);
    const deckSelect = selectFrom(decks, decks[0]?.id); deckLabel.append(deckSelect);
    const presetLabel = el('label', { text: 'プリセット' });
    const presetSelect = selectFrom(state.presets, decks[0]?.presetId); presetLabel.append(presetSelect);
    const retention = labeledInput('希望保持率 (0.70〜0.99)', '0.90', 'number'); retention.input.step = '0.01'; retention.input.min = '0.7'; retention.input.max = '0.99';
    const learning = labeledInput('学習ステップ（分、カンマ区切り）', '1,10');
    const relearning = labeledInput('再学習ステップ（分）', '10');
    const newLimit = labeledInput('新規/日', '20', 'number');
    const reviewLimit = labeledInput('復習/日', '200', 'number');
    const maxInterval = labeledInput('最大間隔（日）', '36500', 'number');
    const timer = labeledInput('最大回答時間（秒）', '60', 'number');
    const autoAdvance = labeledInput('自動進行（秒、0=無効）', '0', 'number');
    const buryNew = checkbox('新規の兄弟カードをbury');
    const buryReview = checkbox('復習の兄弟カードをbury');
    const autoplay = checkbox('音声を自動再生');
    const leechThreshold = labeledInput('Leech閾値（lapse回数）', '8', 'number');
    const leechSuspend = checkbox('Leechになったカードを自動Suspended');
    const parametersBox = labeledTextarea('FSRS-6パラメータ（21個・カンマ区切り）', '', 3);
    const newGatherLabel=el('label',{text:'新規カード収集順'});const newGather=el('select');[['deck','デッキ順'],['ascending','位置の昇順'],['descending','位置の降順'],['random','ランダム']].forEach(([v,l])=>newGather.append(new Option(l,v)));newGatherLabel.append(newGather);
    const reviewOrderLabel=el('label',{text:'復習カード順'});const reviewOrder=el('select');[['due','期日順'],['overdue','期限超過優先'],['random','ランダム'],['difficulty','難易度順'],['retrievability','想起確率が低い順']].forEach(([v,l])=>reviewOrder.append(new Option(l,v)));reviewOrderLabel.append(reviewOrder);
    const mixLabel=el('label',{text:'新規/復習の順'});const mix=el('select');[['before','新規を先に'],['mix','混ぜる'],['after','新規を後に']].forEach(([v,l])=>mix.append(new Option(l,v)));mixLabel.append(mix);
    const easyDays=labeledInput('Easy Days（日曜〜土曜の重み、0〜2）','1,1,1,1,1,1,1');

    const load = () => {
      const deck = state.decks.find((item) => item.id === deckSelect.value); if (!deck) return;
      presetSelect.value = deck.presetId;
      const preset = state.presets.find((item) => item.id === deck.presetId); if (!preset) return;
      retention.input.value = String(preset.desiredRetention); learning.input.value = preset.learningStepsMinutes.join(','); relearning.input.value = preset.relearningStepsMinutes.join(',');
      newLimit.input.value = String(preset.dailyNewLimit); reviewLimit.input.value = String(preset.dailyReviewLimit); maxInterval.input.value = String(preset.maximumIntervalDays);
      timer.input.value = String(preset.maximumAnswerSeconds); autoAdvance.input.value = String(preset.autoAdvanceSeconds); buryNew.input.checked = preset.buryNewSiblings; buryReview.input.checked = preset.buryReviewSiblings; autoplay.input.checked = preset.autoplayAudio; leechThreshold.input.value=String(preset.leechThreshold??8);leechSuspend.input.checked=(preset.leechAction??'suspend')==='suspend';parametersBox.textarea.value=(preset.fsrsParameters??[]).join(',');newGather.value=preset.newGatherOrder;reviewOrder.value=preset.reviewOrder;mix.value=preset.newReviewOrder;easyDays.input.value=(preset.easyDays??[1,1,1,1,1,1,1]).join(',');
    };
    deckSelect.addEventListener('change', load); presetSelect.addEventListener('change', () => { const preset = state.presets.find((item) => item.id === presetSelect.value); if (preset) { retention.input.value = String(preset.desiredRetention); } }); load();
    const save = button('デッキオプションを保存', 'primary-button');
    save.addEventListener('click', () => void (async () => {
      const current = await getAnkiState();
      const preset = current.presets.find((item) => item.id === presetSelect.value); if (!preset) return;
      const parseSteps = (value: string) => value.split(',').map(Number).filter((n) => Number.isFinite(n) && n > 0);
      const updated: DeckOptionsPreset = {
        ...preset,
        desiredRetention: Math.max(0.7, Math.min(0.99, Number(retention.input.value) || 0.9)),
        learningStepsMinutes: parseSteps(learning.input.value), relearningStepsMinutes: parseSteps(relearning.input.value),
        dailyNewLimit: clampInt(Number(newLimit.input.value), 0, 9999), dailyReviewLimit: clampInt(Number(reviewLimit.input.value), 1, 9999),
        maximumIntervalDays: clampInt(Number(maxInterval.input.value), 1, 36500), maximumAnswerSeconds: clampInt(Number(timer.input.value), 1, 3600),
        autoAdvanceSeconds: clampInt(Number(autoAdvance.input.value), 0, 3600), buryNewSiblings: buryNew.input.checked, buryReviewSiblings: buryReview.input.checked,
        autoplayAudio: autoplay.input.checked, leechThreshold: clampInt(Number(leechThreshold.input.value),1,100), leechAction: leechSuspend.input.checked?'suspend':'tag', fsrsParameters: parametersBox.textarea.value.split(',').map(Number).filter(Number.isFinite).slice(0,21), newGatherOrder:newGather.value as DeckOptionsPreset['newGatherOrder'],reviewOrder:reviewOrder.value as DeckOptionsPreset['reviewOrder'],newReviewOrder:mix.value as DeckOptionsPreset['newReviewOrder'],easyDays:easyDays.input.value.split(',').map(Number).map(n=>Math.max(0,Math.min(2,Number.isFinite(n)?n:1))).slice(0,7)
      };
      await saveAnkiState({
        ...current,
        presets: current.presets.map((item) => item.id === updated.id ? updated : item),
        decks: current.decks.map((deck) => deck.id === deckSelect.value ? { ...deck, presetId: updated.id, updatedAt: nowIso() } : deck)
      });
      this.callbacks.showStatus('FSRS/デッキオプションを保存しました。');
    })());
    const fsrsActions=el('div',{className:'button-row'});
    const evaluate=button('FSRSを評価');evaluate.addEventListener('click',()=>void(async()=>{const current=await getAnkiState();const p=current.presets.find(x=>x.id===presetSelect.value);if(!p)return;const result=evaluateFsrs(await getHistory(),p.fsrsParameters);this.callbacks.showStatus(`FSRS評価: reviews=${result.reviews}, log loss=${result.logLoss.toFixed(4)}, RMSE=${(result.rmse*100).toFixed(2)}%`);})());
    const optimize=button('FSRSパラメータを最適化');optimize.addEventListener('click',()=>void(async()=>{const current=await getAnkiState();const p=current.presets.find(x=>x.id===presetSelect.value);if(!p)return;const history=await getHistory();if(history.length<20){this.callbacks.showStatus('最適化には20件以上の復習履歴が必要です。',true);return;}const next=optimizeFsrsParameters(history,p.fsrsParameters);await saveAnkiState({...current,presets:current.presets.map(x=>x.id===p.id?{...x,fsrsParameters:next}:x)});parametersBox.textarea.value=next.join(',');this.callbacks.showStatus('復習履歴からFSRSパラメータを最適化しました。');})());
    const cmrr=button('推奨保持率を計算');cmrr.addEventListener('click',()=>void(async()=>{const current=await getAnkiState();const p=current.presets.find(x=>x.id===presetSelect.value);if(!p)return;const value=minimumRecommendedRetention(await getCards(),p);retention.input.value=String(value);this.callbacks.showStatus(`推奨保持率: ${value.toFixed(2)}`);})());
    const reschedule=button('現在の設定で全カードを再スケジュール');reschedule.addEventListener('click',()=>void(async()=>{if(!window.confirm('対象プロファイルの既習カードの期日を再計算しますか？'))return;const current=await getAnkiState();const p=current.presets.find(x=>x.id===presetSelect.value);if(!p)return;const cards=await getCards();await pushUndo('FSRS再スケジュール',cards);await saveCards(rescheduleForRetention(cards,p));this.callbacks.showStatus('FSRSで期日を再計算しました。');await this.callbacks.refresh();})());
    fsrsActions.append(evaluate,optimize,cmrr,reschedule);
    node.append(deckLabel, presetLabel, retention.label, learning.label, relearning.label, newLimit.label, reviewLimit.label, maxInterval.label, timer.label, autoAdvance.label, buryNew.label, buryReview.label, autoplay.label,leechThreshold.label,leechSuspend.label,parametersBox.label,newGatherLabel,reviewOrderLabel,mixLabel,easyDays.label, save,fsrsActions);
    return node;
  }

  private renderProfiles(state: AnkiState): HTMLElement {
    const node = section('プロファイル', 'プロファイルごとにカード、ノート、デッキを分離します。');
    const label = el('label', { text: '現在のプロファイル' });
    const select = selectFrom(state.profiles, state.activeProfileId); label.append(select);
    select.addEventListener('change', () => void (async () => {
      const current = await getAnkiState(); await saveAnkiState({ ...current, activeProfileId: select.value }); await this.callbacks.refresh();
    })());
    const create = button('プロファイルを追加');
    create.addEventListener('click', () => void (async () => {
      const name = window.prompt('プロファイル名', ''); if (!name) return;
      const current = await getAnkiState(); const id = uid('profile');
      await saveAnkiState({ ...current, profiles: [...current.profiles, { id, name, createdAt: nowIso() }], activeProfileId: id,
        decks: [...current.decks, { id: uid('deck'), profileId: id, name: 'Default', description: '', presetId: current.presets[0]?.id ?? 'preset_default', createdAt: nowIso(), updatedAt: nowIso() }] });
      await this.callbacks.refresh();
    })());
    node.append(label, create);
    return node;
  }

  private async renderBackupAndImport(state: AnkiState): Promise<HTMLElement> {
    const node = section('インポート / エクスポート / 自動バックアップ', 'JSONコレクション、CSV/TSV、定期スナップショットに対応します。');
    const actions = el('div', { className: 'button-row' });
    const ankiImport = button('Ankiデッキを読み込む (.apkg/.colpkg)'); ankiImport.addEventListener('click', () => (document.getElementById('import-file') as HTMLInputElement | null)?.click());
    const ankiExport = button('コレクションをAnki形式で書き出す (.apkg)'); ankiExport.addEventListener('click', () => void exportAnkiPackage().then(() => this.callbacks.showStatus('コレクションをAnki形式で書き出しました。')).catch((error) => this.callbacks.showStatus(error instanceof Error ? error.message : '書き出しに失敗しました。', true)));
    const exportButton = button('コレクションを書き出す');
    exportButton.addEventListener('click', () => void (async () => downloadText(`work-1-collection-${nowIso().slice(0,10)}.json`, await exportCollectionPackage(), 'application/json'))());
    const importButton = button('コレクションを読み込む');
    const importFile = el('input', { attrs: { type: 'file', accept: '.json,application/json' } }); importFile.hidden = true;
    importButton.addEventListener('click', () => importFile.click());
    importFile.addEventListener('change', () => void (async () => {
      const file = importFile.files?.[0]; if (!file) return;
      if (!window.confirm('現在のプロファイルデータを置き換えます。続けますか？')) return;
      try { const result = await importCollectionPackage(await file.text()); this.callbacks.showStatus(`${result.cards}枚 / ${result.notes}ノートを読み込みました。`); await this.callbacks.refresh(); }
      catch (error) { this.callbacks.showStatus(error instanceof Error ? error.message : '読み込みに失敗しました。', true); }
      finally { importFile.value = ''; }
    })());
    const textButton = button('CSV/TSVを読み込む');
    const textFile = el('input', { attrs: { type: 'file', accept: '.csv,.tsv,text/csv,text/tab-separated-values,text/plain' } }); textFile.hidden = true;
    textButton.addEventListener('click', () => textFile.click());
    textFile.addEventListener('change', () => void (async () => {
      const file = textFile.files?.[0]; if (!file) return;
      try { const count = await importTextCards(await file.text(), state.decks.find((d) => d.profileId === state.activeProfileId)?.id ?? DEFAULT_DECK_ID); this.callbacks.showStatus(`${count}件のノートを読み込みました。`); await this.callbacks.refresh(); }
      catch (error) { this.callbacks.showStatus(error instanceof Error ? error.message : '読み込みに失敗しました。', true); }
      finally { textFile.value = ''; }
    })());
    const backup = button('今すぐバックアップ');
    backup.addEventListener('click', () => void (async () => { await createSnapshot('manual', 'Manual backup'); this.callbacks.showStatus('バックアップを作成しました。'); await this.callbacks.refresh(); })());
    actions.append(ankiImport, ankiExport, exportButton, importButton, importFile, textButton, textFile, backup); node.append(actions);
    const snapshots = await getSnapshots();
    const list = el('div', { className: 'anki-list' });
    snapshots.slice(0, 12).forEach((snapshot) => {
      const row = el('div', { className: 'anki-row' }); const info = el('div'); info.append(el('strong', { text: `${snapshot.reason}: ${snapshot.label}` }), el('p', { className: 'help', text: new Date(snapshot.createdAt).toLocaleString('ja-JP') }));
      const restore = button('復元', 'small-button'); restore.addEventListener('click', () => void (async () => { if (!window.confirm('このバックアップへ復元しますか？')) return; await restoreSnapshot(snapshot.id); await this.callbacks.refresh(); })());
      const remove = button('削除', 'small-button'); remove.addEventListener('click', () => void (async () => { await removeSnapshot(snapshot.id); await this.callbacks.refresh(); })());
      const rowActions = el('div', { className: 'row-actions' }); rowActions.append(restore, remove); row.append(info, rowActions); list.append(row);
    });
    node.append(list);
    return node;
  }

  private renderMaintenance(_state: AnkiState): HTMLElement {
    const node = section('メンテナンス');
    const actions = el('div', { className: 'button-row' });
    const check = button('データベースをチェック'); check.addEventListener('click', () => void (async () => { const errors = await checkCollection(); this.callbacks.showStatus(errors.length ? errors.slice(0,5).join(' / ') : 'データベースチェック: 問題なし', errors.length > 0); })());
    const empty = button('空カードを削除'); empty.addEventListener('click', () => void (async () => { const count = await deleteEmptyCards(); this.callbacks.showStatus(`${count}枚の空カードを処理しました。`); await this.callbacks.refresh(); })());
    const unbury = button('すべてUnbury'); unbury.addEventListener('click', () => void (async () => { const count = await unburyAll(); this.callbacks.showStatus(`${count}枚をUnburyしました。`); await this.callbacks.refresh(); })());
    const duplicates=button('重複ノートを検索');duplicates.addEventListener('click',()=>void(async()=>{const current=await getAnkiState();const groups=new Map<string,number>();for(const note of current.notes.filter(n=>n.profileId===current.activeProfileId&&!n.deletedAt)){const first=Object.values(note.fields)[0]?.trim();if(first)groups.set(first,(groups.get(first)??0)+1);}const dup=[...groups].filter(([,count])=>count>1);this.callbacks.showStatus(dup.length?`重複候補 ${dup.length}組: ${dup.slice(0,5).map(([v,c])=>`${v.slice(0,30)}(${c})`).join(' / ')}`:'重複候補はありません。',false);})());
    const media=button('メディアをチェック');media.addEventListener('click',()=>void(async()=>{const current=await getAnkiState();let embedded=0,external=0,empty=0;for(const note of current.notes){for(const value of Object.values(note.fields)){for(const match of value.matchAll(/<(?:img|audio|video|source)[^>]+src=["']([^"']*)["']/gi)){const src=match[1]??'';if(!src)empty++;else if(src.startsWith('data:'))embedded++;else external++;}}}this.callbacks.showStatus(`メディアチェック: 埋め込み ${embedded} / 外部参照 ${external} / 空参照 ${empty}`,empty>0);})());
    actions.append(check, empty, unbury,duplicates,media); node.append(actions);
    return node;
  }
}

function checkbox(text: string): { label: HTMLLabelElement; input: HTMLInputElement } {
  const label = el('label', { className: 'check-row', text });
  const input = el('input', { attrs: { type: 'checkbox' } }); label.prepend(input); return { label, input };
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? Math.round(value) : min));
}

function stripForList(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
}

function shuffleLocal<T>(values:T[]):T[]{const copy=[...values];for(let i=copy.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[copy[i],copy[j]]=[copy[j] as T,copy[i] as T];}return copy;}
