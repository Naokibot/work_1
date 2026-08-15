import type { Rating, ScheduleState } from '../types.js';
import { clamp } from '../utils/core.js';

const DAY_MS = 86_400_000;
const RATING_DIFFICULTY: Record<Rating, number> = {
  again: 0.8,
  hard: 0.18,
  good: -0.12,
  easy: -0.42
};

export interface ScheduleResult {
  state: ScheduleState;
  intervalDays: number;
  explanation: string;
}

export function initialSchedule(now = new Date()): ScheduleState {
  return {
    stability: 0,
    difficulty: 5,
    due: now.toISOString(),
    reps: 0,
    lapses: 0,
    streak: 0,
    lastReview: null
  };
}

function elapsedDays(state: ScheduleState, now: Date): number {
  if (!state.lastReview) return 0;
  return Math.max(0, (now.getTime() - new Date(state.lastReview).getTime()) / DAY_MS);
}

export function retrievability(state: ScheduleState, now = new Date()): number {
  if (!state.lastReview || state.stability <= 0) return 0;
  const elapsed = elapsedDays(state, now);
  return Math.exp(-elapsed / Math.max(0.05, state.stability));
}

export function scheduleReview(previous: ScheduleState, rating: Rating, now = new Date()): ScheduleResult {
  const difficulty = clamp(previous.difficulty + RATING_DIFFICULTY[rating], 1, 10);
  const r = retrievability(previous, now);
  let stability: number;
  let intervalDays: number;
  let lapses = previous.lapses;
  let streak = previous.streak;

  if (previous.reps === 0) {
    const first = { again: 10 / 1440, hard: 0.5, good: 1, easy: 4 } as const;
    stability = first[rating];
    intervalDays = first[rating];
    if (rating === 'again') lapses += 1;
    streak = rating === 'again' ? 0 : 1;
  } else if (rating === 'again') {
    stability = Math.max(10 / 1440, previous.stability * (0.18 + 0.12 * r));
    intervalDays = 10 / 1440;
    lapses += 1;
    streak = 0;
  } else {
    const baseGrowth = rating === 'hard' ? 1.18 : rating === 'good' ? 1.85 : 2.65;
    const difficultyPenalty = 1 - (difficulty - 5) * 0.055;
    const forgettingBoost = 1 + (1 - r) * 0.55;
    const maturity = 1 + Math.log1p(Math.max(0, previous.stability)) * 0.04;
    const growth = Math.max(rating === 'hard' ? 1.05 : 1.2, baseGrowth * difficultyPenalty * forgettingBoost * maturity);
    stability = clamp(Math.max(previous.stability, 0.25) * growth, 0.01, 3650);
    intervalDays = rating === 'hard' ? Math.max(0.5, stability * 0.72) : stability;
    streak += 1;
  }

  const due = new Date(now.getTime() + intervalDays * DAY_MS);
  const state: ScheduleState = {
    stability,
    difficulty,
    due: due.toISOString(),
    reps: previous.reps + 1,
    lapses,
    streak,
    lastReview: now.toISOString()
  };

  return {
    state,
    intervalDays,
    explanation: `rating=${rating}, D=${difficulty.toFixed(2)}, S=${stability.toFixed(2)}d, R=${r.toFixed(2)}, interval=${intervalDays.toFixed(2)}d`
  };
}

export function isDue(state: ScheduleState, now = new Date()): boolean {
  return new Date(state.due).getTime() <= now.getTime();
}
