import type { StudyCard } from '../types.js';
import { getAnkiState, getCards } from '../storage/db.js';

const FIELD_NAME = '__CardNumber';
const MAX_CHOICES = 300;

function numericCardNumber(card: StudyCard): number | null {
  const raw = (card.cardNumber ?? '').trim();
  if (!/^\d+$/u.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function cardNumberChoices(cards: StudyCard[], profileId: string): { defaultNumber: number; choices: number[] } {
  const used = new Set(
    cards
      .filter((card) => !card.deletedAt && (card.profileId ?? 'profile_default') === profileId)
      .map(numericCardNumber)
      .filter((value): value is number => value !== null)
  );
  const maximum = used.size ? Math.max(...used) : 0;
  const defaultNumber = maximum + 1;
  const choices: number[] = [];
  const upper = Math.max(defaultNumber + 100, 300);
  for (let value = 1; value <= upper && choices.length < MAX_CHOICES; value += 1) {
    if (!used.has(value)) choices.push(value);
  }
  if (!choices.includes(defaultNumber)) choices.push(defaultNumber);
  choices.sort((a, b) => a - b);
  return { defaultNumber, choices };
}

function ensureField(): HTMLSelectElement | null {
  const fields = document.getElementById('note-fields');
  if (!fields) return null;
  const existing = fields.querySelector<HTMLSelectElement>(`select[data-field="${FIELD_NAME}"]`);
  if (existing) return existing;

  const label = document.createElement('label');
  label.className = 'note-field-wrap card-number-field';
  label.textContent = 'カード番号';

  const select = document.createElement('select');
  select.className = 'note-field card-number-input';
  select.dataset.field = FIELD_NAME;
  select.setAttribute('aria-label', 'カード番号');

  const help = document.createElement('small');
  help.className = 'help';
  help.textContent = '未使用の番号だけを表示します。初期値は作成順の次の番号です。';

  label.append(select, help);
  fields.prepend(label);
  return select;
}

export async function refreshCardNumberOptions(): Promise<void> {
  const select = ensureField();
  if (!select) return;
  const [cards, state] = await Promise.all([getCards(false, true), getAnkiState()]);
  const { defaultNumber, choices } = cardNumberChoices(cards, state.activeProfileId);
  select.replaceChildren(...choices.map((value) => new Option(value === defaultNumber ? `${value}（次の番号）` : String(value), String(value), false, value === defaultNumber)));
  select.value = String(defaultNumber);
}

export function installCardNumberField(): void {
  const fields = document.getElementById('note-fields');
  if (!fields) return;
  void refreshCardNumberOptions();
  const observer = new MutationObserver(() => { void refreshCardNumberOptions(); });
  observer.observe(fields, { childList: true });
}
