import type {
  AnkiState,
  CollectionSnapshot,
  DeckDefinition,
  FilteredDeckDefinition,
  NoteTypeDefinition,
  StudyCard,
  StudyNote
} from '../types.js';
import {
  deleteHistory,
  deleteSnapshot,
  getAnkiState,
  getCards,
  getHistory,
  getSnapshots,
  pruneSnapshots,
  replaceCollection,
  saveAnkiState,
  saveCards,
  saveSnapshot
} from '../storage/db.js';
import { initialSchedule } from '../scheduler/scheduler.js';
import {
  BASIC_NOTE_TYPE_ID,
  DEFAULT_DECK_ID,
  DEFAULT_PRESET_ID,
  DEFAULT_PROFILE_ID,
  legacyCardToNote,
  normalizeCardMetadata
} from './defaults.js';
import { findEmptyGeneratedCards, generateCardsForNote } from './templates.js';
import { searchCards } from './search.js';
import { nowIso, uid } from '../utils/core.js';

const HOUR_MS = 3_600_000;
const REVIEW_UNDO_WINDOW_MS = 30_000;

export async function initializeAnkiCollection(): Promise<{ migratedCards: number; notesAdded: number }> {
  const state = await getAnkiState();
  const cards = await getCards(true, true);
  let migratedCards = 0;
  let notesAdded = 0;
  const notes = [...state.notes];
  const noteIds = new Set(notes.map((note) => note.id));
  const updates: StudyCard[] = [];

  for (const card of cards) {
    const normalized = normalizeCardMetadata(card);
    if (JSON.stringify(card) !== JSON.stringify(normalized)) {
      updates.push(normalized);
      migratedCards += 1;
    }
    const noteId = normalized.noteId ?? `legacy_note_${normalized.id}`;
    if (!noteIds.has(noteId)) {
      notes.push(legacyCardToNote(normalized));
      noteIds.add(noteId);
      notesAdded += 1;
    }
  }
  if (updates.length) await saveCards(updates);
  if (notesAdded) await saveAnkiState({ ...state, notes });
  await maybeCreateAutomaticBackup();
  return { migratedCards, notesAdded };
}

export function activeProfileCards(cards: StudyCard[], state: AnkiState): StudyCard[] {
  return cards.filter((card) => (card.profileId ?? DEFAULT_PROFILE_ID) === state.activeProfileId);
}

export function cardsInDeck(cards: StudyCard[], state: AnkiState, deckId: string, includeChildren = true): StudyCard[] {
  const deck = state.decks.find((item) => item.id === deckId);
  if (!deck) return [];
  const allowed = new Set([deck.id]);
  if (includeChildren) {
    for (const candidate of state.decks) {
      if (candidate.profileId === deck.profileId && candidate.name.startsWith(`${deck.name}::`)) allowed.add(candidate.id);
    }
  }
  return cards.filter((card) => (card.profileId ?? DEFAULT_PROFILE_ID) === deck.profileId && allowed.has(card.deckId ?? DEFAULT_DECK_ID));
}

export function presetForCard(card: StudyCard, state: AnkiState) {
  const deck = state.decks.find((item) => item.id === (card.deckId ?? DEFAULT_DECK_ID));
  const preset = state.presets.find((item) => item.id === (deck?.presetId ?? DEFAULT_PRESET_ID));
  return preset ?? state.presets[0];
}

