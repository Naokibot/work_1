import type { AnkiState, ReviewHistory, StudyCard, StudyNote } from '../types.js';
import { retrievability } from '../scheduler/scheduler.js';
import { stripHtml } from './templates.js';

const DAY_MS = 86_400_000;

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function wildcard(value: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  try { return new RegExp(`^${escaped}$`, 'i').test(value); } catch { return false; }
}

export function tokenizeSearch(query: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote = false;
  let escape = false;
  for (const char of query.trim()) {
    if (escape) { current += char; escape = false; continue; }
    if (char === '\\') { escape = true; continue; }
    if (char === '"') { quote = !quote; continue; }
    if (/\s/.test(char) && !quote) {
      if (current) tokens.push(current);
      current = '';
    } else current += char;
  }
  if (current) tokens.push(current);
  return tokens;
}

function noteFor(card: StudyCard, state: AnkiState): StudyNote | undefined {
  return state.notes.find((note) => note.id === card.noteId);
}

function deckName(card: StudyCard, state: AnkiState): string {
  return state.decks.find((deck) => deck.id === card.deckId)?.name ?? 'Default';
}

function noteTypeName(card: StudyCard, state: AnkiState): string {
  return state.noteTypes.find((type) => type.id === card.noteTypeId)?.name ?? 'Basic';
}

function templateName(card: StudyCard, state: AnkiState): string {
  const type = state.noteTypes.find((item) => item.id === card.noteTypeId);
  return type?.templates.find((template) => (card.templateId ?? '').startsWith(template.id))?.name ?? card.templateId ?? 'Card 1';
}

function numericCompare(actual: number, expression: string): boolean {
  const match = expression.match(/^(<=|>=|!=|=|<|>)(-?\d+(?:\.\d+)?)$/);
  if (!match) return false;
  const expected = Number(match[2]);
  if (!Number.isFinite(expected)) return false;
  switch (match[1]) {
    case '<': return actual < expected;
    case '<=': return actual <= expected;
    case '>': return actual > expected;
    case '>=': return actual >= expected;
    case '!=': return actual !== expected;
    default: return actual === expected;
  }
}

function recent(history: ReviewHistory[], cardId: string, days: number, now: Date): boolean {
  const cutoff = now.getTime() - days * DAY_MS;
  return history.some((item) => item.cardId === cardId && new Date(item.reviewedAt).getTime() >= cutoff);
}

function matchesProperty(card: StudyCard, property: string, now: Date): boolean {
  const match = property.match(/^([a-z]+)(<=|>=|!=|=|<|>)(-?\d+(?:\.\d+)?)$/i);
  if (!match) return false;
  const name = match[1]?.toLowerCase() ?? '';
  const expression = `${match[2]}${match[3]}`;
  const dueDays = (new Date(card.schedule.due).getTime() - now.getTime()) / DAY_MS;
  const last = card.schedule.lastReview ? new Date(card.schedule.lastReview).getTime() : now.getTime();
  const interval = Math.max(0, (new Date(card.schedule.due).getTime() - last) / DAY_MS);
  const values: Record<string, number> = {
    ivl: interval,
    due: Math.round(dueDays),
    reps: card.schedule.reps,
    lapses: card.schedule.lapses,
    ease: 11 - card.schedule.difficulty,
    pos: card.position ?? 0,
    s: card.schedule.stability,
    d: card.schedule.difficulty,
    r: retrievability(card.schedule, now)
  };
  const value = values[name];
  return value !== undefined && numericCompare(value, expression);
}

function matchesField(note: StudyNote | undefined, key: string, value: string): boolean {
  if (!note) return false;
  const fieldName = Object.keys(note.fields).find((name) => normalize(name) === normalize(key) || wildcard(normalize(name), normalize(key)));
  if (!fieldName) return false;
  const actual = normalize(stripHtml(note.fields[fieldName] ?? ''));
  if (value === '') return actual === '';
  if (value === '*') return true;
  if (value === '_*') return actual.length > 0;
  return value.includes('*') ? wildcard(actual, normalize(value)) : actual === normalize(value);
}

