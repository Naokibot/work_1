import test from 'node:test';
import assert from 'node:assert/strict';
import { FSRS6_DEFAULT_PARAMETERS, initialSchedule, scheduleReview, retrievability } from '../dist/assets/scheduler/scheduler.js';

const now = new Date('2026-08-15T00:00:00.000Z');

test('first review intervals increase from again to easy', () => {
  const state = initialSchedule(now);
  const again = scheduleReview(state, 'again', now);
  const hard = scheduleReview(state, 'hard', now);
  const good = scheduleReview(state, 'good', now);
  const easy = scheduleReview(state, 'easy', now);
  assert.ok(again.intervalDays < hard.intervalDays);
  assert.ok(hard.intervalDays < good.intervalDays);
  assert.ok(good.intervalDays < easy.intervalDays);
});

test('again increments lapses and resets streak', () => {
  const first = scheduleReview(initialSchedule(now), 'good', now).state;
  const later = new Date('2026-08-17T00:00:00.000Z');
  const failed = scheduleReview(first, 'again', later).state;
  assert.equal(failed.lapses, first.lapses + 1);
  assert.equal(failed.streak, 0);
});

test('difficulty remains bounded', () => {
  let state = initialSchedule(now);
  for (let i = 0; i < 30; i += 1) state = scheduleReview(state, 'again', new Date(now.getTime() + i * 600000)).state;
  assert.ok(state.difficulty <= 10);
  assert.ok(state.difficulty >= 1);
});

test('retrievability decays over elapsed time', () => {
  const state = scheduleReview(initialSchedule(now), 'easy', now).state;
  const soon = retrievability(state, new Date(now.getTime() + 60_000));
  const later = retrievability(state, new Date(now.getTime() + 10 * 86_400_000));
  assert.ok(soon > later);
});

test('FSRS-6 forgetting uses the current short-term stability cap', () => {
  const first = scheduleReview(initialSchedule(now), 'easy', now, { learningStepsMinutes: [] }).state;
  const later = new Date(now.getTime() + 30 * 86_400_000);
  const r = retrievability(first, later);
  const w = FSRS6_DEFAULT_PARAMETERS;
  const longTerm = w[11] * Math.pow(first.difficulty, -w[12]) * (Math.pow(first.stability + 1, w[13]) - 1) * Math.exp(w[14] * (1 - r));
  const shortTermCap = first.stability / Math.exp(w[17] * w[18]);
  const expected = Math.max(0.01, Math.min(longTerm, shortTermCap));
  const failed = scheduleReview(first, 'again', later, { relearningStepsMinutes: [] }).state;
  assert.ok(Math.abs(failed.stability - expected) < 1e-10);
});

test('FSRS-6 forgetting curve is 90 percent at one stability interval', () => {
  const state = {
    stability: 12,
    difficulty: 5,
    due: now.toISOString(),
    reps: 3,
    lapses: 0,
    streak: 3,
    lastReview: now.toISOString(),
    learningStep: null,
    relearning: false
  };
  const atStability = retrievability(state, new Date(now.getTime() + 12 * 86_400_000));
  assert.ok(Math.abs(atStability - 0.9) < 1e-12);
});
