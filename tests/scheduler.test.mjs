import test from 'node:test';
import assert from 'node:assert/strict';
import { initialSchedule, scheduleReview, retrievability } from '../dist/assets/scheduler/scheduler.js';

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
