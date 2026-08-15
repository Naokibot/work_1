import type {
  AnkiState,
  CardTemplateDefinition,
  DeckDefinition,
  ImageOcclusionMask,
  NoteTypeDefinition,
  StudyCard,
  StudyNote
} from '../types.js';
import { emptyCard } from './defaults.js';
import { legacyMasksFromJson, parseNativeOcclusions } from './image-occlusion.js';
import { nowIso, uid } from '../utils/core.js';

export interface RenderContext {
  note: StudyNote;
  noteType: NoteTypeDefinition;
  deck: DeckDefinition;
  template: CardTemplateDefinition;
  cardFlag?: number;
  clozeIndex?: number;
  frontSide?: string;
}

export interface RenderResult {
  html: string;
  typedAnswer?: string;
}

export function stripHtml(value: string): string {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char] ?? char));
}

function fieldValue(note: StudyNote, name: string): string {
  const direct = note.fields[name];
  if (direct !== undefined) return direct;
  const key = Object.keys(note.fields).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key ? note.fields[key] ?? '' : '';
}

function replaceConditionals(template: string, note: StudyNote): string {
  let output = template;
  for (let pass = 0; pass < 12; pass += 1) {
    const before = output;
    output = output.replace(/\{\{#([^{}]+)}}([\s\S]*?)\{\{\/\1}}/g, (_match, name: string, body: string) => fieldValue(note, name).trim() ? body : '');
    output = output.replace(/\{\{\^([^{}]+)}}([\s\S]*?)\{\{\/\1}}/g, (_match, name: string, body: string) => fieldValue(note, name).trim() ? '' : body);
    if (before === output) break;
  }
  return output;
}

function rubyParts(value: string): Array<{ base: string; ruby?: string }> {
  const parts: Array<{ base: string; ruby?: string }> = [];
  const regex = /([^\s\[]+)\[([^\]]+)]/g;
  let cursor = 0;
  for (const match of value.matchAll(regex)) {
    const index = match.index ?? 0;
    if (index > cursor) parts.push({ base: value.slice(cursor, index) });
    parts.push({ base: match[1] ?? '', ruby: match[2] ?? '' });
    cursor = index + match[0].length;
  }
  if (cursor < value.length) parts.push({ base: value.slice(cursor) });
  return parts;
}

function furigana(value: string): string {
  return rubyParts(value).map((part) => part.ruby ? `<ruby>${escapeHtml(part.base)}<rt>${escapeHtml(part.ruby)}</rt></ruby>` : escapeHtml(part.base)).join('');
}

function kanaOnly(value: string): string {
  return rubyParts(value).map((part) => part.ruby ?? part.base).join('');
}

function kanjiOnly(value: string): string {
  return rubyParts(value).map((part) => part.base).join('');
}

interface ClozePart {
  index: number;
  text: string;
  hint: string;
  raw: string;
}

export function parseClozes(text: string): ClozePart[] {
  const result: ClozePart[] = [];
  const regex = /\{\{c(\d+)::([\s\S]*?)(?:::(.*?))?}}/g;
  for (const match of text.matchAll(regex)) {
    result.push({
      index: Number(match[1]),
      text: match[2] ?? '',
      hint: match[3] ?? '',
      raw: match[0]
    });
  }
  return result.filter((item) => Number.isFinite(item.index) && item.index > 0);
}

export function clozeIndexes(text: string): number[] {
  return [...new Set(parseClozes(text).map((item) => item.index))].sort((a, b) => a - b);
}

function renderClozeText(text: string, target: number, answerSide: boolean): string {
  let output = text;
  for (const cloze of parseClozes(text)) {
    let replacement: string;
    if (cloze.index !== target) replacement = cloze.text;
    else if (answerSide) replacement = `<span class="cloze">${cloze.text}</span>`;
    else replacement = `<span class="cloze">[${cloze.hint.trim() || '…'}]</span>`;
    output = output.replace(cloze.raw, replacement);
  }
  return output;
}

function specialField(name: string, context: RenderContext): string | undefined {
  if (name === 'Tags') return context.note.tags.join(' ');
  if (name === 'Type') return context.noteType.name;
  if (name === 'Deck') return context.deck.name;
  if (name === 'Subdeck') return context.deck.name.split('::').at(-1) ?? context.deck.name;
  if (name === 'Card') return context.template.name;
  if (name === 'CardFlag') return String(context.cardFlag ?? 0);
  if (name === 'FrontSide') return context.frontSide ?? '';
  return undefined;
}

export function renderTemplate(template: string, context: RenderContext, answerSide = false): RenderResult {
  let typedAnswer: string | undefined;
  let output = replaceConditionals(template, context.note);

  output = output.replace(/\[anki:tts\s+lang=([^\]\s]+)[^\]]*]([\s\S]*?)\[\/anki:tts]/gi, (_match, lang: string, body: string) => {
    return `<span class="anki-tts" data-lang="${escapeHtml(lang)}">${body}</span>`;
  });

  output = output.replace(/\{\{tts\s+([^:} ]+)(?:\s+[^:]*)?:([^}]+)}}/gi, (_match, lang: string, fieldName: string) => {
    const value = fieldValue(context.note, fieldName.trim());
    return value ? `<span class="anki-tts" data-lang="${escapeHtml(lang)}">${value}</span>` : '';
  });

  output = output.replace(/\{\{([^{}]+)}}/g, (_match, expression: string) => {
    const parts = expression.split(':');
    const first = parts[0]?.trim() ?? '';
    const rest = parts.slice(1).join(':').trim();
    const special = specialField(expression.trim(), context);
    if (special !== undefined) return special;

    if (first === 'type') {
      const actualField = parts.at(-1)?.trim() ?? rest;
      typedAnswer = fieldValue(context.note, actualField);
      return '<span class="type-answer-placeholder" aria-hidden="true"></span>';
    }
    if (first === 'text') return escapeHtml(stripHtml(fieldValue(context.note, rest)));
    if (first === 'hint') {
      const value = fieldValue(context.note, rest);
      return value ? `<details class="hint"><summary>ヒント</summary>${value}</details>` : '';
    }
    if (first === 'furigana') return furigana(fieldValue(context.note, rest));
    if (first === 'kana') return escapeHtml(kanaOnly(fieldValue(context.note, rest)));
    if (first === 'kanji') return escapeHtml(kanjiOnly(fieldValue(context.note, rest)));
    if (first === 'cloze') {
      const value = fieldValue(context.note, rest);
      return renderClozeText(value, context.clozeIndex ?? 1, answerSide);
    }
    const field = fieldValue(context.note, expression.trim());
    return field;
  });

  output=output.replace(/\[latex\]([\s\S]*?)\[\/latex\]/gi,(_m,body:string)=>`\\(${body}\\)`);
  return { html: output.trim(), typedAnswer };
}

