import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultAnkiState } from '../dist/assets/anki/defaults.js';
import { generateCardsForNote } from '../dist/assets/anki/templates.js';
import { cardNumberChoices } from '../dist/assets/app/card-number.js';

test('generated cards preserve the optional card number field', () => {
  const state = createDefaultAnkiState();
  const note = {
    id: 'note_test',
    guid: 'guid_test',
    profileId: state.activeProfileId,
    deckId: state.decks[0].id,
    noteTypeId: state.noteTypes.find((item) => item.name === 'Basic')?.id ?? state.noteTypes[0].id,
    fields: { Front: '日本の首都は？', Back: '東京', Extra: '', __CardNumber: '1' },
    tags: ['地理'],
    createdAt: '2026-08-15T00:00:00.000Z',
    updatedAt: '2026-08-15T00:00:00.000Z',
    deletedAt: null
  };
  const cards = generateCardsForNote(note, state);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].cardNumber, '1');
  assert.equal(cards[0].question, '日本の首都は？');
  assert.ok(cards[0].answer.includes('東京'));
});

test('card numbers default to the next creation number and exclude used values', () => {
  const cards = [
    { cardNumber: '1', profileId: 'profile_default', deletedAt: null },
    { cardNumber: '2', profileId: 'profile_default', deletedAt: null },
    { cardNumber: '4', profileId: 'profile_default', deletedAt: null }
  ];
  const result = cardNumberChoices(cards, 'profile_default');
  assert.equal(result.defaultNumber, 5);
  assert.ok(result.choices.includes(3));
  assert.ok(result.choices.includes(5));
  assert.ok(!result.choices.includes(1));
  assert.ok(!result.choices.includes(2));
  assert.ok(!result.choices.includes(4));
});

test('card number choices are isolated by profile and ignore deleted cards', () => {
  const cards = [
    { cardNumber: '1', profileId: 'other', deletedAt: null },
    { cardNumber: '2', profileId: 'profile_default', deletedAt: '2026-08-01T00:00:00.000Z' }
  ];
  const result = cardNumberChoices(cards, 'profile_default');
  assert.equal(result.defaultNumber, 1);
  assert.equal(result.choices[0], 1);
});
