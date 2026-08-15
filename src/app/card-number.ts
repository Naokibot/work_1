const FIELD_NAME = '__CardNumber';

function ensureField(): void {
  const fields = document.getElementById('note-fields');
  if (!fields || fields.querySelector(`[data-field="${FIELD_NAME}"]`)) return;

  const label = document.createElement('label');
  label.className = 'note-field-wrap card-number-field';
  label.textContent = 'カード番号（任意）';

  const input = document.createElement('textarea');
  input.className = 'note-field card-number-input';
  input.rows = 1;
  input.maxLength = 64;
  input.dataset.field = FIELD_NAME;
  input.autocomplete = 'off';
  input.placeholder = '例: 001 / A-12 / 英単語-25';
  input.setAttribute('aria-label', 'カード番号（任意）');

  label.append(input);
  fields.prepend(label);
}

export function installCardNumberField(): void {
  const fields = document.getElementById('note-fields');
  if (!fields) return;
  ensureField();
  const observer = new MutationObserver(() => ensureField());
  observer.observe(fields, { childList: true });
}