function masksFromNote(note: StudyNote): ImageOcclusionMask[] {
  try {
    const parsed = JSON.parse(fieldValue(note, 'Masks')) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const mask = item as Partial<ImageOcclusionMask>;
      if (!mask.id || !Number.isFinite(mask.x) || !Number.isFinite(mask.y) || !Number.isFinite(mask.width) || !Number.isFinite(mask.height)) return [];
      return [{
        id: String(mask.id),
        x: Math.max(0, Math.min(100, Number(mask.x))),
        y: Math.max(0, Math.min(100, Number(mask.y))),
        width: Math.max(0.2, Math.min(100, Number(mask.width))),
        height: Math.max(0.2, Math.min(100, Number(mask.height))),
        answer: String(mask.answer ?? '')
      }];
    });
  } catch {
    return [];
  }
}

function makeCard(note: StudyNote, noteType: NoteTypeDefinition, deck: DeckDefinition, template: CardTemplateDefinition, key: string, position: number, existing?: StudyCard): StudyCard {
  const base = existing ? { ...existing } : emptyCard();
  const front = renderTemplate(template.front, { note, noteType, deck, template }, false);
  const back = renderTemplate(template.back, { note, noteType, deck, template, frontSide: front.html }, true);
  const now = nowIso();
  return {
    ...base,
    id: existing?.id ?? uid('card'),
    profileId: note.profileId,
    deckId: template.deckOverrideId || note.deckId,
    noteId: note.id,
    noteTypeId: noteType.id,
    templateId: key,
    siblingGroup: note.id,
    question: front.html,
    answer: back.html,
    typedAnswer: front.typedAnswer ?? back.typedAnswer,
    explanation: fieldValue(note, 'Extra') || fieldValue(note, 'Back Extra'),
    distractors: [fieldValue(note, 'Distractor1'), fieldValue(note, 'Distractor2'), fieldValue(note, 'Distractor3')].filter(Boolean),
    tags: [...note.tags],
    favorite: note.tags.includes('marked') || base.favorite,
    marked: note.tags.includes('marked') || base.marked,
    position: existing?.position ?? position,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    deletedAt: note.deletedAt,
    version: existing ? existing.version + 1 : 1
  };
}

