import type { ReviewHistory, ReviewMode, StudyCard } from '../types.js';
import { isDue } from '../scheduler/scheduler.js';
import { shuffle } from '../utils/core.js';

export interface SelectionOptions {
  mode: ReviewMode;
  tag?: string;
  examSize?: number;
  newLimit?: number;
  reviewLimit?: number;
  now?: Date;
}

export function latestHistoryByCard(history: ReviewHistory[]): Map<string, ReviewHistory> {
  const map = new Map<string, ReviewHistory>();
  for (const item of [...history].sort((a, b) => a.reviewedAt.localeCompare(b.reviewedAt))) map.set(item.cardId, item);
  return map;
}

export function selectCards(cards: StudyCard[], history: ReviewHistory[], options: SelectionOptions): StudyCard[] {
  const now = options.now ?? new Date();
  const active = cards.filter((card) => !card.deletedAt);
  const latest = latestHistoryByCard(history);
  let result: StudyCard[];

  switch (options.mode) {
    case 'new':
      result = active.filter((card) => card.schedule.reps === 0).slice(0, options.newLimit ?? 20);
      break;
    case 'weak':
      result = active.filter((card) => {
        const total = card.stats.correct + card.stats.incorrect;
        return total >= 2 && card.stats.correct / total < 0.7;
      });
      break;
    case 'wrong':
      result = active.filter((card) => latest.get(card.id)?.isCorrect === false);
      break;
    case 'favorite':
      result = active.filter((card) => card.favorite);
      break;
    case 'random':
      result = shuffle(active);
      break;
    case 'tag':
      result = active.filter((card) => options.tag && card.tags.includes(options.tag));
      break;
    case 'exam':
      result = shuffle(active).slice(0, options.examSize ?? 20);
      break;
    case 'due':
    default:
      result = active.filter((card) => card.schedule.reps > 0 && isDue(card.schedule, now)).slice(0, options.reviewLimit ?? 200);
      break;
  }

  return options.mode === 'random' ? result : shuffle(result);
}
