import { exportCsv, exportJson } from '../storage/backup.js';
import { exportAnkiPackage, importAnkiPackage } from './anki-package.js';

function status(message: string, error = false): void {
  const node = document.getElementById('status-message');
  if (!node) return;
  node.textContent = message;
  node.classList.toggle('is-error', error);
  node.removeAttribute('hidden');
}

function isAnkiPackage(file: File): boolean {
  const name = file.name.toLowerCase();
  return name.endsWith('.apkg') || name.endsWith('.colpkg');
}

export function installAnkiPackageHooks(): void {
  const input = document.getElementById('import-file') as HTMLInputElement | null;
  input?.addEventListener('change', (event) => {
    const file = input.files?.[0];
    if (!file || !isAnkiPackage(file)) return;
    event.stopImmediatePropagation();
    void (async () => {
      try {
        status('Ankiパッケージを解析しています…');
        const result = await importAnkiPackage(file);
        status(`Ankiパッケージを読み込みました：ノート${result.notes}・カード${result.cards}・履歴${result.history}・メディア${result.media}`);
        window.setTimeout(() => window.location.reload(), 500);
      } catch (error) {
        status(error instanceof Error ? error.message : 'Ankiパッケージの読み込みに失敗しました。', true);
      } finally {
        input.value = '';
      }
    })();
  });

  document.querySelector<HTMLButtonElement>('[data-menu="file"]')?.addEventListener('click', (event) => {
    event.stopImmediatePropagation();
    const choice = window.prompt('ファイル: 1=読み込み  2=Ankiパッケージ(.apkg)書き出し  3=完全JSON  4=CSV', '1');
    if (choice === '1') input?.click();
    else if (choice === '2') {
      status('Ankiパッケージを作成しています…');
      void exportAnkiPackage().then(() => status('Anki互換 .apkg を作成しました。')).catch((error) => status(error instanceof Error ? error.message : 'Ankiパッケージの書き出しに失敗しました。', true));
    } else if (choice === '3') void exportJson();
    else if (choice === '4') void exportCsv();
  });
}
