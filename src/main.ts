import { App } from './app/app.js';

function closeDialogElement(dialog: HTMLDialogElement): void {
  const target = dialog as HTMLDialogElement & { close?: () => void };
  if (typeof target.close === 'function') target.close();
  else dialog.removeAttribute('open');
  dialog.classList.remove('dialog-fallback-open');
}

function prepareDialogCompatibility(): void {
  document.querySelectorAll<HTMLDialogElement>('dialog').forEach((dialog) => {
    const target = dialog as HTMLDialogElement & { showModal?: () => void; close?: () => void };
    if (typeof target.showModal !== 'function') {
      target.showModal = () => {
        dialog.setAttribute('open', '');
        dialog.classList.add('dialog-fallback-open');
      };
    }
    if (typeof target.close !== 'function') {
      target.close = () => {
        dialog.removeAttribute('open');
        dialog.classList.remove('dialog-fallback-open');
      };
    }
  });

  const bindings: Array<[string, string]> = [
    ['card-close', 'card-dialog'],
    ['card-cancel', 'card-dialog'],
    ['study-close', 'study-dialog'],
    ['study-cancel', 'study-dialog']
  ];
  for (const [buttonId, dialogId] of bindings) {
    const control = document.getElementById(buttonId);
    const dialog = document.getElementById(dialogId) as HTMLDialogElement | null;
    control?.addEventListener('click', () => {
      if (dialog) closeDialogElement(dialog);
    });
  }
}

async function requestPersistentStorage(): Promise<void> {
  try {
    if (navigator.storage && typeof navigator.storage.persist === 'function') {
      await navigator.storage.persist();
    }
  } catch {
    // IndexedDB still works when persistent-storage requests are unsupported or denied.
  }
}

async function registerServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  try {
    const url = new URL('sw.js', document.baseURI);
    await navigator.serviceWorker.register(url, { scope: './' });
  } catch {
    // The app remains usable online if service-worker registration is unavailable.
  }
}

function showBootError(error: unknown): void {
  const status = document.getElementById('status-message');
  if (!status) return;
  status.textContent = error instanceof Error
    ? `アプリの初期化に失敗しました: ${error.message}`
    : 'アプリの初期化に失敗しました。ページを再読み込みしてください。';
  status.classList.add('is-error');
  status.removeAttribute('hidden');
}

try {
  prepareDialogCompatibility();
  void requestPersistentStorage();
  const app = new App();
  void app.init()
    .then(() => registerServiceWorker())
    .catch(showBootError);
} catch (error) {
  showBootError(error);
}
