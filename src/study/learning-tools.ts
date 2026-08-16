export type StudyPresetName = 'learn' | 'test' | 'write' | 'spell' | 'wrong';

export interface StudyPreset {
  mode: 'deck' | 'exam' | 'wrong';
  style: 'self' | 'choice' | 'type';
  size: number;
  speech: boolean;
}

export interface PlannerCard {
  id: string;
  deckId?: string;
  deletedAt?: string | null;
  suspended?: boolean;
  schedule: {
    reps: number;
    due: string;
  };
  stats: {
    correct: number;
    incorrect: number;
  };
}

export interface PlannerHistory {
  cardId: string;
  isCorrect: boolean;
  reviewedAt: string;
}

export interface ExamPlan {
  valid: boolean;
  daysLeft: number;
  totalCards: number;
  unseenCards: number;
  weakCards: number;
  dueBeforeExam: number;
  workloadCards: number;
  dailyTarget: number;
  reviewedToday: number;
  progressToday: number;
  readiness: number;
}

const PRESETS: Record<StudyPresetName, StudyPreset> = {
  learn: { mode: 'deck', style: 'choice', size: 30, speech: false },
  test: { mode: 'exam', style: 'choice', size: 20, speech: false },
  write: { mode: 'deck', style: 'type', size: 30, speech: false },
  spell: { mode: 'deck', style: 'type', size: 30, speech: true },
  wrong: { mode: 'wrong', style: 'self', size: 30, speech: false }
};

export function studyPreset(name: StudyPresetName): StudyPreset {
  return { ...PRESETS[name] };
}

function localDayNumber(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000;
}

function sameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function parseExamDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, month, day, 23, 59, 59, 999);
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) return null;
  return date;
}

export function computeExamPlan(
  cards: PlannerCard[],
  history: PlannerHistory[],
  examDateValue: string,
  now = new Date()
): ExamPlan {
  const examDate = parseExamDate(examDateValue);
  const active = cards.filter((card) => !card.deletedAt && !card.suspended);
  if (!examDate || examDate.getTime() < new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) {
    return {
      valid: false,
      daysLeft: 0,
      totalCards: active.length,
      unseenCards: 0,
      weakCards: 0,
      dueBeforeExam: 0,
      workloadCards: 0,
      dailyTarget: 0,
      reviewedToday: 0,
      progressToday: 0,
      readiness: active.length ? 0 : 100
    };
  }

  const latest = new Map<string, PlannerHistory>();
  for (const item of [...history].sort((a, b) => a.reviewedAt.localeCompare(b.reviewedAt))) latest.set(item.cardId, item);

  const unseen = new Set<string>();
  const weak = new Set<string>();
  const dueBeforeExam = new Set<string>();
  const workload = new Set<string>();

  for (const card of active) {
    const attempts = card.stats.correct + card.stats.incorrect;
    const accuracy = attempts ? card.stats.correct / attempts : 0;
    const latestReview = latest.get(card.id);
    const dueAt = Date.parse(card.schedule.due);

    if (card.schedule.reps === 0) unseen.add(card.id);
    if ((attempts > 0 && accuracy < 0.8) || latestReview?.isCorrect === false) weak.add(card.id);
    if (card.schedule.reps > 0 && Number.isFinite(dueAt) && dueAt <= examDate.getTime()) dueBeforeExam.add(card.id);
  }

  for (const id of unseen) workload.add(id);
  for (const id of weak) workload.add(id);
  for (const id of dueBeforeExam) workload.add(id);

  const daysLeft = Math.max(1, localDayNumber(examDate) - localDayNumber(now) + 1);
  const dailyTarget = workload.size ? Math.max(1, Math.ceil(workload.size / daysLeft)) : 0;
  const activeIds = new Set(active.map((card) => card.id));
  const reviewedToday = new Set(
    history
      .filter((item) => activeIds.has(item.cardId) && sameLocalDay(new Date(item.reviewedAt), now))
      .map((item) => item.cardId)
  ).size;
  const progressToday = dailyTarget ? Math.min(1, reviewedToday / dailyTarget) : 1;
  const readiness = active.length ? Math.max(0, Math.min(100, Math.round((1 - workload.size / active.length) * 100))) : 100;

  return {
    valid: true,
    daysLeft,
    totalCards: active.length,
    unseenCards: unseen.size,
    weakCards: weak.size,
    dueBeforeExam: dueBeforeExam.size,
    workloadCards: workload.size,
    dailyTarget,
    reviewedToday,
    progressToday,
    readiness
  };
}
