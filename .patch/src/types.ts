export type Rating = 'again' | 'hard' | 'good' | 'easy';
export type ReviewMode = 'due' | 'new' | 'weak' | 'wrong' | 'favorite' | 'random' | 'tag' | 'exam';
export type ReviewStyle = 'self' | 'choice';

export interface ScheduleState {
  stability: number;
  difficulty: number;
  due: string;
  reps: number;
  lapses: number;
  streak: number;
  lastReview: string | null;
}

export interface CardStats {
  correct: number;
  incorrect: number;
  totalTimeMs: number;
  fastestMs: number | null;
  lastTimesMs: number[];
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
}

export interface SyncConflict {
  id: string;
  requestId: string;
  cardId: string;
  createdAt: string;
  message: string;
}
