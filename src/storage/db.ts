import type {
  AnkiState,
  AppSettings,
  CollectionSnapshot,
  ReviewHistory,
  ReviewSession,
  StudyCard,
  SyncConflict,
  SyncQueueItem
} from '../types.js';
import { normalizeAnkiState } from '../anki/defaults.js';
import { nowIso, uid } from '../utils/core.js';

const DB_NAME = 'work_1_study_cards';
const DB_VERSION = 2;
const DEFAULT_PROFILE_ID = 'profile_default';

type StoreName = 'cards' | 'history' | 'queue' | 'settings' | 'sessions' | 'conflicts' | 'anki' | 'snapshots';

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('cards')) db.createObjectStore('cards', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('history')) db.createObjectStore('history', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue', { keyPath: 'requestId' });
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('conflicts')) db.createObjectStore('conflicts', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('anki')) db.createObjectStore('anki', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('snapshots')) db.createObjectStore('snapshots', { keyPath: 'id' });
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => {
      dbPromise = null;
      reject(request.error ?? new Error('Could not open IndexedDB'));
    };
    request.onblocked = () => {
      dbPromise = null;
      reject(new Error('IndexedDB upgrade is blocked by another open tab. Close the other tab and reload.'));
    };
  });
  return dbPromise;
}

async function getAll<T>(storeName: StoreName): Promise<T[]> {
  const db = await openDatabase();
  const transaction = db.transaction(storeName, 'readonly');
  return requestToPromise(transaction.objectStore(storeName).getAll()) as Promise<T[]>;
}

async function getOne<T>(storeName: StoreName, key: IDBValidKey): Promise<T | undefined> {
  const db = await openDatabase();
  const transaction = db.transaction(storeName, 'readonly');
  return requestToPromise(transaction.objectStore(storeName).get(key)) as Promise<T | undefined>;
}

async function putOne<T>(storeName: StoreName, value: T): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(storeName, 'readwrite');
  transaction.objectStore(storeName).put(value);
  await transactionDone(transaction);
}

async function deleteOne(storeName: StoreName, key: IDBValidKey): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(storeName, 'readwrite');
  transaction.objectStore(storeName).delete(key);
  await transactionDone(transaction);
}

function cardQueueItem(card: StudyCard, requestId: string): SyncQueueItem {
  return {
    requestId,
    action: card.deletedAt ? 'deleteCard' : 'upsertCard',
    payload: { card },
    createdAt: nowIso(),
    attempts: 0
  };
}

export async function getCards(includeDeleted = false, allProfiles = false): Promise<StudyCard[]> {
  let cards = await getAll<StudyCard>('cards');
  if (!allProfiles) {
    const state = await getAnkiState();
    cards = cards.filter((card) => (card.profileId ?? DEFAULT_PROFILE_ID) === state.activeProfileId);
  }
  return includeDeleted ? cards : cards.filter((card) => !card.deletedAt);
}

export async function getCard(id: string, allProfiles = false): Promise<StudyCard | undefined> {
  const card = await getOne<StudyCard>('cards', id);
  if (!card || allProfiles) return card;
  const state = await getAnkiState();
  return (card.profileId ?? DEFAULT_PROFILE_ID) === state.activeProfileId ? card : undefined;
}

export async function saveCard(card: StudyCard, enqueue = true): Promise<void> {
  if (!enqueue) return putOne('cards', card);
  const requestId = uid('req');
  const stored = { ...card, lastRequestId: requestId };
  const db = await openDatabase();
  const transaction = db.transaction(['cards', 'queue'], 'readwrite');
  transaction.objectStore('cards').put(stored);
  transaction.objectStore('queue').put(cardQueueItem(stored, requestId));
  await transactionDone(transaction);
}

export async function saveCards(cards: StudyCard[], enqueue = true): Promise<void> {
  if (!cards.length) return;
  const db = await openDatabase();
  const transaction = db.transaction(enqueue ? ['cards', 'queue'] : ['cards'], 'readwrite');
  const store = transaction.objectStore('cards');
  const queue = enqueue ? transaction.objectStore('queue') : null;
  for (const card of cards) {
    if (!queue) {
      store.put(card);
      continue;
    }
    const requestId = uid('req');
    const stored = { ...card, lastRequestId: requestId };
    store.put(stored);
    queue.put(cardQueueItem(stored, requestId));
  }
  await transactionDone(transaction);
}

export async function getHistory(allProfiles = false): Promise<ReviewHistory[]> {
  const history = await getAll<ReviewHistory>('history');
  if (allProfiles) return history;
  const [state, cards] = await Promise.all([getAnkiState(), getAll<StudyCard>('cards')]);
  const activeIds = new Set(cards
    .filter((card) => (card.profileId ?? DEFAULT_PROFILE_ID) === state.activeProfileId)
    .map((card) => card.id));
  return history.filter((item) => item.profileId ? item.profileId === state.activeProfileId : activeIds.has(item.cardId));
}

export async function saveHistory(history: ReviewHistory, enqueue = true): Promise<void> {
  const card = history.profileId ? undefined : await getCard(history.cardId, true);
  const state = history.profileId || card ? undefined : await getAnkiState();
  const requestId = enqueue ? uid('req') : history.requestId;
  const stored: ReviewHistory = {
    ...history,
    requestId,
    profileId: history.profileId ?? card?.profileId ?? state?.activeProfileId ?? DEFAULT_PROFILE_ID,
    source: history.source ?? 'scheduled'
  };
  if (!enqueue) return putOne('history', stored);
  const db = await openDatabase();
  const transaction = db.transaction(['history', 'queue'], 'readwrite');
  transaction.objectStore('history').put(stored);
  transaction.objectStore('queue').put({ requestId, action: 'appendHistory', payload: { history: stored }, createdAt: nowIso(), attempts: 0 });
  await transactionDone(transaction);
}

