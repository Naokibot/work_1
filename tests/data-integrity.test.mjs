import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initialSchedule } from '../dist/assets/scheduler/scheduler.js';
import { selectCards } from '../dist/assets/review/select.js';
import { evaluateFsrs } from '../dist/assets/anki/fsrs-tools.js';
import { localDateKey } from '../dist/assets/utils/local-date.js';
import { trueRetention } from '../dist/assets/statistics/anki-stats.js';

function card(id, overrides = {}) {
  return {
    id,
    question: id,
    answer: 'answer',
    distractors: [],
    explanation: '',
    tags: [],
    favorite: false,
    createdAt: '2026-08-18T00:00:00.000Z',
    updatedAt: '2026-08-18T00:00:00.000Z',
    deletedAt: null,
    schedule: initialSchedule(new Date('2026-08-18T00:00:00.000Z')),
    stats: { correct: 0, incorrect: 0, totalTimeMs: 0, fastestMs: null, lastTimesMs: [] },
    version: 1,
    ...overrides
  };
}

function history(id, cardId, reviewedAt, overrides = {}) {
  return {
    id,
    cardId,
    questionSnapshot: cardId,
    tags: [],
    rating: 'good',
    isCorrect: true,
    responseMs: 1000,
    reviewedAt,
    nextDue: reviewedAt,
    device: 'test',
    requestId: `req_${id.padEnd(12, 'x')}`,
    source: 'scheduled',
    ...overrides
  };
}

test('daily new limit is a calendar-day budget, not a per-session limit', () => {
  const now = new Date(2026, 7, 18, 12, 0, 0);
  const cards = [card('n1'), card('n2'), card('n3'), card('done1'), card('done2')];
  const today = now.toISOString();
  const reviews = [
    history('h1', 'done1', today, { wasNew: true }),
    history('h2', 'done2', today, { wasNew: true })
  ];
  assert.equal(selectCards(cards, reviews, { mode: 'new', newLimit: 2, now }).length, 0);
});

test('daily review limit only leaves the remaining scheduled budget', () => {
  const now = new Date(2026, 7, 18, 12, 0, 0);
  const due = { ...initialSchedule(now), reps: 3, stability: 5, due: new Date(now.getTime() - 1000).toISOString(), lastReview: new Date(now.getTime() - 86400000).toISOString() };
  const cards = [card('r1', { queue: 'review', schedule: due }), card('r2', { queue: 'review', schedule: due }), card('previous', { queue: 'review', schedule: due })];
  const reviews = [history('h3', 'previous', now.toISOString(), { wasNew: false })];
  assert.equal(selectCards(cards, reviews, { mode: 'due', reviewLimit: 2, now }).length, 1);
});

test('daily limits only count reviews from the selected deck tree', () => {
  const now = new Date(2026, 7, 18, 12, 0, 0);
  const state = {
    activeProfileId: 'p',
    decks: [
      { id: 'deck_a', profileId: 'p', name: 'A', presetId: 'preset' },
      { id: 'deck_b', profileId: 'p', name: 'B', presetId: 'preset' }
    ],
    presets: [{ id: 'preset', newGatherOrder: 'ascending', reviewOrder: 'due', newReviewOrder: 'after' }]
  };
  const cards = [
    card('a_new', { profileId: 'p', deckId: 'deck_a' }),
    card('b_done', { profileId: 'p', deckId: 'deck_b' })
  ];
  const reviews = [history('other', 'b_done', now.toISOString(), { wasNew: true, profileId: 'p' })];
  assert.deepEqual(selectCards(cards, reviews, { mode: 'new', state, deckId: 'deck_a', newLimit: 1, now }).map((item) => item.id), ['a_new']);
});

test('mock-test history does not affect FSRS evaluation or retention', () => {
  const scheduled = Array.from({ length: 8 }, (_, index) => history(`s${index}`, 'card', new Date(Date.UTC(2026, 0, 1 + index)).toISOString(), { rating: index === 3 ? 'again' : 'good', isCorrect: index !== 3 }));
  const exam = history('exam', 'card', new Date(Date.UTC(2026, 0, 20)).toISOString(), { source: 'exam', rating: 'again', isCorrect: false });
  assert.deepEqual(evaluateFsrs([...scheduled, exam]), evaluateFsrs(scheduled));
  assert.deepEqual(trueRetention([...scheduled, exam]), trueRetention(scheduled));
});

test('local date accounting treats early-morning Japan time as the new day', () => {
  const previous = process.env.TZ;
  process.env.TZ = 'Asia/Tokyo';
  try {
    assert.equal(localDateKey('2026-08-17T15:30:00.000Z'), '2026-08-18');
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test('sync pull is isolated from the application document', async () => {
  const source = await readFile(new URL('../src/sync/client.ts', import.meta.url), 'utf8');
  assert.match(source, /iframe\.sandbox\.add\('allow-scripts'\)/);
  assert.match(source, /sync-sandbox\.html/);
  assert.doesNotMatch(source, /document\.head\.append\(script\)/);
  const gas = await readFile(new URL('../gas/Code.gs', import.meta.url), 'utf8');
  assert.match(gas, /deleteHistory/);
  assert.match(gas, /'ProfileId', 'Source', 'WasNew', 'DeletedAt'/);
  assert.match(gas, /'Metadata'/);
});
