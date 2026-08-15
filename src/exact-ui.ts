type MenuName = 'file' | 'edit' | 'tools' | 'help';

const byId = <T extends HTMLElement>(id: string): T | null => document.getElementById(id) as T | null;
const click = (selector: string) => document.querySelector<HTMLButtonElement>(selector)?.click();

function closeMenu(): void {
  document.querySelector('.anki-menu-popup')?.remove();
}

function menuButton(label: string, shortcut: string, action: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  const left = document.createElement('span'); left.textContent = label;
  const right = document.createElement('span'); right.textContent = shortcut;
  button.append(left, right);
  button.addEventListener('click', () => { closeMenu(); action(); });
  return button;
}

function separator(): HTMLElement {
  const node = document.createElement('div'); node.className = 'anki-menu-separator'; return node;
}

function openMenu(source: HTMLButtonElement, name: MenuName): void {
  closeMenu();
  const popup = document.createElement('div'); popup.className = 'anki-menu-popup';
  const items: Array<HTMLElement> = [];
  if (name === 'file') items.push(
    menuButton('Ankiデッキを読み込む…', 'Ctrl+Shift+I', () => byId<HTMLInputElement>('import-file')?.click()),
    menuButton('同期', 'Y', () => byId<HTMLButtonElement>('sync-button')?.click()), separator(),
    menuButton('プロファイルを切替', '', () => { click('[data-route="anki"]'); requestAnimationFrame(() => focusSection('プロファイル')); })
  );
  if (name === 'edit') items.push(
    menuButton('追加', 'A', () => byId<HTMLButtonElement>('add-card-button')?.click()),
    menuButton('ブラウザ', 'B', () => click('[data-route="anki"]')), separator(),
    menuButton('設定', 'P', () => click('[data-route="settings"]'))
  );
  if (name === 'tools') items.push(
    menuButton('ノートタイプを管理', '', () => { click('[data-route="anki"]'); requestAnimationFrame(() => focusSection('ノートタイプ')); }),
    menuButton('デッキオプション', 'O', () => { click('[data-route="anki"]'); requestAnimationFrame(() => focusSection('スケジューラ')); }),
    menuButton('データベースをチェック', '', () => { click('[data-route="anki"]'); requestAnimationFrame(() => focusSection('メンテナンス')); }), separator(),
    menuButton('統計', 'T', () => click('[data-route="stats"]'))
  );
  if (name === 'help') items.push(
    menuButton('操作ショートカット', '?', () => window.alert('A: 追加\nB: ブラウザ\nD: デッキ\nT: 統計\nY: 同期\nSpace: 答えを表示\n1-4: Again / Hard / Good / Easy'))
  );
  popup.append(...items);
  const rect = source.getBoundingClientRect(); popup.style.left = `${rect.left}px`; popup.style.top = `${rect.bottom}px`;
  document.body.append(popup);
}

