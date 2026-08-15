import type {
  AnkiState,
  DeckDefinition,
  DeckOptionsPreset,
  NoteTypeDefinition,
  StudyCard,
  StudyNote
} from '../types.js';
import { FSRS6_DEFAULT_PARAMETERS, initialSchedule } from '../scheduler/scheduler.js';
import { nowIso, uid } from '../utils/core.js';

export const DEFAULT_PROFILE_ID = 'profile_default';
export const DEFAULT_DECK_ID = 'deck_default';
export const DEFAULT_PRESET_ID = 'preset_default';
export const BASIC_NOTE_TYPE_ID = 'notetype_basic';
export const BASIC_REVERSE_NOTE_TYPE_ID = 'notetype_basic_reverse';
export const BASIC_OPTIONAL_REVERSE_NOTE_TYPE_ID = 'notetype_basic_optional_reverse';
export const TYPE_ANSWER_NOTE_TYPE_ID = 'notetype_type_answer';
export const CLOZE_NOTE_TYPE_ID = 'notetype_cloze';
export const IMAGE_OCCLUSION_NOTE_TYPE_ID = 'notetype_image_occlusion';

function builtinNoteType(
  id: string,
  name: string,
  fields: string[],
  templates: Array<{ id: string; name: string; front: string; back: string }>,
  kind: NoteTypeDefinition['kind'] = 'standard'
): NoteTypeDefinition {
  const timestamp = nowIso();
  return {
    id,
    name,
    kind,
    fields: fields.map((field) => ({ id: `${id}_${field.toLowerCase().replace(/\s+/g, '_')}`, name: field })),
    templates,
    css: '.card { font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-size: 20px; text-align: center; } .cloze { font-weight: 700; }',
    builtin: true,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

export function defaultPreset(): DeckOptionsPreset {
  return {
    id: DEFAULT_PRESET_ID,
    name: 'Default',
    dailyNewLimit: 20,
    dailyReviewLimit: 200,
    learningStepsMinutes: [1, 10],
    relearningStepsMinutes: [10],
    desiredRetention: 0.9,
    fsrsParameters: [...FSRS6_DEFAULT_PARAMETERS],
    historicalRetention: 0.9,
    leechThreshold: 8,
    leechAction: 'suspend',
    maximumIntervalDays: 36500,
    buryNewSiblings: true,
    buryReviewSiblings: true,
    buryInterdayLearningSiblings: true,
    newGatherOrder: 'deck',
    reviewOrder: 'due',
    newReviewOrder: 'mix',
    showTimer: true,
    maximumAnswerSeconds: 60,
    autoAdvanceSeconds: 0,
    autoplayAudio: true,
    replayQuestionAudio: false,
    easyDays: [1, 1, 1, 1, 1, 1, 1]
  };
}

export function defaultDeck(): DeckDefinition {
  const timestamp = nowIso();
  return {
    id: DEFAULT_DECK_ID,
    profileId: DEFAULT_PROFILE_ID,
    name: 'Default',
    description: '',
    presetId: DEFAULT_PRESET_ID,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

export function defaultNoteTypes(): NoteTypeDefinition[] {
  return [
    builtinNoteType(
      BASIC_NOTE_TYPE_ID,
      'Basic',
      ['Front', 'Back', 'Extra'],
      [{ id: 'template_basic_forward', name: 'Card 1', front: '{{Front}}', back: '{{FrontSide}}<hr id="answer">{{Back}}<div class="extra">{{Extra}}</div>' }]
    ),
    builtinNoteType(
      BASIC_REVERSE_NOTE_TYPE_ID,
      'Basic (and reversed card)',
      ['Front', 'Back', 'Extra'],
      [
        { id: 'template_reverse_forward', name: 'Forward', front: '{{Front}}', back: '{{FrontSide}}<hr id="answer">{{Back}}<div class="extra">{{Extra}}</div>' },
        { id: 'template_reverse_backward', name: 'Reverse', front: '{{Back}}', back: '{{FrontSide}}<hr id="answer">{{Front}}<div class="extra">{{Extra}}</div>' }
      ]
    ),
    builtinNoteType(
      BASIC_OPTIONAL_REVERSE_NOTE_TYPE_ID,
      'Basic (optional reversed card)',
      ['Front', 'Back', 'Add Reverse', 'Extra'],
      [
        { id: 'template_optional_forward', name: 'Forward', front: '{{Front}}', back: '{{FrontSide}}<hr id="answer">{{Back}}<div class="extra">{{Extra}}</div>' },
        { id: 'template_optional_backward', name: 'Reverse', front: '{{#Add Reverse}}{{Back}}{{/Add Reverse}}', back: '{{FrontSide}}<hr id="answer">{{Front}}<div class="extra">{{Extra}}</div>' }
      ]
    ),
    builtinNoteType(
      TYPE_ANSWER_NOTE_TYPE_ID,
      'Basic (type in the answer)',
      ['Front', 'Back', 'Extra'],
      [{ id: 'template_type_answer', name: 'Card 1', front: '{{Front}}<div>{{type:Back}}</div>', back: '{{FrontSide}}<hr id="answer">{{Back}}<div class="extra">{{Extra}}</div>' }]
    ),
    builtinNoteType(
      CLOZE_NOTE_TYPE_ID,
      'Cloze',
      ['Text', 'Back Extra'],
      [{ id: 'template_cloze', name: 'Cloze', front: '{{cloze:Text}}', back: '{{cloze:Text}}<hr id="answer">{{Back Extra}}' }],
      'cloze'
    ),
    builtinNoteType(
      IMAGE_OCCLUSION_NOTE_TYPE_ID,
      'Image Occlusion',
      ['Image', 'Masks', 'Extra'],
      [{ id: 'template_image_occlusion', name: 'Image Occlusion', front: '{{Image}}', back: '{{Image}}<hr id="answer">{{Extra}}' }],
      'image-occlusion'
    )
  ];
}

export function createDefaultAnkiState(): AnkiState {
  const timestamp = nowIso();
  return {
    id: 'anki',
    version: 1,
    activeProfileId: DEFAULT_PROFILE_ID,
    profiles: [{ id: DEFAULT_PROFILE_ID, name: 'Default', createdAt: timestamp }],
    decks: [defaultDeck()],
    presets: [defaultPreset()],
    noteTypes: defaultNoteTypes(),
    notes: [],
    filteredDecks: [],
    savedSearches: [],
    flagNames: ['None', 'Red', 'Orange', 'Green', 'Blue', 'Pink', 'Turquoise', 'Purple'],
    undo: [],
    lastAutomaticBackupAt: '1970-01-01T00:00:00.000Z'
  };
}

export function normalizeAnkiState(stored?: Partial<AnkiState>): AnkiState {
  const defaults = createDefaultAnkiState();
  if (!stored) return defaults;
  const profiles = Array.isArray(stored.profiles) && stored.profiles.length ? stored.profiles : defaults.profiles;
  const presets = Array.isArray(stored.presets) && stored.presets.length ? stored.presets : defaults.presets;
  const decks = Array.isArray(stored.decks) && stored.decks.length ? stored.decks : defaults.decks;
  const noteTypes = [...defaults.noteTypes];
  for (const type of stored.noteTypes ?? []) {
    const index = noteTypes.findIndex((item) => item.id === type.id);
    if (index >= 0) noteTypes[index] = { ...noteTypes[index], ...type };
    else noteTypes.push(type);
  }
  return {
    ...defaults,
    ...stored,
    profiles,
    presets,
    decks,
    noteTypes,
    notes: Array.isArray(stored.notes) ? stored.notes : [],
    filteredDecks: Array.isArray(stored.filteredDecks) ? stored.filteredDecks : [],
    savedSearches: Array.isArray(stored.savedSearches) ? stored.savedSearches : [],
    flagNames: Array.isArray(stored.flagNames) && stored.flagNames.length === 8 ? stored.flagNames : defaults.flagNames,
    undo: Array.isArray(stored.undo) ? stored.undo.slice(-20) : [],
    activeProfileId: profiles.some((profile) => profile.id === stored.activeProfileId) ? String(stored.activeProfileId) : profiles[0]?.id ?? DEFAULT_PROFILE_ID
  };
}

export function normalizeCardMetadata(card: StudyCard): StudyCard {
  const now = nowIso();
  return {
    ...card,
    profileId: card.profileId ?? DEFAULT_PROFILE_ID,
    deckId: card.deckId ?? DEFAULT_DECK_ID,
    noteId: card.noteId ?? `legacy_note_${card.id}`,
    noteTypeId: card.noteTypeId ?? BASIC_NOTE_TYPE_ID,
    templateId: card.templateId ?? 'template_basic_forward',
    queue: card.queue ?? (card.schedule.reps === 0 ? 'new' : 'review'),
    position: Number.isFinite(card.position) ? card.position : Number(new Date(card.createdAt || now).getTime()),
    flag: card.flag ?? 0,
    suspended: Boolean(card.suspended),
    buriedUntil: card.buriedUntil ?? null,
    marked: card.marked ?? card.favorite ?? false,
    siblingGroup: card.siblingGroup ?? card.noteId ?? `legacy_note_${card.id}`,
    filteredDeckId: card.filteredDeckId ?? null,
    customData: card.customData ?? {}
  };
}

export function legacyCardToNote(card: StudyCard): StudyNote {
  const normalized = normalizeCardMetadata(card);
  return {
    id: normalized.noteId ?? uid('note'),
    guid: normalized.noteId ?? uid('guid'),
    profileId: normalized.profileId ?? DEFAULT_PROFILE_ID,
    deckId: normalized.deckId ?? DEFAULT_DECK_ID,
    noteTypeId: normalized.noteTypeId ?? BASIC_NOTE_TYPE_ID,
    fields: {
      Front: normalized.question,
      Back: normalized.answer,
      Extra: normalized.explanation
    },
    tags: [...normalized.tags],
    createdAt: normalized.createdAt,
    updatedAt: normalized.updatedAt,
    deletedAt: normalized.deletedAt
  };
}

export function emptyCard(now = new Date()): StudyCard {
  const timestamp = now.toISOString();
  return {
    id: uid('card'),
    question: '',
    answer: '',
    distractors: [],
    explanation: '',
    tags: [],
    favorite: false,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
    schedule: initialSchedule(now),
    stats: { correct: 0, incorrect: 0, totalTimeMs: 0, fastestMs: null, lastTimesMs: [] },
    version: 1,
    profileId: DEFAULT_PROFILE_ID,
    deckId: DEFAULT_DECK_ID,
    queue: 'new',
    position: Date.now(),
    flag: 0,
    suspended: false,
    buriedUntil: null,
    marked: false,
    filteredDeckId: null,
    customData: {}
  };
}
