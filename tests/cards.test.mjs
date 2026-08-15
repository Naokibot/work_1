import test from 'node:test';
import assert from 'node:assert/strict';
import { createCard, validateCardDraft } from '../dist/assets/cards/cards.js';

const baseDraft = {
  cardNumber: '  A-12  ',
  question: 'Question',
  answer: 'Answer',
  distractors: ['Wrong'],
  explanation: '',
  tagsText: 'test',
  favorite: false
};

test('card number is trimmed and preserved independently from internal id', () => {
  const card = createCard(baseDraft, new Date('2026-08-15T00:00:00.000Z'));
  assert.equal(card.cardNumber, 'A-12');
  assert.match(card.id, /^card_/);
});

test('card number is optional', () => {
  const card = createCard({ ...baseDraft, cardNumber: '' });
  assert.equal(card.cardNumber, '');
  assert.deepEqual(validateCardDraft({ ...baseDraft, cardNumber: '' }), []);
});

test('card number length is bounded', () => {
  const errors = validateCardDraft({ ...baseDraft, cardNumber: 'x'.repeat(101) });
  assert.ok(errors.some((message) => message.includes('100文字')));
});