export async function createNote(note: Omit<StudyNote, 'id' | 'guid' | 'createdAt' | 'updatedAt' | 'deletedAt'>): Promise<StudyCard[]> {
  const state = await getAnkiState();
  const timestamp = nowIso();
  const full: StudyNote = {
    ...note,
    id: uid('note'),
    guid: uid('guid'),
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null
  };
  const nextState = { ...state, notes: [...state.notes, full] };
  let cards = generateCardsForNote(full, nextState);
  const requestedRaw = full.fields.__CardNumber?.trim() ?? '';
  if (requestedRaw) {
    if (!/^\d+$/u.test(requestedRaw) || Number(requestedRaw) < 1) throw new Error('カード番号が不正です。');
    const requested = Number(requestedRaw);
    const existingCards = await getCards(false, true);
    const used = new Set(existingCards
      .filter((card) => !card.deletedAt && (card.profileId ?? DEFAULT_PROFILE_ID) === full.profileId)
      .map((card) => /^\d+$/u.test((card.cardNumber ?? '').trim()) ? Number(card.cardNumber) : null)
      .filter((value): value is number => value !== null && value > 0));
    if (used.has(requested)) throw new Error('カード番号 ' + requested + ' は使用済みです。別の番号を選んでください。');
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
  return cards;
}

export async function regenerateNote(noteId: string): Promise<StudyCard[]> {
  const state = await getAnkiState();
  const note = state.notes.find((item) => item.id === noteId);
  if (!note) throw new Error('ノートが見つかりません。');
  const existing = (await getCards(true, true)).filter((card) => card.noteId === noteId);
  const generated = generateCardsForNote(note, state, existing);
  const generatedKeys = new Set(generated.map((card) => card.templateId));
  const timestamp = nowIso();
  const removed = existing
    .filter((card) => !generatedKeys.has(card.templateId))
    .map((card) => ({ ...card, deletedAt: timestamp, updatedAt: timestamp, version: card.version + 1 }));
  await saveCards([...generated, ...removed]);
  return generated;
}

export async function updateNote(note: StudyNote): Promise<void> {
  const state = await getAnkiState();
  const next = { ...note, updatedAt: nowIso() };
  await saveAnkiState({ ...state, notes: state.notes.map((item) => item.id === note.id ? next : item) });
  await regenerateNote(note.id);
}

export async function createDeck(name: string, parentId?: string): Promise<DeckDefinition> {
  const state = await getAnkiState();
  const trimmed = name.trim();
  if (!trimmed) throw new Error('デッキ名を入力してください。');
  const parent = parentId ? state.decks.find((item) => item.id === parentId && item.profileId === state.activeProfileId) : undefined;
  const fullName = parent && !trimmed.includes('::') ? `${parent.name}::${trimmed}` : trimmed;
  if (state.decks.some((item) => item.profileId === state.activeProfileId && item.name.toLowerCase() === fullName.toLowerCase())) {
    throw new Error('同名のデッキがあります。');
  }
  const timestamp = nowIso();
  const deck: DeckDefinition = {
    id: uid('deck'),
    profileId: state.activeProfileId,
    name: fullName,
    description: '',
    presetId: DEFAULT_PRESET_ID,
    createdAt: timestamp,
    updatedAt: timestamp
  };
  await saveAnkiState({ ...state, decks: [...state.decks, deck] });
  return deck;
}

export async function renameDeck(deckId: string, name: string): Promise<void> {
  const state = await getAnkiState();
  const deck = state.decks.find((item) => item.id === deckId && item.profileId === state.activeProfileId);
  if (!deck) throw new Error('デッキが見つかりません。');
  const trimmed = name.trim();
  if (!trimmed) throw new Error('デッキ名を入力してください。');
  if (state.decks.some((item) => item.profileId === deck.profileId && item.id !== deck.id && item.name.toLowerCase() === trimmed.toLowerCase())) throw new Error('同名のデッキがあります。');
  const oldPrefix = `${deck.name}::`;
  const timestamp = nowIso();
  await saveAnkiState({
    ...state,
    decks: state.decks.map((item) => {
      if (item.profileId !== deck.profileId) return item;
      if (item.id === deck.id) return { ...item, name: trimmed, updatedAt: timestamp };
      if (item.name.startsWith(oldPrefix)) return { ...item, name: `${trimmed}::${item.name.slice(oldPrefix.length)}`, updatedAt: timestamp };
      return item;
    })
  });
}

export async function deleteDeck(deckId: string): Promise<void> {
  const state = await getAnkiState();
  const deck = state.decks.find((item) => item.id === deckId && item.profileId === state.activeProfileId);
  if (!deck) return;
  if (deck.name === 'Default') throw new Error('各プロファイルのDefaultデッキは削除できません。');
  const fallback = state.decks.find((item) => item.profileId === deck.profileId && item.name === 'Default');
  if (!fallback) throw new Error('退避先のDefaultデッキが見つかりません。');
  const ids = new Set(state.decks
    .filter((item) => item.profileId === deck.profileId && (item.id === deckId || item.name.startsWith(`${deck.name}::`)))
    .map((item) => item.id));
  const cards = await getCards(true, true);
  await saveCards(cards
    .filter((card) => (card.profileId ?? DEFAULT_PROFILE_ID) === deck.profileId && ids.has(card.deckId ?? DEFAULT_DECK_ID))
    .map((card) => ({ ...card, deckId: fallback.id, updatedAt: nowIso(), version: card.version + 1 })));
  const notes = state.notes.map((note) => note.profileId === deck.profileId && ids.has(note.deckId) ? { ...note, deckId: fallback.id, updatedAt: nowIso() } : note);
  await saveAnkiState({ ...state, decks: state.decks.filter((item) => item.profileId !== deck.profileId || !ids.has(item.id)), notes });
}

export async function createFilteredDeck(name: string, search: string, limit: number, reschedule: boolean): Promise<FilteredDeckDefinition> {
  const state = await getAnkiState();
  const timestamp = nowIso();
  const filtered: FilteredDeckDefinition = {
    id: uid('filtered'), profileId: state.activeProfileId, name: name.trim() || 'Filtered Deck', search: search.trim(),
    limit: Math.max(1, Math.min(9999, Math.round(limit || 100))), order: 'due', reschedule, createdAt: timestamp, updatedAt: timestamp
  };
  await saveAnkiState({ ...state, filteredDecks: [...state.filteredDecks, filtered] });
  return filtered;
}

export async function cardsForFilteredDeck(id: string): Promise<StudyCard[]> {
  const [state, cards, history] = await Promise.all([getAnkiState(), getCards(), getHistory()]);
  const filtered = state.filteredDecks.find((item) => item.id === id && item.profileId === state.activeProfileId);
  if (!filtered) return [];
  const result = searchCards(activeProfileCards(cards, state), state, history, filtered.search).slice(0, filtered.limit);
  return result.map((card) => ({ ...card, originalDeckId: card.originalDeckId ?? card.deckId, filteredDeckId: filtered.id }));
}

export function unburyExpired(card: StudyCard, now = new Date()): StudyCard {
  if (card.buriedUntil && new Date(card.buriedUntil).getTime() <= now.getTime()) return { ...card, buriedUntil: null };
  return card;
}

export async function unburyAll(): Promise<number> {
  const cards = await getCards(true);
  const buried = cards.filter((card) => card.buriedUntil);
  await saveCards(buried.map((card) => ({ ...card, buriedUntil: null, updatedAt: nowIso(), version: card.version + 1 })));
  return buried.length;
}

export async function resetCards(ids: string[]): Promise<void> {
  const set = new Set(ids);
  const cards = await getCards(true);
  const now = new Date();
  await saveCards(cards.filter((card) => set.has(card.id)).map((card, index) => ({
    ...card,
    schedule: initialSchedule(now),
    queue: 'new' as const,
    position: Date.now() + index,
    updatedAt: now.toISOString(),
    version: card.version + 1,
    suspended: false,
    buriedUntil: null
  })));
}

export async function setDueDate(ids: string[], daysFromNow: number): Promise<void> {
  const set = new Set(ids);
  const cards = await getCards(true);
  const due = new Date(Date.now() + daysFromNow * 86_400_000).toISOString();
  await saveCards(cards.filter((card) => set.has(card.id)).map((card) => ({
    ...card, schedule: { ...card.schedule, due }, queue: 'review' as const, updatedAt: nowIso(), version: card.version + 1
  })));
}

export async function pushUndo(label: string, cards: StudyCard[]): Promise<void> {
  const state = await getAnkiState();
  const profileId = state.activeProfileId;
  const allCards = await getCards(true);
  const snapshot = new Map(cards.map((card) => [card.id, structuredClone(card)]));
  for (const card of cards) {
    if (!card.siblingGroup) continue;
    for (const sibling of allCards) {
      if (sibling.siblingGroup === card.siblingGroup) snapshot.set(sibling.id, structuredClone(sibling));
    }
  }
  const noteIds = new Set([...snapshot.values()].map((card) => card.noteId).filter((id): id is string => Boolean(id)));
  const notes = state.notes.filter((note) => note.profileId === profileId && noteIds.has(note.id)).map((note) => structuredClone(note));
  const entry = { id: uid('undo'), label, createdAt: nowIso(), profileId, cards: [...snapshot.values()], notes };
  await saveAnkiState({ ...state, undo: [...state.undo, entry].slice(-20) });
}

export async function undoLast(): Promise<string | null> {
  const state = await getAnkiState();
  let index = -1;
  for (let i = state.undo.length - 1; i >= 0; i -= 1) {
    if (!state.undo[i]?.profileId || state.undo[i]?.profileId === state.activeProfileId) { index = i; break; }
  }
  if (index < 0) return null;
  const entry = state.undo[index]!;
  const profileId = entry.profileId ?? state.activeProfileId;
  if (entry.label === '復習' || entry.label === '模擬テスト') {
    const cardIds = new Set(entry.cards.map((card) => card.id));
    const createdAt = new Date(entry.createdAt).getTime();
    const history = (await getHistory(true))
      .filter((item) => cardIds.has(item.cardId) && (item.profileId ?? profileId) === profileId)
      .filter((item) => Math.abs(new Date(item.reviewedAt).getTime() - createdAt) <= REVIEW_UNDO_WINDOW_MS)
      .sort((a, b) => b.reviewedAt.localeCompare(a.reviewedAt));
    const removedCards = new Set<string>();
    for (const item of history) {
      if (removedCards.has(item.cardId)) continue;
      removedCards.add(item.cardId);
      await deleteHistory(item.id);
    }
  }
  await saveCards(entry.cards);
  const latest = await getAnkiState();
  const noteSnapshots = new Map((entry.notes ?? []).map((note) => [note.id, note]));
  const notes = latest.notes.map((note) => noteSnapshots.get(note.id) ?? note);
  await saveAnkiState({ ...latest, notes, undo: latest.undo.filter((item) => item.id !== entry.id) });
  return entry.label;
}

export async function createSnapshot(reason: CollectionSnapshot['reason'], label: string): Promise<CollectionSnapshot> {
  const [cards, history, anki] = await Promise.all([getCards(true, true), getHistory(true), getAnkiState()]);
  const snapshot: CollectionSnapshot = { id: uid('snapshot'), createdAt: nowIso(), reason, label, cards, history, anki };
  await saveSnapshot(snapshot);
  await pruneSnapshots(50);
  return snapshot;
}

export async function maybeCreateAutomaticBackup(): Promise<void> {
  const state = await getAnkiState();
  const last = new Date(state.lastAutomaticBackupAt).getTime();
  if (Number.isFinite(last) && Date.now() - last < HOUR_MS) return;
  await createSnapshot('automatic', 'Automatic backup');
  await saveAnkiState({ ...state, lastAutomaticBackupAt: nowIso() });
}

export async function restoreSnapshot(id: string): Promise<void> {
  const snapshot = (await getSnapshots()).find((item) => item.id === id);
  if (!snapshot) throw new Error('バックアップが見つかりません。');
  await replaceCollection(snapshot.cards, snapshot.history, snapshot.anki);
}

export async function removeSnapshot(id: string): Promise<void> {
  await deleteSnapshot(id);
}

export async function checkCollection(): Promise<string[]> {
  const [state, cards] = await Promise.all([getAnkiState(), getCards(true, true)]);
  const errors: string[] = [];
  const cardIds = new Set<string>();
  const noteIds = new Set(state.notes.map((note) => note.id));
  const deckById = new Map(state.decks.map((deck) => [deck.id, deck]));
  const typeIds = new Set(state.noteTypes.map((type) => type.id));
  for (const card of cards) {
    if (cardIds.has(card.id)) errors.push(`重複カードID: ${card.id}`);
    cardIds.add(card.id);
    if (card.noteId && !noteIds.has(card.noteId)) errors.push(`カード ${card.id}: ノート ${card.noteId} がありません`);
    if (card.deckId && !deckById.has(card.deckId)) errors.push(`カード ${card.id}: デッキ ${card.deckId} がありません`);
    const deck = card.deckId ? deckById.get(card.deckId) : undefined;
    if (deck && deck.profileId !== (card.profileId ?? DEFAULT_PROFILE_ID)) errors.push(`カード ${card.id}: 別プロファイルのデッキを参照しています`);
    if (card.noteTypeId && !typeIds.has(card.noteTypeId)) errors.push(`カード ${card.id}: ノートタイプ ${card.noteTypeId} がありません`);
    if (Number.isNaN(new Date(card.schedule.due).getTime())) errors.push(`カード ${card.id}: 復習日時が不正です`);
  }
  return errors;
}

export async function deleteEmptyCards(): Promise<number> {
  const [state, cards] = await Promise.all([getAnkiState(), getCards(true, true)]);
  const empty = state.notes.flatMap((note) => findEmptyGeneratedCards(note, state, cards));
  const now = nowIso();
  await saveCards(empty.map((card) => ({ ...card, deletedAt: now, updatedAt: now, version: card.version + 1 })));
  return empty.length;
}

export async function exportCollectionPackage(): Promise<string> {
  const [state, cards, history] = await Promise.all([getAnkiState(), getCards(true, true), getHistory(true)]);
  return JSON.stringify({ format: 'work-1-anki-collection', version: 1, exportedAt: nowIso(), anki: state, cards, history }, null, 2);
}

export async function importCollectionPackage(text: string): Promise<{ cards: number; notes: number }> {
  const parsed = JSON.parse(text) as { format?: string; version?: number; anki?: AnkiState; cards?: StudyCard[]; history?: any[] };
  if (parsed.format !== 'work-1-anki-collection' || parsed.version !== 1 || !parsed.anki || !Array.isArray(parsed.cards) || !Array.isArray(parsed.history)) {
    throw new Error('対応するコレクションファイルではありません。');
  }
  await replaceCollection(parsed.cards, parsed.history, parsed.anki);
  return { cards: parsed.cards.length, notes: parsed.anki.notes.length };
}

function parseDelimitedLine(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let current = '';
  let quote = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quote && line[i + 1] === '"') { current += '"'; i += 1; }
      else quote = !quote;
    } else if (char === delimiter && !quote) { fields.push(current); current = ''; }
    else current += char;
  }
  fields.push(current);
  return fields;
}