function matchesToken(card: StudyCard, token: string, state: AnkiState, history: ReviewHistory[], now: Date): boolean {
  const note = noteFor(card, state);
  if (token.startsWith('/') && token.endsWith('/') && token.length > 2) {
    try {
      const regex = new RegExp(token.slice(1, -1), 'iu');
      return regex.test([card.question, card.answer, card.explanation, ...card.tags, ...Object.values(note?.fields ?? {})].join('\n'));
    } catch {
      return false;
    }
  }

  const colon = token.indexOf(':');
  if (colon > 0) {
    const key = token.slice(0, colon).toLowerCase();
    const value = token.slice(colon + 1);
    const normalizedValue = normalize(value);
    if (key === 'tag') {
      if (normalizedValue === 'none') return card.tags.length === 0;
      return card.tags.some((tag) => {
        const n = normalize(tag);
        return wildcard(n, normalizedValue) || n === normalizedValue || n.startsWith(`${normalizedValue}::`);
      });
    }
    if (key === 'deck') {
      const name = normalize(deckName(card, state));
      if (normalizedValue === 'filtered') return Boolean(card.filteredDeckId);
      return wildcard(name, normalizedValue) || name === normalizedValue || name.startsWith(`${normalizedValue}::`);
    }
    if (key === 'note') return wildcard(normalize(noteTypeName(card, state)), normalizedValue);
    if (key === 'card') return wildcard(normalize(templateName(card, state)), normalizedValue) || normalize(card.templateId ?? '') === normalizedValue;
    if (key === 'flag') return Number(value) === Number(card.flag ?? 0);
    if (key === 'cid') return value.split(',').includes(card.id);
    if (key === 'nid') return value.split(',').includes(card.noteId ?? '');
    if (key === 'is') {
      if (normalizedValue === 'new') return card.schedule.reps === 0 || card.queue === 'new';
      if (normalizedValue === 'due') return !card.suspended && (!card.buriedUntil || new Date(card.buriedUntil).getTime() <= now.getTime()) && new Date(card.schedule.due).getTime() <= now.getTime();
      if (normalizedValue === 'learn') return card.queue === 'learning' || card.queue === 'relearning' || card.schedule.learningStep != null;
      if (normalizedValue === 'review') return card.schedule.reps > 0 && card.queue !== 'learning';
      if (normalizedValue === 'suspended') return Boolean(card.suspended);
      if (normalizedValue === 'buried') return Boolean(card.buriedUntil && new Date(card.buriedUntil).getTime() > now.getTime());
      if (normalizedValue === 'marked') return Boolean(card.marked || card.favorite || card.tags.includes('marked'));
      return false;
    }
    if (key === 'prop') return matchesProperty(card, value, now);
    if (key === 'added') {
      const days = Number(value);
      return Number.isFinite(days) && new Date(card.createdAt).getTime() >= now.getTime() - days * DAY_MS;
    }
    if (key === 'edited') {
      const days = Number(value);
      return Number.isFinite(days) && new Date(card.updatedAt).getTime() >= now.getTime() - days * DAY_MS;
    }
    if (key === 'rated' || key === 'answered') {
      const days = Number(value.split(':')[0]);
      return Number.isFinite(days) && recent(history, card.id, days, now);
    }
    if (matchesField(note, key, value)) return true;
  }

  const haystack = normalize([
    card.cardNumber ?? '', card.question, card.answer, card.explanation, ...card.tags,
    deckName(card, state), noteTypeName(card, state), templateName(card, state),
    ...Object.values(note?.fields ?? {})
  ].map(stripHtml).join('\n'));
  const needle = normalize(token);
  return needle.includes('*') ? wildcard(haystack, `*${needle}*`) : haystack.includes(needle);
}

export function searchCards(cards: StudyCard[], state: AnkiState, history: ReviewHistory[], query: string, now = new Date()): StudyCard[] {
  const tokens = tokenizeSearch(query);
  if (!tokens.length) return cards.filter((card) => !card.deletedAt);
  return cards.filter((card) => {
    if (card.deletedAt) return false;
    return tokens.every((raw) => {
      const negated = raw.startsWith('-') && raw.length > 1;
      const token = negated ? raw.slice(1) : raw;
      const matched = matchesToken(card, token, state, history, now);
      return negated ? !matched : matched;
    });
  });
}