export async function deleteHistory(id: string, enqueue = true): Promise<void> {
  const db = await openDatabase();
  if (!enqueue) {
    const transaction = db.transaction('history', 'readwrite');
    transaction.objectStore('history').delete(id);
    await transactionDone(transaction);
    return;
  }
  const transaction = db.transaction(['history', 'queue'], 'readwrite');
  const historyStore = transaction.objectStore('history');
  const queueStore = transaction.objectStore('queue');
  const history = await requestToPromise(historyStore.get(id)) as ReviewHistory | undefined;
  const queued = await requestToPromise(queueStore.getAll()) as SyncQueueItem[];
  let pendingAppend = false;
  for (const item of queued) {
    const queuedHistory = item.action === 'appendHistory' ? item.payload.history as ReviewHistory | undefined : undefined;
    if (queuedHistory?.id === id) {
      queueStore.delete(item.requestId);
      pendingAppend = true;
    }
  }
  historyStore.delete(id);
  if (!pendingAppend) {
    const requestId = uid('req');
    queueStore.put({
      requestId,
      action: 'deleteHistory',
      payload: { historyId: id, profileId: history?.profileId ?? '' },
      createdAt: nowIso(),
      attempts: 0
    } satisfies SyncQueueItem);
  }
  await transactionDone(transaction);
}

export function getQueue(): Promise<SyncQueueItem[]> {
  return getAll('queue');
}

export function saveQueueItem(item: SyncQueueItem): Promise<void> {
  return putOne('queue', item);
}

export function deleteQueueItem(requestId: string): Promise<void> {
  return deleteOne('queue', requestId);
}

const DEFAULT_SETTINGS: AppSettings = {
  id: 'app',
  gasUrl: '',
  syncSecret: '',
  lastSyncAt: '1970-01-01T00:00:00.000Z',
  dailyNewLimit: 20,
  dailyReviewLimit: 200,
  idleTimeoutSeconds: 600,
  showRemainingCount: true,
  showNextReviewTime: true,
  spacebarAnswers: true,
  interruptAudioOnAnswer: true,
  autoSync: true
};

export async function getSettings(): Promise<AppSettings> {
  const stored = await getOne<AppSettings>('settings', 'app');
  return { ...DEFAULT_SETTINGS, ...stored };
}

export function saveSettings(settings: AppSettings): Promise<void> {
  return putOne('settings', settings);
}

export async function getAnkiState(): Promise<AnkiState> {
  const stored = await getOne<AnkiState>('anki', 'anki');
  const normalized = normalizeAnkiState(stored);
  if (!stored) await saveAnkiState(normalized);
  return normalized;
}

export function saveAnkiState(state: AnkiState): Promise<void> {
  return putOne('anki', normalizeAnkiState(state));
}

export async function getCurrentSession(): Promise<ReviewSession | undefined> {
  const session = await getOne<ReviewSession>('sessions', 'current');
  if (!session) return undefined;
  const state = await getAnkiState();
  if (!session.profileId || session.profileId !== state.activeProfileId) {
    await clearCurrentSession();
    return undefined;
  }
  return session;
}

export async function saveCurrentSession(session: ReviewSession): Promise<void> {
  const state = await getAnkiState();
  return putOne('sessions', { ...session, profileId: session.profileId ?? state.activeProfileId });
}

export function clearCurrentSession(): Promise<void> {
  return deleteOne('sessions', 'current');
}

export function saveConflict(conflict: SyncConflict): Promise<void> {
  return putOne('conflicts', conflict);
}

export function getConflicts(): Promise<SyncConflict[]> {
  return getAll('conflicts');
}

export function saveSnapshot(snapshot: CollectionSnapshot): Promise<void> {
  return putOne('snapshots', snapshot);
}

export async function getSnapshots(): Promise<CollectionSnapshot[]> {
  return (await getAll<CollectionSnapshot>('snapshots')).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function deleteSnapshot(id: string): Promise<void> {
  return deleteOne('snapshots', id);
}

export async function pruneSnapshots(maxCount = 50): Promise<void> {
  const snapshots = await getSnapshots();
  await Promise.all(snapshots.slice(maxCount).map((snapshot) => deleteSnapshot(snapshot.id)));
}

export async function replaceAllData(cards: StudyCard[], history: ReviewHistory[]): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(['cards', 'history', 'queue', 'sessions'], 'readwrite');
  const cardStore = transaction.objectStore('cards');
  const historyStore = transaction.objectStore('history');
  cardStore.clear();
  historyStore.clear();
  transaction.objectStore('queue').clear();
  transaction.objectStore('sessions').clear();
  cards.forEach((card) => cardStore.put(card));
  history.forEach((item) => historyStore.put(item));
  await transactionDone(transaction);
}

export async function replaceCollection(cards: StudyCard[], history: ReviewHistory[], anki: AnkiState): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(['cards', 'history', 'anki', 'queue', 'sessions'], 'readwrite');
  const cardStore = transaction.objectStore('cards');
  const historyStore = transaction.objectStore('history');
  const ankiStore = transaction.objectStore('anki');
  cardStore.clear();
  historyStore.clear();
  ankiStore.clear();
  transaction.objectStore('queue').clear();
  transaction.objectStore('sessions').clear();
  cards.forEach((card) => cardStore.put(card));
  history.forEach((item) => historyStore.put(item));
  ankiStore.put(normalizeAnkiState(anki));
  await transactionDone(transaction);
}