import type { ReviewHistory, StudyCard } from '../types.js';

export interface SummaryStats {
  studied: number;
  correct: number;
  incorrect: number;
  accuracy: number;
  totalMs: number;
}

function localDayKey(iso: string): string {
  const date = new Date(iso);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function summarize(history: ReviewHistory[], days: number, now = new Date()): SummaryStats {
  const cutoff = new Date(now);
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - Math.max(0, days - 1));
  const items = history.filter((item) => new Date(item.reviewedAt) >= cutoff);
  const correct = items.filter((item) => item.isCorrect).length;
  const incorrect = items.length - correct;
  return {
    studied: items.length,
    correct,
    incorrect,
    accuracy: items.length ? correct / items.length : 0,
    totalMs: items.reduce((sum, item) => sum + item.responseMs, 0)
  };
}

export function dailyCounts(history: ReviewHistory[], days = 7, now = new Date()): Array<{ day: string; count: number; accuracy: number }> {
  const output: Array<{ day: string; count: number; accuracy: number }> = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(now);
    date.setDate(date.getDate() - offset);
    const key = localDayKey(date.toISOString());
    const items = history.filter((item) => localDayKey(item.reviewedAt) === key);
    const correct = items.filter((item) => item.isCorrect).length;
    output.push({ day: key.slice(5), count: items.length, accuracy: items.length ? correct / items.length : 0 });
  }
  return output;
}

export function tagAccuracy(cards: StudyCard[]): Array<{ tag: string; accuracy: number; attempts: number }> {
  const aggregates = new Map<string, { correct: number; total: number }>();
  for (const card of cards) {
    const total = card.stats.correct + card.stats.incorrect;
    for (const tag of card.tags) {
      const current = aggregates.get(tag) ?? { correct: 0, total: 0 };
      current.correct += card.stats.correct;
      current.total += total;
      aggregates.set(tag, current);
    }
  }
  return [...aggregates.entries()]
    .map(([tag, value]) => ({ tag, attempts: value.total, accuracy: value.total ? value.correct / value.total : 0 }))
    .sort((a, b) => b.attempts - a.attempts || a.tag.localeCompare(b.tag));
}
