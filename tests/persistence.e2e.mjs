import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { chromium, webkit } from 'playwright';

const dist = path.resolve('dist');
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json'
};

const server = http.createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    let file = path.join(dist, pathname === '/' ? 'index.html' : pathname.replace(/^\//, ''));
    if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
    res.writeHead(200, {
      'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('server');
const url = `http://127.0.0.1:${address.port}/`;

async function stored(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('work_1_study_cards');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const readOne = (storeName, key) => new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const request = tx.objectStore(storeName).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return {
      anki: await readOne('anki', 'anki'),
      settings: await readOne('settings', 'app')
    };
  });
}

async function waitForStored(page, predicate) {
  const deadline = Date.now() + 5000;
  let last;
  while (Date.now() < deadline) {
    last = await stored(page);
    if (predicate(last)) return last;
    await page.waitForTimeout(50);
  }
  return last;
}

function panel(page, title) {
  return page.locator('.settings-card').filter({ hasText: title }).first();
}

async function testEngine(name, engine) {
  let browser;
  let stage = 'launch';
  try {
    browser = await engine.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, serviceWorkers: 'allow' });
    let page = await context.newPage();
    const runtimeErrors = [];
    page.on('pageerror', (error) => runtimeErrors.push(String(error)));

    stage = 'boot';
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForSelector('.main-toolbar');

    stage = 'create-deck';
    page.once('dialog', (dialog) => dialog.accept('PersistenceDeck'));
    await page.getByRole('button', { name: 'デッキを作成', exact: true }).first().click();
    await page.waitForFunction(() => document.getElementById('view')?.textContent?.includes('PersistenceDeck'));

    stage = 'save-deck-options';
    await page.locator('[data-route="anki"]').click();
    const fsrs = panel(page, 'FSRS-6 / デッキオプション');
    await fsrs.getByLabel('希望保持率 (0.70〜0.99)').fill('0.93');
    await fsrs.getByRole('button', { name: 'デッキオプションを保存' }).click();
    await page.waitForFunction(() => document.getElementById('status-message')?.textContent?.includes('デッキオプションを保存'));
    const deckState = await waitForStored(page, (data) => data.anki?.presets?.some((preset) => preset.id === 'preset_default' && preset.desiredRetention === 0.93));
    assert.equal(deckState?.anki?.presets?.find((preset) => preset.id === 'preset_default')?.desiredRetention, 0.93, `${name}: deck preset transaction committed`);

    stage = 'save-app-settings';
    await page.locator('[data-route="settings"]').click();
    await page.getByLabel('残りカード数を表示').uncheck();
    await page.getByLabel('自動同期').uncheck();
    const settingsState = await waitForStored(page, (data) => data.settings?.showRemainingCount === false && data.settings?.autoSync === false);
    assert.equal(settingsState?.settings?.showRemainingCount, false, `${name}: first setting transaction committed`);
    assert.equal(settingsState?.settings?.autoSync, false, `${name}: second setting transaction committed`);

    stage = 'verify-before-reload';
    let data = await stored(page);
    assert.ok(data.anki?.decks?.some((deck) => deck.name === 'PersistenceDeck'), `${name}: deck stored in IndexedDB`);
    const presetBefore = data.anki?.presets?.find((preset) => preset.id === 'preset_default');
    assert.equal(presetBefore?.desiredRetention, 0.93, `${name}: deck preset persisted before reload`);
    assert.equal(data.settings?.showRemainingCount, false, `${name}: first changed app setting persisted`);
    assert.equal(data.settings?.autoSync, false, `${name}: second changed app setting persisted without overwriting first`);

    stage = 'reload';
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('.main-toolbar');
    data = await stored(page);
    assert.ok(data.anki?.decks?.some((deck) => deck.name === 'PersistenceDeck'), `${name}: deck survives reload`);
    const presetAfterReload = data.anki?.presets?.find((preset) => preset.id === 'preset_default');
    assert.equal(presetAfterReload?.desiredRetention, 0.93, `${name}: deck preset survives reload`);
    assert.equal(data.settings?.showRemainingCount, false, `${name}: app setting survives reload`);
    assert.equal(data.settings?.autoSync, false, `${name}: auto-sync setting survives reload`);
    assert.ok((await page.locator('#view').innerText()).includes('PersistenceDeck'), `${name}: persisted deck is visible after reload`);

    stage = 'ui-restores-settings';
    await page.locator('[data-route="anki"]').click();
    const fsrsAfterReload = panel(page, 'FSRS-6 / デッキオプション');
    assert.equal(await fsrsAfterReload.getByLabel('希望保持率 (0.70〜0.99)').inputValue(), '0.93', `${name}: FSRS UI restores saved value`);
    await page.locator('[data-route="settings"]').click();
    assert.equal(await page.getByLabel('残りカード数を表示').isChecked(), false, `${name}: settings UI restores first value`);
    assert.equal(await page.getByLabel('自動同期').isChecked(), false, `${name}: settings UI restores second value`);

    stage = 'same-device-relaunch';
    await page.close();
    page = await context.newPage();
    page.on('pageerror', (error) => runtimeErrors.push(String(error)));
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForSelector('.main-toolbar');
    assert.ok((await page.locator('#view').innerText()).includes('PersistenceDeck'), `${name}: deck survives same-device app relaunch`);
    data = await stored(page);
    assert.equal(data.anki?.presets?.find((preset) => preset.id === 'preset_default')?.desiredRetention, 0.93, `${name}: deck settings survive same-device relaunch`);
    assert.equal(data.settings?.showRemainingCount, false, `${name}: app settings survive same-device relaunch`);
    assert.equal(data.settings?.autoSync, false, `${name}: second app setting survives same-device relaunch`);

    assert.equal(runtimeErrors.length, 0, `${name}: no uncaught runtime errors: ${runtimeErrors.join(' | ')}`);
    process.stdout.write(`persistence:${name}:pass\n`);
  } catch (error) {
    process.stderr.write(`persistence:${name}:FAIL:${stage}\n${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    throw error;
  } finally {
    await browser?.close();
  }
}

for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  await testEngine(name, engine);
}

server.close();
process.stdout.write('persistence-e2e: chromium + webkit ok\n');
