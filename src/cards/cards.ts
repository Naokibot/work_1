import type { StudyCard, SyncQueueItem } from '../types.js';
import { initialSchedule } from '../scheduler/scheduler.js';
import { nowIso, normalizeTags, uid } from '../utils/core.js';
import { saveCard, saveQueueItem } from '../storage/db.js';

export interface CardDraft {
  question: string;
  answer: string;
  distractors: string[];
  explanation: string;
  tagsText: string;
  favorite: boolean;
}

export function createCard(draft: CardDraft, now = new Date()): StudyCard {
  const timestamp = now.toISOString();
  return {
    id: uid('card'),
    question: draft.question.trim(),
    answer: draft.answer.trim(),
    distractors: draft.distractors.map((value) => value.trim()).filter(Boolean).slice(0, 3),
    explanation: draft.explanation.trim(),
    tags: normalizeTags(draft.tagsText),
    favorite: draft.favorite,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
    schedule: initialSchedule(now),
    stats: { correct: 0, incorrect: 0, totalTimeMs: 0, fastestMs: null, lastTimesMs: [] },
    version: 1
  };
}

export function validateCardDraft(draft: CardDraft): string[] {
  const errors: string[] = [];
  if (!draft.question.trim()) errors.push('問題文を入力してください。');
  if (!draft.answer.trim()) errors.push('正解を入力してください。');
  if (draft.question.length > 5000) errors.push('問題文は5000文字以内にしてください。');
  if (draft.answer.length > 5000) errors.push('正解は5000文字以内にしてください。');
  if (draft.explanation.length > 10000) errors.push('解説は10000文字以内にしてください。');
  if (draft.distractors.some((value) => value.length > 5000)) errors.push('誤答は5000文字以内にしてください。');
  return errors;
}

export async function persistCard(card: StudyCard, action: 'upsertCard' | 'deleteCard' = 'upsertCard'): Promise<void> {
  const requestId = uid('req');
  const next = { ...card, lastRequestId: requestId };
  await saveCard(next);
  const queue: SyncQueueItem = {
    requestId,
    action,
    payload: { card: next },
    createdAt: nowIso(),
    attempts: 0
  };
  await saveQueueItem(queue);
}
