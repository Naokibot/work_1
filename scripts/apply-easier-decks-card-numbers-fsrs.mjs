import { readFile, writeFile } from 'node:fs/promises';

async function replace(path, from, to) {
  const source = await readFile(path, 'utf8');
  if (source.includes(to)) return;
  if (!source.includes(from)) throw new Error(`Expected source not found in ${path}: ${from.slice(0, 80)}`);
  await writeFile(path, source.replace(from, to));
}

await replace('src/app/app.ts',
  "import type { ReviewMode, ReviewSession, ReviewStyle, StudyCard } from '../types.js';\n",
  "import type { ReviewMode, ReviewSession, ReviewStyle, StudyCard } from '../types.js';\nimport { refreshCardNumberOptions } from './card-number.js';\n"
);

await replace('src/app/app.ts',
  "    this.addButton.addEventListener('click', () => void this.openAddDialog());\n    this.syncButton.addEventListener('click', () => void this.performSync());",
  "    this.addButton.addEventListener('click', () => void this.openAddDialog());\n    byId<HTMLButtonElement>('note-deck-create').addEventListener('click', () => void this.quickCreateDeck());\n    this.syncButton.addEventListener('click', () => void this.performSync());"
);

await replace('src/app/app.ts',
`  private async promptCreateDeck(): Promise<void> {
    const name = window.prompt('デッキ名');
    if (!name?.trim()) return;
    try { await createDeck(name.trim()); this.showStatus('デッキを作成しました。'); await this.refresh(); }
    catch (error) { this.showStatus(error instanceof Error ? error.message : 'デッキを作成できませんでした。', true); }
  }

  private async openAddDialog(): Promise<void> {`,
`  private async promptCreateDeck(): Promise<void> {
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
      this.showStatus(`${created.name} を作成して選択しました。`);
    } catch (error) { byId<HTMLElement>('card-form-error').textContent = error instanceof Error ? error.message : 'デッキを作成できませんでした。'; }
  }

  private async openAddDialog(): Promise<void> {`
);

await replace('src/app/app.ts',
  "    await this.rebuildNoteFields();\n    this.cardDialog.showModal();",
  "    await this.rebuildNoteFields();\n    await refreshCardNumberOptions();\n    this.cardDialog.showModal();"
);

await replace('src/app/app.ts',
  "      byId<HTMLElement>('note-fields').querySelectorAll<HTMLTextAreaElement>('textarea[data-field]').forEach((input) => { values[input.dataset.field ?? ''] = input.value; });",
  "      byId<HTMLElement>('note-fields').querySelectorAll<HTMLTextAreaElement | HTMLSelectElement>('textarea[data-field], select[data-field]').forEach((input) => { values[input.dataset.field ?? ''] = input.value; });"
);

await replace('src/anki/collection.ts',
`  const nextState = { ...state, notes: [...state.notes, full] };
  const cards = generateCardsForNote(full, nextState);
  await saveAnkiState(nextState);
  await saveCards(cards);
  return cards;`,
`  const nextState = { ...state, notes: [...state.notes, full] };
  let cards = generateCardsForNote(full, nextState);
  const requestedRaw = full.fields.__CardNumber?.trim() ?? '';
  if (requestedRaw) {
    if (!/^\\d+$/u.test(requestedRaw) || Number(requestedRaw) < 1) throw new Error('カード番号が不正です。');
    const requested = Number(requestedRaw);
    const existingCards = await getCards(false, true);
    const used = new Set(existingCards
      .filter((card) => !card.deletedAt && (card.profileId ?? DEFAULT_PROFILE_ID) === full.profileId)
      .map((card) => /^\\d+$/u.test((card.cardNumber ?? '').trim()) ? Number(card.cardNumber) : null)
      .filter((value): value is number => value !== null && value > 0));
    if (used.has(requested)) throw new Error(`カード番号 ${requested} は使用済みです。別の番号を選んでください。`);
    let candidate = requested;
    cards = cards.map((card) => {
      while (used.has(candidate)) candidate += 1;
      const numbered = { ...card, cardNumber: String(candidate) };
      used.add(candidate); candidate += 1;
      return numbered;
    });
  }
  await saveAnkiState(nextState);
  await saveCards(cards);
  return cards;`
);

