import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultAnkiState } from '../dist/assets/anki/defaults.js';
import { generateCardsForNote } from '../dist/assets/anki/templates.js';

test('generated cards preserve the optional card number field', () => {
  const state = createDefaultAnkiState();
  const note = {
    id: 'note_test',
    guid: 'guid_test',
    profileId: state.activeProfileId,
    deckId: state.decks[0].id,
    noteTypeId: state.noteTypes.find((item) => item.name === 'Basic')?.id ?? state.noteTypes[0].id,
    fields: { Front: '日本の首都は？', Back: '東京', Extra: '', __CardNumber: '001' },
    tags: ['地理'],
    createdAt: '2026-08-15T00:00:00.000Z',
    updatedAt: '2026-08-15T00:00:00.000Z',
    deletedAt: null
  };
  const cards = generateCardsForNote(note, state);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].cardNumber, '001');
  assert.equal(cards[0].question, '日本の首都は？');
  assert.ok(cards[0].answer.includes('東京'));
});