export async function importTextCards(text: string, deckId = DEFAULT_DECK_ID, noteTypeId = BASIC_NOTE_TYPE_ID): Promise<number> {
  const state = await getAnkiState();
  const delimiter = text.includes('\t') ? '\t' : ',';
  const rows = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim()).map((line) => parseDelimitedLine(line, delimiter));
  let count = 0;
  const nextState = { ...state, notes: [...state.notes] };
  const generated: StudyCard[] = [];
  for (const row of rows) {
    const front = row[0]?.trim() ?? '';
    const back = row[1]?.trim() ?? '';
    if (!front || !back) continue;
    const timestamp = nowIso();
    const note: StudyNote = {
      id: uid('note'), guid: uid('guid'), profileId: state.activeProfileId, deckId, noteTypeId,
      fields: { Front: front, Back: back, Extra: row[2] ?? '' }, tags: (row[3] ?? '').split(/[ ,]+/).filter(Boolean),
      createdAt: timestamp, updatedAt: timestamp, deletedAt: null
    };
    nextState.notes.push(note);
    generated.push(...generateCardsForNote(note, nextState));
    count += 1;
  }
  await saveAnkiState(nextState);
  await saveCards(generated);
  return count;
}

export function cloneNoteType(source: NoteTypeDefinition, name: string): NoteTypeDefinition {
  const timestamp = nowIso();
  const id = uid('notetype');
  return {
    ...source,
    id,
    name: name.trim() || `${source.name} copy`,
    builtin: false,
    fields: source.fields.map((field) => ({ ...field, id: uid('field') })),
    templates: source.templates.map((template) => ({ ...template, id: uid('template') })),
    createdAt: timestamp,
    updatedAt: timestamp
  };
}