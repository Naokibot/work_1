import test from 'node:test';
import assert from 'node:assert/strict';
import { initialSchedule } from '../dist/assets/scheduler/scheduler.js';
import { selectCards } from '../dist/assets/review/select.js';

function card(id, overrides = {}) {
  return {
    id,
    question: id,
    answer: 'a',
    distractors: ['b'],
    explanation: '',
    tags: ['math'],
    favorite: false,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    deletedAt: null,
    schedule: initialSchedule(new Date('2026-08-01T00:00:00.000Z')),
    stats: { correct: 0, incorrect: 0, totalTimeMs: 0, fastestMs: null, lastTimesMs: [] },
    version: 1,
    ...overrides
  };
}

test('new mode respects limit', () => {
  const cards = [card('1'), card('2'), card('3')];
  assert.equal(selectCards(cards, [], { mode: 'new', newLimit: 2 }).length, 2);
});

test('weak mode selects cards below 70 percent after two attempts', () => {
  const cards = [
    card('weak', { stats: { correct: 1, incorrect: 2, totalTimeMs: 0, fastestMs: null, lastTimesMs: [] } }),
    card('strong', { stats: { correct: 9, incorrect: 1, totalTimeMs: 0, fastestMs: null, lastTimesMs: [] } })
  ];
  assert.deepEqual(selectCards(cards, [], { mode: 'weak' }).map((c) => c.id), ['weak']);
});

test('tag mode only returns exact tag matches', () => {
  const cards = [card('math'), card('science', { tags: ['science'] })];
  assert.deepEqual(selectCards(cards, [], { mode: 'tag', tag: 'science' }).map((c) => c.id), ['science']);
});