await replace('src/anki/templates.ts',
  "    cardNumber: fieldValue(note, '__CardNumber').trim() || existing?.cardNumber || base.cardNumber,",
  "    cardNumber: existing?.cardNumber || fieldValue(note, '__CardNumber').trim() || base.cardNumber,"
);

await replace('src/scheduler/scheduler.ts',
`function forgetStability(difficulty: number, stability: number, r: number, w: readonly number[]): number {
  return Math.max(
    0.01,
    Number(w[11] ?? 1.4835)
      * Math.pow(Math.max(difficulty, 1), -Number(w[12] ?? 0.0614))
      * (Math.pow(Math.max(stability, 0) + 1, Number(w[13] ?? 0.2629)) - 1)
      * Math.exp(Number(w[14] ?? 1.6483) * (1 - r))
  );
}`,
`function forgetStability(difficulty: number, stability: number, r: number, w: readonly number[]): number {
  const longTerm = Number(w[11] ?? 1.4835)
    * Math.pow(Math.max(difficulty, 1), -Number(w[12] ?? 0.0614))
    * (Math.pow(Math.max(stability, 0) + 1, Number(w[13] ?? 0.2629)) - 1)
    * Math.exp(Number(w[14] ?? 1.6483) * (1 - r));
  const shortTermCap = Math.max(0.01, stability / Math.exp(Number(w[17] ?? 0.5425) * Number(w[18] ?? 0.0912)));
  return Math.max(0.01, Math.min(longTerm, shortTermCap));
}`
);

await replace('src/scheduler/scheduler.ts',
`  let difficulty = isFirst ? initialDifficulty(grade, w) : nextDifficulty(previous.difficulty, grade, w);
  let stability = isFirst ? Math.max(0.01, Number(w[grade - 1] ?? 1)) : previous.stability;`,
`  let difficulty = isFirst ? initialDifficulty(grade, w) : previous.difficulty;
  let stability = isFirst ? Math.max(0.01, Number(w[grade - 1] ?? 1)) : previous.stability;`
);

await replace('src/scheduler/scheduler.ts',
`  if (!isFirst) {
    const elapsed = elapsedDays(previous, now);
    if (elapsed < 1 && previous.stability > 0) stability = sameDayStability(previous.stability, grade, w);
    else if (rating === 'again') stability = forgetStability(difficulty, previous.stability, r, w);
    else stability = recallStability(difficulty, previous.stability, r, grade, w);
  }`,
`  if (!isFirst) {
    const elapsed = elapsedDays(previous, now);
    if (elapsed < 1 && previous.stability > 0) stability = sameDayStability(previous.stability, grade, w);
    else if (rating === 'again') stability = forgetStability(previous.difficulty, previous.stability, r, w);
    else stability = recallStability(previous.difficulty, previous.stability, r, grade, w);
    difficulty = nextDifficulty(previous.difficulty, grade, w);
  }`
);

await replace('index.html',
  '<div class="add-meta-grid"><label>ノートタイプ<select id="note-type"></select></label><label>デッキ<select id="note-deck"></select></label></div>',
  '<div class="add-meta-grid"><label>ノートタイプ<select id="note-type"></select></label><label>デッキ<div class="deck-select-row"><select id="note-deck"></select><button id="note-deck-create" class="anki-button" type="button" aria-label="新しいデッキを作成">＋ 新規</button></div></label></div>'
);

const styles = await readFile('styles.css', 'utf8');
if (!styles.includes('.deck-select-row{')) {
  await writeFile('styles.css', styles + '\n.deck-select-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px;align-items:center}.deck-select-row .anki-button{white-space:nowrap}.card-number-field select{min-height:38px}.card-number-field .help{margin-top:2px}\n');
}
