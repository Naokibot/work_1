import type { CardQueue, Rating, ScheduleState } from '../types.js';
import { clamp } from '../utils/core.js';

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

export const FSRS6_DEFAULT_PARAMETERS = [
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666,
  0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542
] as const;

const GRADE: Record<Rating, number> = { again: 1, hard: 2, good: 3, easy: 4 };

export interface ScheduleOptions {
  desiredRetention?: number;
  maximumIntervalDays?: number;
  learningStepsMinutes?: number[];
  relearningStepsMinutes?: number[];
  parameters?: readonly number[];
  easyDays?: number[];
}

export interface ScheduleResult {
  state: ScheduleState;
  intervalDays: number;
  queue: CardQueue;
  explanation: string;
}

function parameters(options?: ScheduleOptions): readonly number[] {
  const value = options?.parameters;
  return value && value.length >= 21 ? value : FSRS6_DEFAULT_PARAMETERS;
}

export function initialSchedule(now = new Date()): ScheduleState {
  return {
    stability: 0,
    difficulty: 5,
    due: now.toISOString(),
    reps: 0,
    lapses: 0,
    streak: 0,
    lastReview: null,
    learningStep: null,
    relearning: false
  };
}

function elapsedDays(state: ScheduleState, now: Date): number {
  if (!state.lastReview) return 0;
  return Math.max(0, (now.getTime() - new Date(state.lastReview).getTime()) / DAY_MS);
}

function factor(w20: number): number {
  return Math.pow(0.9, -1 / w20) - 1;
}

export function retrievability(state: ScheduleState, now = new Date(), options?: ScheduleOptions): number {
  if (!state.lastReview || state.stability <= 0) return 0;
  const w = parameters(options);
  const w20 = Math.max(0.01, Number(w[20] ?? FSRS6_DEFAULT_PARAMETERS[20]));
  const elapsed = elapsedDays(state, now);
  return Math.pow(1 + factor(w20) * elapsed / Math.max(0.001, state.stability), -w20);
}

export function intervalForRetention(stability: number, desiredRetention = 0.9, options?: ScheduleOptions): number {
  const w = parameters(options);
  const w20 = Math.max(0.01, Number(w[20] ?? FSRS6_DEFAULT_PARAMETERS[20]));
  const retention = clamp(desiredRetention, 0.7, 0.99);
  return Math.max(0, stability / factor(w20) * (Math.pow(retention, -1 / w20) - 1));
}

function initialDifficulty(grade: number, w: readonly number[]): number {
  return clamp(Number(w[4] ?? 6.4133) - Math.exp(Number(w[5] ?? 0.8334) * (grade - 1)) + 1, 1, 10);
}

function nextDifficulty(previous: number, grade: number, w: readonly number[]): number {
  const delta = -Number(w[6] ?? 3.0194) * (grade - 3);
  const damped = previous + delta * (10 - previous) / 9;
  const target = initialDifficulty(4, w);
  return clamp(Number(w[7] ?? 0.001) * target + (1 - Number(w[7] ?? 0.001)) * damped, 1, 10);
}

function sameDayStability(stability: number, grade: number, w: readonly number[]): number {
  const s = Math.max(0.01, stability);
  const value = s * Math.exp(Number(w[17] ?? 0.5425) * (grade - 3 + Number(w[18] ?? 0.0912))) * Math.pow(s, -Number(w[19] ?? 0.0658));
  return Math.max(0.01, grade >= 2 ? Math.max(s, value) : value);
}

function recallStability(difficulty: number, stability: number, r: number, grade: number, w: readonly number[]): number {
  const hardPenalty = grade === 2 ? Number(w[15] ?? 0.6014) : 1;
  const easyBonus = grade === 4 ? Number(w[16] ?? 1.8729) : 1;
  const growth = Math.exp(Number(w[8] ?? 1.8722))
    * (11 - difficulty)
    * Math.pow(Math.max(stability, 0.01), -Number(w[9] ?? 0.1666))
    * (Math.exp(Number(w[10] ?? 0.796) * (1 - r)) - 1)
    * hardPenalty
    * easyBonus;
  return Math.max(0.01, stability * (1 + Math.max(0, growth)));
}

function forgetStability(difficulty: number, stability: number, r: number, w: readonly number[]): number {
  return Math.max(
    0.01,
    Number(w[11] ?? 1.4835)
      * Math.pow(Math.max(difficulty, 1), -Number(w[12] ?? 0.0614))
      * (Math.pow(Math.max(stability, 0) + 1, Number(w[13] ?? 0.2629)) - 1)
      * Math.exp(Number(w[14] ?? 1.6483) * (1 - r))
  );
}

function learningDelayMinutes(steps: number[], step: number, rating: Rating): { minutes: number; nextStep: number | null } | null {
  if (!steps.length) return null;
  const current = Math.max(0, Math.min(step, steps.length - 1));
  if (rating === 'again') return { minutes: steps[0] ?? 1, nextStep: 0 };
  if (rating === 'hard') {
    const currentMinutes = steps[current] ?? steps[0] ?? 1;
    const nextMinutes = steps[Math.min(current + 1, steps.length - 1)] ?? currentMinutes;
    return { minutes: Math.max(1, Math.round((currentMinutes + nextMinutes) / 2)), nextStep: current };
  }
  if (rating === 'good') {
    const next = current + 1;
    if (next < steps.length) return { minutes: steps[next] ?? 1, nextStep: next };
    return null;
  }
  return null;
}


