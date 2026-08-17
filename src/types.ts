export type Rating = 'again' | 'hard' | 'good' | 'easy';
export type ReviewMode = 'due' | 'new' | 'weak' | 'wrong' | 'favorite' | 'random' | 'tag' | 'exam' | 'deck' | 'filtered';
export type ReviewStyle = 'self' | 'choice' | 'type' | 'spell';
export type CardQueue = 'new' | 'learning' | 'review' | 'relearning';
export type CardFlag = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type NoteKind = 'standard' | 'cloze' | 'image-occlusion';

export interface ScheduleState {
  stability: number;
  difficulty: number;
  due: string;
  reps: number;
  lapses: number;
  streak: number;
  lastReview: string | null;
  learningStep?: number | null;
  relearning?: boolean;
}

export interface CardStats {
  correct: number;
  incorrect: number;
  totalTimeMs: number;
  fastestMs: number | null;
  lastTimesMs: number[];
}

export interface ImageOcclusionMask {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  answer: string;
}

export interface ImageOcclusionCardData {
  imageDataUrl: string;
  mask: ImageOcclusionMask;
  extra?: string;
}

export interface StudyCard {
  id: string;
  cardNumber?: string;
  question: string;
  answer: string;
  distractors: string[];
  explanation: string;
  tags: string[];
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  schedule: ScheduleState;
  stats: CardStats;
  version: number;
  lastRequestId?: string;

  profileId?: string;
  deckId?: string;
  noteId?: string;
  noteTypeId?: string;
  templateId?: string;
  queue?: CardQueue;
  position?: number;
  flag?: CardFlag;
  suspended?: boolean;
  buriedUntil?: string | null;
  marked?: boolean;
  typedAnswer?: string;
  siblingGroup?: string;
  originalDeckId?: string;
  filteredDeckId?: string | null;
  customData?: Record<string, string | number | boolean>;
  imageOcclusion?: ImageOcclusionCardData;
}

export interface ReviewHistory {
  id: string;
  cardId: string;
  cardNumberSnapshot?: string;
  questionSnapshot: string;
  tags: string[];
  rating: Rating;
  isCorrect: boolean;
  responseMs: number;
  reviewedAt: string;
  nextDue: string;
  device: string;
  requestId: string;
}

export interface FieldDefinition {
  id: string;
  name: string;
  rtl?: boolean;
  sticky?: boolean;
  font?: string;
  fontSize?: number;
}

export interface CardTemplateDefinition {
  id: string;
  name: string;
  front: string;
  back: string;
  deckOverrideId?: string;
}

export interface NoteTypeDefinition {
  id: string;
  name: string;
  kind: NoteKind;
  fields: FieldDefinition[];
  templates: CardTemplateDefinition[];
  css: string;
  builtin?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StudyNote {
  id: string;
  guid: string;
  profileId: string;
  deckId: string;
  noteTypeId: string;
  fields: Record<string, string>;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export type GatherOrder = 'deck' | 'ascending' | 'descending' | 'random';
export type ReviewOrder = 'due' | 'overdue' | 'random' | 'difficulty' | 'retrievability';
export type NewReviewOrder = 'before' | 'after' | 'mix';

export interface DeckOptionsPreset {
  id: string;
  name: string;
  dailyNewLimit: number;
  dailyReviewLimit: number;
  learningStepsMinutes: number[];
  relearningStepsMinutes: number[];
  desiredRetention: number;
  fsrsParameters?: number[];
  historicalRetention?: number;
  leechThreshold?: number;
  leechAction?: 'suspend' | 'tag';
  maximumIntervalDays: number;
  buryNewSiblings: boolean;
  buryReviewSiblings: boolean;
  buryInterdayLearningSiblings: boolean;
  newGatherOrder: GatherOrder;
  reviewOrder: ReviewOrder;
  newReviewOrder: NewReviewOrder;
  showTimer: boolean;
  maximumAnswerSeconds: number;
  autoAdvanceSeconds: number;
  autoplayAudio: boolean;
  replayQuestionAudio: boolean;
  easyDays: number[];
}

export interface DeckDefinition {
  id: string;
  profileId: string;
  name: string;
  description: string;
  presetId: string;
  createdAt: string;
  updatedAt: string;
}

export interface FilteredDeckDefinition {
  id: string;
  profileId: string;
  name: string;
  search: string;
  limit: number;
  order: 'due' | 'random' | 'added' | 'difficulty';
  reschedule: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProfileDefinition {
  id: string;
  name: string;
  createdAt: string;
}

export interface SavedSearchDefinition {
  id: string;
  name: string;
  query: string;
}

export interface UndoEntry {
  id: string;
  label: string;
  createdAt: string;
  cards: StudyCard[];
}

export interface AnkiState {
  id: 'anki';
  version: 1;
  activeProfileId: string;
  profiles: ProfileDefinition[];
  decks: DeckDefinition[];
  presets: DeckOptionsPreset[];
  noteTypes: NoteTypeDefinition[];
  notes: StudyNote[];
  filteredDecks: FilteredDeckDefinition[];
  savedSearches: SavedSearchDefinition[];
  flagNames: string[];
  undo: UndoEntry[];
  lastAutomaticBackupAt: string;
}

export interface CollectionSnapshot {
  id: string;
  createdAt: string;
  reason: 'automatic' | 'manual' | 'undo';
  label: string;
  cards: StudyCard[];
  history: ReviewHistory[];
  anki: AnkiState;
}

export type SyncAction = 'upsertCard' | 'deleteCard' | 'appendHistory';

export interface SyncQueueItem {
  requestId: string;
  action: SyncAction;
  payload: Record<string, unknown>;
  createdAt: string;
  attempts: number;
}

export interface AppSettings {
  id: 'app';
  gasUrl: string;
  syncSecret: string;
  lastSyncAt: string;
  dailyNewLimit: number;
  dailyReviewLimit: number;
  idleTimeoutSeconds: number;
  showRemainingCount?: boolean;
  showNextReviewTime?: boolean;
  spacebarAnswers?: boolean;
  interruptAudioOnAnswer?: boolean;
  autoSync?: boolean;
}

export interface ReviewSession {
  id: 'current';
  mode: ReviewMode;
  style: ReviewStyle;
  queue: string[];
  cursor: number;
  answered: number;
  tag: string;
  examSize: number;
  startedAt: string;
  deckId?: string;
  filteredDeckId?: string;
}

export interface SyncConflict {
  id: string;
  requestId: string;
  cardId: string;
  createdAt: string;
  message: string;
}