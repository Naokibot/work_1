import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { chromium, webkit } from 'playwright';

const dist = path.resolve('dist');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };
const server = http.createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    let file = path.join(dist, pathname === '/' ? 'index.html' : pathname.replace(/^\//, ''));
    if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end('not found'); }
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('server');
const url = `http://127.0.0.1:${address.port}/`;

async function indexedCount(page, store) {
  return page.evaluate(async (storeName) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('work_1_study_cards');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName);
      const request = tx.objectStore(storeName).count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }, store);
}

async function downloadBuffer(download) {
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  let browser;
  let stage = 'launch';
  try {
    process.stdout.write(`e2e:${name}:launch\n`);
    browser = await engine.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, acceptDownloads: true });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));

    stage = 'boot';
    process.stdout.write(`e2e:${name}:${stage}\n`);
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForSelector('.main-toolbar');
    assert.equal(await page.locator('#page-title').textContent(), 'デッキ', `${name}: deck screen boot`);
    for (const label of ['デッキ', '追加', 'ブラウザ', '統計', '同期']) assert.ok((await page.locator('.main-toolbar').innerText()).includes(label), `${name}: toolbar ${label}`);
    assert.equal(errors.length, 0, `${name}: no page error after boot`);

    stage = 'note-add';
    process.stdout.write(`e2e:${name}:${stage}\n`);
    await page.locator('#add-card-button').click();
    await page.waitForSelector('#card-dialog[open]');
    const typeNames = await page.locator('#note-type option').allTextContents();
    assert.ok(typeNames.some((value) => value.includes('Basic')), `${name}: built-in Basic note type`);
    await page.locator('textarea[data-field="Front"]').fill('Capital of Japan?');
    await page.locator('textarea[data-field="Back"]').fill('Tokyo');
    await page.locator('#note-tags').fill('geography asia');
    await page.locator('#card-form').evaluate((form) => form.requestSubmit());
    await page.waitForTimeout(300);
    assert.ok((await indexedCount(page, 'cards')) >= 1, `${name}: note generated card`);
    await page.locator('#card-close').click();

    stage = 'deck-study';
    process.stdout.write(`e2e:${name}:${stage}\n`);
    const defaultDeck = page.locator('.deck-name-button').filter({ hasText: 'Default' }).first();
    await defaultDeck.click();
    await page.getByRole('button', { name: '今すぐ学習' }).click();
    await page.waitForSelector('#review-screen:not([hidden])');
    assert.ok((await page.locator('#review-question').innerText()).includes('Capital of Japan?'), `${name}: generated card shown in reviewer`);

    stage = 'review-grade';
    process.stdout.write(`e2e:${name}:${stage}\n`);
    await page.locator('#show-answer').click();
    assert.ok((await page.locator('#review-answer').innerText()).includes('Tokyo'), `${name}: answer rendered`);
    await page.locator('[data-rating="good"]').click();
    await page.waitForTimeout(350);
    assert.ok((await indexedCount(page, 'history')) >= 1, `${name}: review history persisted`);

    stage = 'browser';
    process.stdout.write(`e2e:${name}:${stage}\n`);
    if (!(await page.locator('#review-screen').getAttribute('hidden'))) await page.locator('#review-close').click();
    await page.locator('[data-route="anki"]').click();
    await page.waitForTimeout(250);
    const browserText = await page.locator('#view').innerText();
    for (const heading of ['ブラウザ / 高度な検索', 'フィルターデッキ / Custom Study', 'ノートタイプ / フィールド / カードテンプレート', 'FSRS-6 / デッキオプション']) assert.ok(browserText.includes(heading), `${name}: ${heading}`);
    assert.ok(browserText.includes('Capital of Japan?'), `${name}: generated note searchable`);

    stage = 'apkg-roundtrip';
    process.stdout.write(`e2e:${name}:${stage}\n`);
    const downloadPromise = page.waitForEvent('download');
    await page.evaluate(async () => {
      const module = await import('./assets/anki/anki-package.js');
      await module.exportAnkiPackage();
    });
    const download = await downloadPromise;
    assert.ok(download.suggestedFilename().endsWith('.apkg'), `${name}: Anki package filename`);
    const packageBytes = await downloadBuffer(download);
    assert.ok(packageBytes.length > 1000, `${name}: Anki package has SQLite payload`);
    await page.locator('#import-file').setInputFiles({ name: 'roundtrip.apkg', mimeType: 'application/octet-stream', buffer: packageBytes });
    await page.waitForSelector('#status-message:not([hidden])');
    await page.waitForFunction(() => document.getElementById('status-message')?.textContent?.includes('Ankiパッケージを読み込みました'));
    await page.waitForTimeout(800);
    await page.waitForLoadState('networkidle');
    await page.locator('[data-route="anki"]').click();
    await page.waitForTimeout(250);
    assert.ok((await page.locator('#view').innerText()).includes('Capital of Japan?'), `${name}: APKG roundtrip preserved note`);

    stage = 'reload-persistence';
    process.stdout.write(`e2e:${name}:${stage}\n`);
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('[data-route="anki"]').click();
    await page.waitForTimeout(250);
    assert.ok((await page.locator('#view').innerText()).includes('Capital of Japan?'), `${name}: IndexedDB persists after reload`);
    assert.equal(errors.length, 0, `${name}: no uncaught runtime errors`);
    process.stdout.write(`e2e:${name}:pass\n`);
  } catch (error) {
    process.stderr.write(`e2e:${name}:FAIL:${stage}\n`);
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    throw error;
  } finally { await browser?.close(); }
}
server.close();
process.stdout.write('browser-e2e: chromium + webkit ok\n');