function adjustForEasyDays(now: Date, intervalDays: number, weights?: number[]): number {
  if (!weights || weights.length !== 7 || intervalDays < 2) return intervalDays;
  const base = Math.max(1, Math.round(intervalDays));
  let best = base;
  let bestScore = -Infinity;
  for (const shift of [-1, 0, 1]) {
    const candidate = Math.max(1, base + shift);
    const due = new Date(now.getTime() + candidate * DAY_MS);
    const weight = Number(weights[due.getDay()] ?? 1);
    const score = weight * 10 - Math.abs(candidate - intervalDays);
    if (score > bestScore) { best = candidate; bestScore = score; }
  }
  return best;
}

function dueFromMinutes(now: Date, minutes: number): string {
  return new Date(now.getTime() + Math.max(1, minutes) * MINUTE_MS).toISOString();
}

export function scheduleReview(previous: ScheduleState, rating: Rating, now = new Date(), options: ScheduleOptions = {}): ScheduleResult {
  const w = parameters(options);
  const grade = GRADE[rating];
  const desiredRetention = clamp(options.desiredRetention ?? 0.9, 0.7, 0.99);
  const maximumIntervalDays = clamp(options.maximumIntervalDays ?? 36500, 1, 36500);
  const learningSteps = (options.learningStepsMinutes ?? [1, 10]).filter((n) => Number.isFinite(n) && n > 0);
  const relearningSteps = (options.relearningStepsMinutes ?? [10]).filter((n) => Number.isFinite(n) && n > 0);
  const isFirst = previous.reps === 0;
  const r = retrievability(previous, now, options);
  let difficulty = isFirst ? initialDifficulty(grade, w) : nextDifficulty(previous.difficulty, grade, w);
  let stability = isFirst ? Math.max(0.01, Number(w[grade - 1] ?? 1)) : previous.stability;
  let lapses = previous.lapses;
  let streak = previous.streak;
  let learningStep = previous.learningStep ?? null;
  let relearning = Boolean(previous.relearning);
  let queue: CardQueue = previous.reps === 0 ? 'new' : (relearning ? 'relearning' : learningStep !== null ? 'learning' : 'review');

  if (!isFirst) {
    const elapsed = elapsedDays(previous, now);
    if (elapsed < 1 && previous.stability > 0) stability = sameDayStability(previous.stability, grade, w);
    else if (rating === 'again') stability = forgetStability(difficulty, previous.stability, r, w);
    else stability = recallStability(difficulty, previous.stability, r, grade, w);
  }

  if (rating === 'again') {
    lapses += isFirst ? 0 : 1;
    streak = 0;
  } else {
    streak += 1;
  }

  let due: string;
  let intervalDays: number;

  if (isFirst || (learningStep !== null && !relearning)) {
    const delay = learningDelayMinutes(learningSteps, isFirst ? 0 : learningStep ?? 0, rating);
    if (delay) {
      learningStep = delay.nextStep;
      relearning = false;
      queue = 'learning';
      due = dueFromMinutes(now, delay.minutes);
      intervalDays = delay.minutes / 1440;
    } else {
      learningStep = null;
      relearning = false;
      queue = 'review';
      intervalDays = clamp(intervalForRetention(stability, desiredRetention, options), 1, maximumIntervalDays); intervalDays=adjustForEasyDays(now,intervalDays,options.easyDays);
      due = new Date(now.getTime() + intervalDays * DAY_MS).toISOString();
    }
  } else if (rating === 'again' && previous.reps > 0) {
    const delay = learningDelayMinutes(relearningSteps, 0, 'again');
    if (delay) {
      learningStep = 0;
      relearning = true;
      queue = 'relearning';
      due = dueFromMinutes(now, delay.minutes);
      intervalDays = delay.minutes / 1440;
    } else {
      learningStep = null;
      relearning = false;
      queue = 'review';
      intervalDays = clamp(intervalForRetention(stability, desiredRetention, options), 1, maximumIntervalDays); intervalDays=adjustForEasyDays(now,intervalDays,options.easyDays);
      due = new Date(now.getTime() + intervalDays * DAY_MS).toISOString();
    }
  } else if (relearning && learningStep !== null) {
    const delay = learningDelayMinutes(relearningSteps, learningStep, rating);
    if (delay) {
      learningStep = delay.nextStep;
      queue = 'relearning';
      due = dueFromMinutes(now, delay.minutes);
      intervalDays = delay.minutes / 1440;
    } else {
      learningStep = null;
      relearning = false;
      queue = 'review';
      intervalDays = clamp(intervalForRetention(stability, desiredRetention, options), 1, maximumIntervalDays); intervalDays=adjustForEasyDays(now,intervalDays,options.easyDays);
      due = new Date(now.getTime() + intervalDays * DAY_MS).toISOString();
    }
  } else {
    queue = 'review';
    learningStep = null;
    relearning = false;
    intervalDays = clamp(intervalForRetention(stability, desiredRetention, options), 1, maximumIntervalDays); intervalDays=adjustForEasyDays(now,intervalDays,options.easyDays);
    due = new Date(now.getTime() + intervalDays * DAY_MS).toISOString();
  }

  const state: ScheduleState = {
    stability,
    difficulty,
    due,
    reps: previous.reps + 1,
    lapses,
    streak,
    lastReview: now.toISOString(),
    learningStep,
    relearning
  };

  return {
    state,
    intervalDays,
    queue,
    explanation: `FSRS-6 rating=${rating}, D=${difficulty.toFixed(2)}, S=${stability.toFixed(2)}d, R=${r.toFixed(3)}, retention=${desiredRetention.toFixed(2)}, interval=${intervalDays.toFixed(3)}d`
  };
}

export function isDue(state: ScheduleState, now = new Date()): boolean {
  return new Date(state.due).getTime() <= now.getTime();
}