function focusSection(fragment: string): void {
  const sections = [...document.querySelectorAll<HTMLElement>('.anki-center > section')];
  const target = sections.find((section) => section.querySelector('h2')?.textContent?.includes(fragment));
  target?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function enhanceDeckRows(): void {
  const page = document.querySelector('.deck-page');
  if (!page) return;
  const header = page.querySelector('.deck-title-row');
  if (header && header.children.length === 3) header.append(document.createElement('span'));
  page.querySelectorAll<HTMLElement>('.deck-row').forEach((row) => {
    if (row.querySelector('.deck-gear')) return;
    const gear = document.createElement('button'); gear.type = 'button'; gear.className = 'deck-gear'; gear.textContent = '⚙'; gear.title = 'デッキオプション';
    gear.addEventListener('click', (event) => {
      event.stopPropagation(); click('[data-route="anki"]');
      requestAnimationFrame(() => focusSection('デッキ'));
    });
    row.append(gear);
  });
}

function improveBrowserCenter(): void {
  const center = document.querySelector<HTMLElement>('.anki-center');
  if (!center || center.dataset.desktopEnhanced === '1') return;
  center.dataset.desktopEnhanced = '1';
  const sections = [...center.querySelectorAll<HTMLElement>(':scope > section')];
  if (!sections.length) return;
  const nav = document.createElement('div'); nav.className = 'browser-toolbar anki-center-tabs';
  const important = ['ブラウザ', 'デッキ', 'ノートを追加', 'フィルター', 'ノートタイプ', 'スケジューラ', 'プロファイル', 'バックアップ', 'メンテナンス'];
  for (const fragment of important) {
    const section = sections.find((item) => item.querySelector('h2')?.textContent?.includes(fragment));
    if (!section) continue;
    const button = document.createElement('button'); button.type = 'button'; button.className = 'small-button'; button.textContent = fragment;
    button.addEventListener('click', () => section.scrollIntoView({ block: 'start', behavior: 'smooth' })); nav.append(button);
  }
  center.prepend(nav);
}

function enhanceStats(): void {
  const view = byId<HTMLElement>('view');
  if (!view || !view.querySelector('.metric-grid') || view.querySelector('.stats-tabs')) return;
  const tabs = document.createElement('div'); tabs.className = 'stats-tabs';
  ['過去1週間', '過去1か月', '過去1年', '全期間'].forEach((label, index) => {
    const button = document.createElement('button'); button.type = 'button'; button.className = `stats-tab${index === 0 ? ' is-active' : ''}`; button.textContent = label;
    button.addEventListener('click', () => {
      tabs.querySelectorAll('.stats-tab').forEach((item) => item.classList.remove('is-active')); button.classList.add('is-active');
    }); tabs.append(button);
  });
  view.prepend(tabs); view.classList.add('stats-layout');
  view.querySelectorAll<HTMLElement>('.settings-card').forEach((card) => card.classList.add('stats-graph'));
}

function installStatusBar(): void {
  if (document.querySelector('.anki-statusbar')) return;
  const bar = document.createElement('div'); bar.className = 'anki-statusbar';
  const left = document.createElement('span'); left.textContent = 'Study Cards';
  const right = document.createElement('span'); right.textContent = navigator.onLine ? 'オンライン' : 'オフライン';
  bar.append(left, right); document.body.append(bar);
  window.addEventListener('online', () => { right.textContent = 'オンライン'; });
  window.addEventListener('offline', () => { right.textContent = 'オフライン'; });
}

function keyboard(event: KeyboardEvent): void {
  const target = event.target as HTMLElement | null;
  if (target?.matches('input,textarea,select,[contenteditable="true"]') || document.querySelector('dialog[open]')) return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const key = event.key.toLowerCase();
  if (key === 'a') { event.preventDefault(); byId<HTMLButtonElement>('add-card-button')?.click(); }
  else if (key === 'b') { event.preventDefault(); click('[data-route="anki"]'); }
  else if (key === 'd') { event.preventDefault(); click('[data-route="home"]'); }
  else if (key === 't') { event.preventDefault(); click('[data-route="stats"]'); }
  else if (key === 'y') { event.preventDefault(); byId<HTMLButtonElement>('sync-button')?.click(); }
  else if (key === 'p') { event.preventDefault(); click('[data-route="settings"]'); }
}

function enhance(): void {
  enhanceDeckRows(); improveBrowserCenter(); enhanceStats(); installStatusBar();
}

document.addEventListener('click', (event) => {
  const menu = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-menu]');
  if (menu) {
    event.preventDefault(); event.stopImmediatePropagation();
    openMenu(menu, (menu.dataset.menu ?? 'help') as MenuName); return;
  }
  if (!(event.target as HTMLElement).closest('.anki-menu-popup')) closeMenu();
}, true);

document.addEventListener('keydown', keyboard);
new MutationObserver(enhance).observe(document.body, { childList: true, subtree: true });
enhance();
