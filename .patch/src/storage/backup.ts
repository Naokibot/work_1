import type { ReviewHistory, StudyCard } from '../types.js';
import { getCards, getHistory, replaceAllData } from './db.js';
import { csvEscape, downloadText, nowIso } from '../utils/core.js';

interface BackupPayload {
  format: 'work-1-backup';
  version: 1;
  exportedAt: string;
  cards: StudyCard[];
  history: ReviewHistory[];
}

export async function exportJson(): Promise<void> {
  const payload: BackupPayload = {
    format: 'work-1-backup',
    version: 1,
    exportedAt: nowIso(),
    cards: await getCards(true),
    history: await getHistory()
  };
  downloadText(`work-1-backup-${payload.exportedAt.slice(0, 10)}.json`, JSON.stringify(payload, null, 2), 'application/json');
}

export async function exportCsv(): Promise<void> {
  const header = ['ID', 'CardNumber', 'Question', 'Answer', 'Distractor1', 'Distractor2', 'Distractor3', 'Explanation', 'Tags', 'Favorite', 'CreatedAt', 'UpdatedAt'];
  const rows = (await getCards()).map((card) => [
    card.id,
    card.cardNumber ?? '',
    card.question,
    card.answer,
    card.distractors[0] ?? '',
    card.distractors[1] ?? '',
    card.distractors[2] ?? '',
    card.explanation,
    card.tags.join(','),
    card.favorite,
    card.createdAt,
    card.updatedAt
  ]);
  const csv = [header, ...rows].map((row) => row.map(csvEscape).join(',')).join('\r\n');
  downloadText(`work-1-cards-${nowIso().slice(0, 10)}.csv`, `\uFEFF${csv}`, 'text/csv;charset=utf-8');
}

function isCard(value: unknown): value is StudyCard {
  if (!value || typeof value !== 'object') return false;
  const card = value as Partial<StudyCard>;
  return typeof card.id === 'string' && typeof card.question === 'string' && typeof card.answer === 'string' && Array.isArray(card.tags) && !!card.schedule && !!card.stats;
}

function isHistory(value: unknown): value is ReviewHistory {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<ReviewHistory>;
  return typeof item.id === 'string' && typeof item.cardId === 'string' && typeof item.reviewedAt === 'string' && typeof item.isCorrect === 'boolean';
}

export async function importJson(file: File): Promise<{ cards: number; history: number }> {
  if (file.size > 25 * 1024 * 1024) throw new Error('バックアップファイルが大きすぎます。');
  const parsed = JSON.parse(await file.text()) as Partial<BackupPayload>;
  if (parsed.format !== 'work-1-backup' || parsed.version !== 1 || !Array.isArray(parsed.cards) || !Array.isArray(parsed.history)) {
    throw new Error('このアプリのバックアップ形式ではありません。');
  }
  if (!parsed.cards.every(isCard) || !parsed.history.every(isHistory)) throw new Error('バックアップデータの検証に失敗しました。');
  await replaceAllData(parsed.cards, parsed.history);
  return { cards: parsed.cards.length, history: parsed.history.length };
}