export function generateCardsForNote(note: StudyNote, state: AnkiState, existingCards: StudyCard[] = []): StudyCard[] {
  const noteType = state.noteTypes.find((item) => item.id === note.noteTypeId);
  const deck = state.decks.find((item) => item.id === note.deckId) ?? state.decks[0];
  if (!noteType || !deck || note.deletedAt) return [];
  const byTemplate = new Map(existingCards.filter((card) => card.noteId === note.id).map((card) => [card.templateId ?? '', card]));
  const positionBase = new Date(note.createdAt).getTime();

  if (noteType.kind === 'cloze') {
    const textField = noteType.fields.find((field) => field.name.toLowerCase() === 'text')?.name ?? 'Text';
    const indices = clozeIndexes(fieldValue(note, textField));
    const template = noteType.templates[0];
    if (!template) return [];
    return indices.map((index, offset) => {
      const key = `${template.id}:c${index}`;
      const existing = byTemplate.get(key);
      const base = makeCard(note, noteType, deck, template, key, positionBase + offset, existing);
      const front = renderTemplate(template.front, { note, noteType, deck, template, clozeIndex: index }, false);
      const back = renderTemplate(template.back, { note, noteType, deck, template, clozeIndex: index, frontSide: front.html }, true);
      const typedMatch = fieldValue(note, textField);
      const target = parseClozes(typedMatch).find((item) => item.index === index)?.text ?? '';
      return { ...base, question: front.html, answer: back.html, typedAnswer: front.typedAnswer ? target : undefined };
    });
  }

  if (noteType.kind === 'image-occlusion') {
    const image = fieldValue(note, 'Image');
    const header = fieldValue(note, 'Header');
    const extra = fieldValue(note, 'Back Extra') || fieldValue(note, 'Extra');
    const comments = fieldValue(note, 'Comments');
    const nativeGroups = parseNativeOcclusions(fieldValue(note, 'Occlusions'));
    const legacyMasks = legacyMasksFromJson(fieldValue(note, 'Masks'));
    const groups = nativeGroups.length
      ? nativeGroups
      : legacyMasks.map((mask, index) => ({ ordinal: index + 1, masks: [mask] }));
    const output: StudyCard[] = [];
    const template = noteType.templates[0];
    if (!template) return output;
    groups.forEach((group, offset) => {
      const active = group.masks.find((mask) => !mask.occludeInactive) ?? group.masks[0];
      if (!active) return;
      const key = template.id + ':c' + group.ordinal;
      const existing = byTemplate.get(key) ?? byTemplate.get(template.id + ':mask:' + active.id);
      const base = makeCard(note, noteType, deck, template, key, positionBase + offset, existing);
      const hideAll = group.masks.some((mask) => mask.occludeInactive);
      output.push({
        ...base,
        question: header ? header + '<div class="io-prompt">画像の隠された部分を答えてください。</div>' : '画像の隠された部分を答えてください。',
        answer: active.text || active.answer || comments || extra || '画像の隠された部分',
        explanation: [extra, comments].filter(Boolean).join('<br>'),
        imageOcclusion: {
          imageDataUrl: image,
          mask: active,
          masks: group.masks,
          mode: hideAll ? 'hide-all-guess-one' : 'hide-one-guess-one',
          activeOrdinal: group.ordinal,
          header,
          comments,
          extra
        }
      });
    });
    return output;
  }

  const generated: StudyCard[] = [];
  noteType.templates.forEach((template, index) => {
    const rendered = renderTemplate(template.front, { note, noteType, deck, template }, false);
    if (!stripHtml(rendered.html)) return;
    const key = template.id;
    generated.push(makeCard(note, noteType, deck, template, key, positionBase + index, byTemplate.get(key)));
  });
  return generated;
}

export function findEmptyGeneratedCards(note: StudyNote, state: AnkiState, cards: StudyCard[]): StudyCard[] {
  const valid = new Set(generateCardsForNote(note, state, cards).map((card) => card.templateId));
  return cards.filter((card) => card.noteId === note.id && !valid.has(card.templateId));
}
