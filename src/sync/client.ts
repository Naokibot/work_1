import type { AppSettings, ReviewHistory, StudyCard, SyncQueueItem } from '../types.js';
import { deleteQueueItem, getCard, getQueue, getSettings, saveCard, saveConflict, saveHistory, saveQueueItem, saveSettings } from '../storage/db.js';
import { canonicalRequest, encodePayload, signRequest } from './crypto.js';
import { nowIso, uid } from '../utils/core.js';

interface PullResult {
  ok: boolean;
  serverTime: string;
  cards: StudyCard[];
  history: ReviewHistory[];
  syncResults: Array<{ requestId: string; action: string; outcome: string; cardId: string; message: string }>;
  error?: string;
}

export interface SyncReport {
  pushed: number;
  pulledCards: number;
  pulledHistory: number;
  conflicts: number;
  pending: number;
}

export function isAllowedGasUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname === 'script.google.com' && /^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/u.test(parsed.pathname);
  } catch {
    return false;
  }
}

async function signedEnvelope(settings: AppSettings, item: SyncQueueItem): Promise<Record<string, unknown>> {
  const timestamp = nowIso();
  const nonce = uid('nonce');
  const canonical = canonicalRequest(item.action, timestamp, nonce, item.requestId, item.payload);
  const signature = await signRequest(settings.syncSecret, canonical);
  return { action: item.action, timestamp, nonce, requestId: item.requestId, payload: item.payload, signature };
}

async function postOpaque(settings: AppSettings, item: SyncQueueItem): Promise<void> {
  const envelope = await signedEnvelope(settings, item);
  const response = await fetch(settings.gasUrl, {
    method: 'POST',
    mode: 'no-cors',
    cache: 'no-store',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    body: JSON.stringify(envelope)
  });
  if (response.type !== 'opaque' && !response.ok) throw new Error(`Sync POST failed: ${response.status}`);
}

function jsonp<T>(url: URL): Promise<T> {
  return new Promise((resolve, reject) => {
    const callback = `__work1_${crypto.randomUUID().replaceAll('-', '_')}`;
    const script = document.createElement('script');
    const timer = window.setTimeout(() => finish(new Error('Sync pull timed out')), 15000);
    const finish = (error?: Error, value?: T) => {
      window.clearTimeout(timer);
      script.remove();
      delete (window as unknown as Record<string, unknown>)[callback];
      if (error) reject(error);
      else resolve(value as T);
    };
    (window as unknown as Record<string, unknown>)[callback] = (value: T) => finish(undefined, value);
    script.onerror = () => finish(new Error('Sync pull could not load Apps Script response'));
    url.searchParams.set('callback', callback);
    script.src = url.toString();
    script.referrerPolicy = 'no-referrer';
    document.head.append(script);
  });
}

async function pull(settings: AppSettings): Promise<PullResult> {
  const action = 'pull';
  const requestId = uid('pull');
  const timestamp = nowIso();
  const nonce = uid('nonce');
  const payload = { since: settings.lastSyncAt };
  const canonical = canonicalRequest(action, timestamp, nonce, requestId, payload);
  const signature = await signRequest(settings.syncSecret, canonical);
  const url = new URL(settings.gasUrl);
  url.searchParams.set('action', action);
  url.searchParams.set('timestamp', timestamp);
  url.searchParams.set('nonce', nonce);
  url.searchParams.set('requestId', requestId);
  url.searchParams.set('payload', encodePayload(payload));
  url.searchParams.set('signature', signature);
  const result = await jsonp<PullResult>(url);
  if (!result.ok) throw new Error(result.error || 'Apps Script pull failed');
  return result;
}

async function preserveConflict(queueItem: SyncQueueItem, message: string): Promise<void> {
  const payloadCard = queueItem.payload.card as StudyCard | undefined;
  if (!payloadCard) return;
  await saveConflict({
    id: uid('conflict'),
    requestId: queueItem.requestId,
    cardId: payloadCard.id,
    createdAt: nowIso(),
    message
  });
  const copyRequestId = uid('req');
  const timestamp = nowIso();
  const copy: StudyCard = {
    ...payloadCard,
    id: uid('card'),
    question: `${payloadCard.question}（競合コピー）`,
    tags: [...new Set([...payloadCard.tags, 'sync-conflict'])],
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
    version: payloadCard.version + 1,
    lastRequestId: copyRequestId
  };
  await saveCard(copy);
  await saveQueueItem({ requestId: copyRequestId, action: 'upsertCard', payload: { card: copy }, createdAt: timestamp, attempts: 0 });
}

async function applyPull(result: PullResult, queueBeforePull: SyncQueueItem[]): Promise<number> {
  const queueById = new Map(queueBeforePull.map((item) => [item.requestId, item]));
  let conflicts = 0;
  for (const syncResult of result.syncResults) {
    const queued = queueById.get(syncResult.requestId);
    if (!queued) continue;
    if (syncResult.outcome === 'conflict') {
      await preserveConflict(queued, syncResult.message || 'Remote card was newer.');
      conflicts += 1;
    }
    await deleteQueueItem(syncResult.requestId);
  }

  for (const remote of result.cards) {
    const local = await getCard(remote.id);
    if (!local || remote.updatedAt >= local.updatedAt || remote.deletedAt) await saveCard(remote);
  }
  for (const item of result.history) await saveHistory(item);
  return conflicts;
}

export async function syncNow(onStatus?: (message: string) => void): Promise<SyncReport> {
  if (!navigator.onLine) throw new Error('オフラインです。記録は端末内に保存されています。');
  const settings = await getSettings();
  if (!isAllowedGasUrl(settings.gasUrl) || settings.syncSecret.length < 16) {
    throw new Error('設定画面でApps Script URLと16文字以上の同期シークレットを設定してください。');
  }

  const queue = (await getQueue()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  let pushed = 0;
  for (const item of queue) {
    onStatus?.(`未同期データを送信中 ${pushed + 1}/${queue.length}`);
    const next = { ...item, attempts: item.attempts + 1 };
    await saveQueueItem(next);
    await postOpaque(settings, next);
    pushed += 1;
  }

  onStatus?.('Google Sheetsから更新を確認中');
  const result = await pull(settings);
  const conflicts = await applyPull(result, await getQueue());
  await saveSettings({ ...settings, lastSyncAt: result.serverTime });
  const pending = (await getQueue()).length;
  return { pushed, pulledCards: result.cards.length, pulledHistory: result.history.length, conflicts, pending };
}
