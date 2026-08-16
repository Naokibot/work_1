import test from 'node:test';
import assert from 'node:assert/strict';
import { computeExamPlan, studyPreset } from '../dist/assets/study/learning-tools.js';

test('study presets map high-value learning modes onto the existing review engine', () => {
  assert.deepEqual(studyPreset('learn'), { mode: 'deck', style: 'choice', size: 30, speech: false });
  assert.deepEqual(studyPreset('test'), { mode: 'exam', style: 'choice', size: 20, speech: false });
  assert.deepEqual(studyPreset('write'), { mode: 'deck', style: 'type', size: 30, speech: false });
  assert.deepEqual(studyPreset('spell'), { mode: 'deck', style: 'type', size: 30, speech: true });
  assert.deepEqual(studyPreset('wrong'), { mode: 'wrong', style: 'self', size: 30, speech: false });
});

test('exam planner deduplicates unseen, weak, and due cards into a daily target', () => {
  const now = new Date(2026, 7, 17, 12, 0, 0);
  const cards = [
    {
      id: 'new-card',
      schedule: { reps: 0, due: new Date(2026, 7, 17, 12).toISOString() },
      stats: { correct: 0, incorrect: 0 }
    },
    {
      id: 'weak-and-due',
      schedule: { reps: 4, due: new Date(2026, 7, 18, 9).toISOString() },
      stats: { correct: 1, incorrect: 2 }
    },
    {
      id: 'stable-later',
      schedule: { reps: 8, due: new Date(2026, 8, 20, 9).toISOString() },
      stats: { correct: 8, incorrect: 0 }
    }
  ];
  const history = [
    { cardId: 'weak-and-due', isCorrect: false, reviewedAt: new Date(2026, 7, 17, 8).toISOString() }
  ];

  const plan = computeExamPlan(cards, history, '2026-08-19', now);
  assert.equal(plan.valid, true);
  assert.equal(plan.daysLeft, 3);
  assert.equal(plan.totalCards, 3);
  assert.equal(plan.unseenCards, 1);
  assert.equal(plan.weakCards, 1);
  assert.equal(plan.dueBeforeExam, 1);
  assert.equal(plan.workloadCards, 2);
  assert.equal(plan.dailyTarget, 1);
  assert.equal(plan.reviewedToday, 1);
  assert.equal(plan.progressToday, 1);
  assert.equal(plan.readiness, 33);
});

test('exam planner rejects past dates without changing card data', () => {
  const now = new Date(2026, 7, 17, 12, 0, 0);
  const cards = [{ id: 'card', schedule: { reps: 0, due: now.toISOString() }, stats: { correct: 0, incorrect: 0 } }];
  const snapshot = structuredClone(cards);
  const plan = computeExamPlan(cards, [], '2026-08-16', now);
  assert.equal(plan.valid, false);
  assert.deepEqual(cards, snapshot);
});
