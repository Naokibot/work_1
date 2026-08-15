import type { Rating, ReviewHistory, ReviewSession, ReviewStyle, StudyCard } from '../types.js';
import { ScratchPad } from '../canvas/pad.js';
import { scheduleReview } from '../scheduler/scheduler.js';
import { clearCurrentSession, getCard, getSettings, saveCard, saveCurrentSession, saveHistory, saveQueueItem } from '../storage/db.js';
import { deviceLabel, nowIso, shuffle, uid } from '../utils/core.js';

interface ReviewElements {
  screen: HTMLElement;
  close: HTMLButtonElement;
  progress: HTMLElement;
  timer: HTMLElement;
  favorite: HTMLButtonElement;
  number: HTMLElement;
  question: HTMLElement;
  tags: HTMLElement;
  showAnswer: HTMLButtonElement;
  answerPanel: HTMLElement;
  answer: HTMLElement;
  explanation: HTMLElement;
  choiceList: HTMLElement;
  ratingRow: HTMLElement;
  canvas: HTMLCanvasElement;
  pen: HTMLButtonElement;
  eraser: HTMLButtonElement;
  undo: HTMLButtonElement;
  redo: HTMLButtonElement;
  clear: HTMLButtonElement;
}

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
}

export class ReviewController {
  private readonly elements: ReviewElements;
  private readonly pad: ScratchPad;
  private session: ReviewSession | null = null;
  private currentCard: StudyCard | null = null;
  private questionStartedAt = 0;
  private responseMs = 0;
  private answeredCorrectly = true;
  private timerHandle = 0;
  private wakeLock: WakeLockSentinel | null = null;
  private readonly onFinished: () => Promise<void>;

  constructor(onFinished: () => Promise<void>) {
    this.onFinished = onFinished;
    this.elements = {
      screen: byId('review-screen'),
      close: byId<HTMLButtonElement>('review-close'),
      progress: byId('review-progress'),
      timer: byId('review-timer'),
      favorite: byId<HTMLButtonElement>('review-favorite'),
      number: byId('review-number'),
      question: byId('review-question'),
      tags: byId('review-tags'),
      showAnswer: byId<HTMLButtonElement>('show-answer'),
      answerPanel: byId('answer-panel'),
      answer: byId('review-answer'),
      explanation: byId('review-explanation'),
      choiceList: byId('choice-list'),
      ratingRow: byId('rating-row'),
      canvas: byId<HTMLCanvasElement>('scratch-pad'),
      pen: byId<HTMLButtonElement>('pad-pen'),
      eraser: byId<HTMLButtonElement>('pad-eraser'),
      undo: byId<HTMLButtonElement>('pad-undo'),
      redo: byId<HTMLButtonElement>('pad-redo'),
      clear: byId<HTMLButtonElement>('pad-clear')
    };
    this.pad = new ScratchPad(this.elements.canvas);
    this.bindEvents();
  }

  async start(session: ReviewSession): Promise<void> {
    this.session = session;
    await saveCurrentSession(session);
    this.elements.screen.hidden = false;
    document.body.style.overflow = 'hidden';
    await this.requestWakeLock();
    await this.loadCurrent();
  }

  async resume(session: ReviewSession): Promise<void> {
    await this.start(session);
  }

