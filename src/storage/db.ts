import type { AppSettings, ReviewHistory, ReviewSession, StudyCard, SyncConflict, SyncQueueItem } from '../types.js';

const DB_NAME = 'work_1_study_cards';
const DB_VERSION = 1;

type StoreName = 'cards' | 'history' | 'queue' | 'settings' | 'sessions' | 'conflicts';

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
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open IndexedDB'));
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

export async function getCards(includeDeleted = false): Promise<StudyCard[]> {
  const cards = await getAll<StudyCard>('cards');
  return includeDeleted ? cards : cards.filter((card) => !card.deletedAt);
}

export function getCard(id: string): Promise<StudyCard | undefined> {
  return getOne<StudyCard>('cards', id);
}

export function saveCard(card: StudyCard): Promise<void> {
  return putOne('cards', card);
}

export function getHistory(): Promise<ReviewHistory[]> {
  return getAll('history');
}

export function saveHistory(history: ReviewHistory): Promise<void> {
  return putOne('history', history);
}

export function deleteHistory(id: string): Promise<void> {
  return deleteOne('history', id);
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
  idleTimeoutSeconds: 600
};

export async function getSettings(): Promise<AppSettings> {
  const stored = await getOne<AppSettings>('settings', 'app');
  return { ...DEFAULT_SETTINGS, ...stored };
}

export function saveSettings(settings: AppSettings): Promise<void> {
  return putOne('settings', settings);
}

export function getCurrentSession(): Promise<ReviewSession | undefined> {
  return getOne<ReviewSession>('sessions', 'current');
}

export function saveCurrentSession(session: ReviewSession): Promise<void> {
  return putOne('sessions', session);
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

export async function replaceAllData(cards: StudyCard[], history: ReviewHistory[]): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(['cards', 'history'], 'readwrite');
  const cardStore = transaction.objectStore('cards');
  const historyStore = transaction.objectStore('history');
  cardStore.clear();
  historyStore.clear();
  cards.forEach((card) => cardStore.put(card));
  history.forEach((item) => historyStore.put(item));
  await transactionDone(transaction);
}
