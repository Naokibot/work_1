import type { AnkiState, ReviewHistory, ReviewMode, StudyCard } from '../types.js';
import { isDue, retrievability } from '../scheduler/scheduler.js';
import { shuffle } from '../utils/core.js';
import { cardsInDeck } from '../anki/collection.js';

export interface SelectionOptions {
  mode: ReviewMode;
  tag?: string;
  examSize?: number;
  newLimit?: number;
  reviewLimit?: number;
  now?: Date;
  state?: AnkiState;
  deckId?: string;
  filteredDeckId?: string;
}

export function latestHistoryByCard(history: ReviewHistory[]): Map<string, ReviewHistory> {
  const map = new Map<string, ReviewHistory>();
  for (const item of [...history].sort((a, b) => a.reviewedAt.localeCompare(b.reviewedAt))) map.set(item.cardId, item);
  return map;
}

function available(card: StudyCard, now: Date): boolean {
  return !card.deletedAt && !card.suspended && (!card.buriedUntil || new Date(card.buriedUntil).getTime() <= now.getTime());
}

function newCards(cards: StudyCard[], limit: number, state?: AnkiState, deckId?: string): StudyCard[] {
  const result = cards.filter((card) => (card.queue ?? (card.schedule.reps === 0 ? 'new' : 'review')) === 'new');
  if (state) {
    const deck = state.decks.find((item) => item.id === (deckId ?? result[0]?.deckId));
    const preset = state.presets.find((item) => item.id === deck?.presetId) ?? state.presets[0];
    if (preset?.newGatherOrder === 'random') return shuffle(result).slice(0, limit);
    if (preset?.newGatherOrder === 'descending') result.sort((a, b) => (b.position ?? 0) - (a.position ?? 0));
    else result.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  } else result.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  return result.slice(0, limit);
}

function dueCards(cards: StudyCard[], now: Date, limit: number, state?: AnkiState, deckId?: string): StudyCard[] {
  const learning = cards
    .filter((card) => ['learning', 'relearning'].includes(card.queue ?? '') && isDue(card.schedule, now))
    .sort((a, b) => a.schedule.due.localeCompare(b.schedule.due));
  const reviews = cards.filter((card) => (card.queue ?? (card.schedule.reps ? 'review' : 'new')) === 'review' && isDue(card.schedule, now));
  if (state) {
    const deck = state.decks.find((item) => item.id === (deckId ?? reviews[0]?.deckId));
    const preset = state.presets.find((item) => item.id === deck?.presetId) ?? state.presets[0];
    if (preset?.reviewOrder === 'random') reviews.splice(0, reviews.length, ...shuffle(reviews));
    else if (preset?.reviewOrder === 'difficulty') reviews.sort((a, b) => b.schedule.difficulty - a.schedule.difficulty);
    else if (preset?.reviewOrder === 'retrievability') reviews.sort((a, b) => retrievability(a.schedule, now) - retrievability(b.schedule, now));
    else reviews.sort((a, b) => a.schedule.due.localeCompare(b.schedule.due));
  } else reviews.sort((a, b) => a.schedule.due.localeCompare(b.schedule.due));
  return [...learning, ...reviews.slice(0, limit)];
}

function interleave(review: StudyCard[], fresh: StudyCard[]): StudyCard[] {
  if (!review.length) return fresh;
  if (!fresh.length) return review;
  const result: StudyCard[] = [];
  const step = review.length / fresh.length;
  let newIndex = 0;
  for (let reviewIndex = 0; reviewIndex < review.length; reviewIndex += 1) {
    result.push(review[reviewIndex] as StudyCard);
    while (newIndex < fresh.length && (newIndex + 1) * step <= reviewIndex + 1) result.push(fresh[newIndex++] as StudyCard);
  }
  result.push(...fresh.slice(newIndex));
  return result;
}

export function selectCards(cards: StudyCard[], history: ReviewHistory[], options: SelectionOptions): StudyCard[] {
  const now = options.now ?? new Date();
  const latest = latestHistoryByCard(history);
  let active = cards.filter((card) => available(card, now));
  if (options.state && options.deckId) active = cardsInDeck(active, options.state, options.deckId, true);

  switch (options.mode) {
    case 'new':
      return newCards(active, options.newLimit ?? 20, options.state, options.deckId);
    case 'weak':
      return active.filter((card) => { const attempts = card.stats.correct + card.stats.incorrect; return attempts >= 2 && card.stats.correct / attempts < 0.7; });
    case 'wrong':
      return active.filter((card) => latest.get(card.id)?.isCorrect === false);
    case 'favorite':
      return active.filter((card) => card.favorite || card.marked);
    case 'tag':
      return active.filter((card) => Boolean(options.tag) && card.tags.includes(options.tag!));
    case 'exam':
      return shuffle(active).slice(0, options.examSize ?? 20);
    case 'random':
      return shuffle(active);
    case 'deck': {
      const reviews = dueCards(active, now, options.reviewLimit ?? 200, options.state, options.deckId);
      const fresh = newCards(active, options.newLimit ?? 20, options.state, options.deckId);
      const deck = options.state?.decks.find((item) => item.id === options.deckId);
      const preset = options.state?.presets.find((item) => item.id === deck?.presetId) ?? options.state?.presets[0];
      if (preset?.newReviewOrder === 'before') return [...fresh, ...reviews];
      if (preset?.newReviewOrder === 'after') return [...reviews, ...fresh];
      return interleave(reviews, fresh);
    }
    case 'filtered':
    case 'due':
    default:
      return dueCards(active, now, options.reviewLimit ?? 200, options.state, options.deckId);
  }
}