  private bindEvents(): void {
    this.elements.close.addEventListener('click', () => void this.exit());
    this.elements.showAnswer.addEventListener('click', () => this.revealSelfAnswer());
    this.elements.favorite.addEventListener('click', () => void this.toggleFavorite());
    this.elements.pen.addEventListener('click', () => this.setEraser(false));
    this.elements.eraser.addEventListener('click', () => this.setEraser(true));
    this.elements.undo.addEventListener('click', () => this.pad.undo());
    this.elements.redo.addEventListener('click', () => this.pad.redo());
    this.elements.clear.addEventListener('click', () => this.pad.clear());
    this.elements.ratingRow.querySelectorAll<HTMLButtonElement>('[data-rating]').forEach((button) => {
      button.addEventListener('click', () => {
        const rating = button.dataset.rating as Rating | undefined;
        if (rating) void this.grade(rating);
      });
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.session) void this.requestWakeLock();
    });
  }

  private setEraser(enabled: boolean): void {
    this.pad.setEraser(enabled);
    this.elements.pen.classList.toggle('is-active', !enabled);
    this.elements.eraser.classList.toggle('is-active', enabled);
  }

  private async requestWakeLock(): Promise<void> {
    if (!('wakeLock' in navigator)) return;
    try {
      this.wakeLock = await navigator.wakeLock.request('screen');
    } catch {
      this.wakeLock = null;
    }
  }

  private async loadCurrent(): Promise<void> {
    if (!this.session) return;
    while (this.session.cursor < this.session.queue.length) {
      const id = this.session.queue[this.session.cursor];
      if (!id) break;
      const card = await getCard(id);
      if (card && !card.deletedAt) {
        this.currentCard = card;
        this.renderCurrent(card, this.session.style);
        return;
      }
      this.session.cursor += 1;
    }
    await this.complete();
  }

  private renderCurrent(card: StudyCard, style: ReviewStyle): void {
    if (!this.session) return;
    this.pad.clear();
    this.setEraser(false);
    this.elements.number.textContent = card.cardNumber ? `No. ${card.cardNumber}` : '';
    this.elements.question.textContent = card.question;
    this.elements.tags.textContent = card.tags.join(' · ');
    this.elements.answer.textContent = card.answer;
    this.elements.explanation.textContent = card.explanation;
    this.elements.favorite.textContent = card.favorite ? '★' : '☆';
    this.elements.answerPanel.hidden = true;
    this.elements.ratingRow.hidden = true;
    this.elements.progress.textContent = `${Math.min(this.session.cursor + 1, this.session.queue.length)} / ${this.session.queue.length}`;
    this.answeredCorrectly = true;
    this.responseMs = 0;
    this.questionStartedAt = performance.now();
    this.startTimer();

    const choices = [card.answer, ...card.distractors].filter(Boolean);
    const useChoice = style === 'choice' && choices.length >= 2;
    this.elements.choiceList.hidden = !useChoice;
    this.elements.showAnswer.hidden = useChoice;
    this.elements.choiceList.replaceChildren();
    if (useChoice) {
      for (const choice of shuffle(choices)) {
        const choiceButton = document.createElement('button');
        choiceButton.type = 'button';
        choiceButton.className = 'choice-button';
        choiceButton.textContent = choice;
        choiceButton.addEventListener('click', () => this.chooseAnswer(choiceButton, choice));
        this.elements.choiceList.append(choiceButton);
      }
    }
  }

  private startTimer(): void {
    window.clearInterval(this.timerHandle);
    const update = () => {
      const elapsed = this.responseMs || performance.now() - this.questionStartedAt;
      const seconds = Math.max(0, Math.floor(elapsed / 1000));
      this.elements.timer.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    };
    update();
    this.timerHandle = window.setInterval(update, 250);
  }

  private stopTimer(): void {
    if (!this.responseMs) this.responseMs = Math.max(250, performance.now() - this.questionStartedAt);
    window.clearInterval(this.timerHandle);
  }

  private revealSelfAnswer(): void {
    this.stopTimer();
    this.elements.answerPanel.hidden = false;
    this.elements.showAnswer.hidden = true;
    this.elements.ratingRow.hidden = false;
    this.setRatingAvailability(true);
  }

  private chooseAnswer(button: HTMLButtonElement, choice: string): void {
    if (!this.currentCard || !this.elements.ratingRow.hidden) return;
    this.stopTimer();
    const correct = choice === this.currentCard.answer;
    this.answeredCorrectly = correct;
    for (const item of this.elements.choiceList.querySelectorAll<HTMLButtonElement>('button')) {
      item.disabled = true;
      if (item.textContent === this.currentCard.answer) item.classList.add('is-correct');
    }
    if (!correct) button.classList.add('is-wrong');
    this.elements.answerPanel.hidden = false;
    this.elements.ratingRow.hidden = false;
    this.setRatingAvailability(correct);
  }

  private setRatingAvailability(correct: boolean): void {
    this.elements.ratingRow.querySelectorAll<HTMLButtonElement>('[data-rating]').forEach((button) => {
      const rating = button.dataset.rating as Rating | undefined;
      button.disabled = !correct && rating !== 'again';
    });
  }

  private async grade(rating: Rating): Promise<void> {
    if (!this.session || !this.currentCard || this.elements.ratingRow.hidden) return;
    if (!this.answeredCorrectly && rating !== 'again') return;
    this.elements.ratingRow.hidden = true;
    const now = new Date();
    const result = scheduleReview(this.currentCard.schedule, rating, now);
    const isCorrect = this.session.style === 'choice' ? this.answeredCorrectly : rating !== 'again';
    const rawResponseMs = Math.min(this.responseMs || 1000, 60 * 60 * 1000);
    const settings = await getSettings();
    const includeTiming = rawResponseMs <= settings.idleTimeoutSeconds * 1000;
    const responseMs = includeTiming ? rawResponseMs : 0;
    const requestId = uid('req');
    const historyId = uid('history');
    const times = includeTiming ? [...this.currentCard.stats.lastTimesMs, rawResponseMs].slice(-10) : [...this.currentCard.stats.lastTimesMs];
    const fastestMs = includeTiming
      ? (this.currentCard.stats.fastestMs === null ? rawResponseMs : Math.min(this.currentCard.stats.fastestMs, rawResponseMs))
      : this.currentCard.stats.fastestMs;
    const updated: StudyCard = {
      ...this.currentCard,
      schedule: result.state,
      stats: {
        correct: this.currentCard.stats.correct + (isCorrect ? 1 : 0),
        incorrect: this.currentCard.stats.incorrect + (isCorrect ? 0 : 1),
        totalTimeMs: this.currentCard.stats.totalTimeMs + responseMs,
        fastestMs,
        lastTimesMs: times
      },
      updatedAt: now.toISOString(),
      version: this.currentCard.version + 1,
      lastRequestId: requestId
    };
    const history: ReviewHistory = {
      id: historyId,
      cardId: updated.id,
      cardNumberSnapshot: updated.cardNumber ?? '',
      questionSnapshot: updated.question,
      tags: [...updated.tags],
      rating,
      isCorrect,
      responseMs,
      reviewedAt: now.toISOString(),
      nextDue: result.state.due,
      device: deviceLabel(),
      requestId: uid('req')
    };

    await saveCard(updated);
    await saveQueueItem({ requestId, action: 'upsertCard', payload: { card: updated }, createdAt: nowIso(), attempts: 0 });
    await saveHistory(history);
    await saveQueueItem({ requestId: history.requestId, action: 'appendHistory', payload: { history }, createdAt: nowIso(), attempts: 0 });

    const shouldRetry = !isCorrect || rating === 'again';
    if (shouldRetry) {
      const insertAt = Math.min(this.session.cursor + 5, this.session.queue.length);
      const alreadyUpcoming = this.session.queue.slice(this.session.cursor + 1).includes(updated.id);
      if (!alreadyUpcoming) this.session.queue.splice(insertAt, 0, updated.id);
    }

    this.session.cursor += 1;
    this.session.answered += 1;
    await saveCurrentSession(this.session);
    await this.loadCurrent();
  }

  private async toggleFavorite(): Promise<void> {
    if (!this.currentCard) return;
    const requestId = uid('req');
    const updated: StudyCard = {
      ...this.currentCard,
      favorite: !this.currentCard.favorite,
      updatedAt: nowIso(),
      version: this.currentCard.version + 1,
      lastRequestId: requestId
    };
    this.currentCard = updated;
    this.elements.favorite.textContent = updated.favorite ? '★' : '☆';
    await saveCard(updated);
    await saveQueueItem({ requestId, action: 'upsertCard', payload: { card: updated }, createdAt: nowIso(), attempts: 0 });
  }

  private async exit(): Promise<void> {
    window.clearInterval(this.timerHandle);
    await this.wakeLock?.release().catch(() => undefined);
    this.wakeLock = null;
    this.elements.screen.hidden = true;
    document.body.style.overflow = '';
    this.pad.clear();
    await this.onFinished();
  }

  private async complete(): Promise<void> {
    await clearCurrentSession();
    this.session = null;
    await this.exit();
  }
}
