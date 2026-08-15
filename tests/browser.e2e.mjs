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
  '.svg': 'image/svg+xml'
};

const server = http.createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    let file = path.join(dist, pathname === '/' ? 'index.html' : pathname.replace(/^\//, ''));
    const info = await stat(file);
    if (info.isDirectory()) file = path.join(file, 'index.html');
    const data = await readFile(file);
    res.writeHead(200, {
      'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
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

for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  let browser;
  let stage = 'launch';
  try {
    process.stdout.write(`e2e:${name}:launch\n`);
    browser = await engine.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1024, height: 768 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));

    stage = 'boot';
    process.stdout.write(`e2e:${name}:${stage}\n`);
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForSelector('#page-title');
    assert.equal(await page.locator('#page-title').textContent(), '暗記カード', `${name}: boot`);
    assert.equal(errors.length, 0, `${name}: no page error after boot`);

    stage = 'legacy-card-save';
    process.stdout.write(`e2e:${name}:${stage}\n`);
    await page.locator('#add-card-button').click();
    await page.locator('#card-number').fill('E2E-001');
    await page.locator('#card-question').fill('2+2');
    await page.locator('#card-answer').fill('4');
    await page.locator('#card-form').evaluate((form) => form.requestSubmit());
    await page.waitForTimeout(200);
    assert.equal(await page.locator('#card-dialog').getAttribute('open'), null, `${name}: dialog closes`);

    stage = 'cards-list';
    process.stdout.write(`e2e:${name}:${stage}\n`);
    await page.locator('[data-route="cards"]').click();
    await page.waitForTimeout(150);
    assert.ok((await page.locator('#view').innerText()).includes('E2E-001'), `${name}: card visible`);

    stage = 'anki-center';
    process.stdout.write(`e2e:${name}:${stage}\n`);
    await page.locator('[data-route="anki"]').click();
    await page.waitForTimeout(200);
    const ankiText = await page.locator('#view').innerText();
    for (const heading of [
      'Anki互換センター',
      'デッキ / サブデッキ',
      'ノートを追加',
      'ブラウザ / 高度な検索',
      'フィルターデッキ / Custom Study',
      'ノートタイプ / フィールド / カードテンプレート',
      'FSRS-6 / デッキオプション',
      'プロファイル',
      'インポート / エクスポート / 自動バックアップ'
    ]) assert.ok(ankiText.includes(heading), `${name}: ${heading}`);

    stage = 'note-generation';
    process.stdout.write(`e2e:${name}:${stage}\n`);
    const addSection = page.locator('.anki-panel').filter({ has: page.getByRole('heading', { name: 'ノートを追加' }) });
    await addSection.locator('textarea[data-field="Front"]').fill('Capital of Japan?');
    await addSection.locator('textarea[data-field="Back"]').fill('Tokyo');
    await addSection.getByRole('button', { name: 'ノートを保存してカード生成' }).click();
    await page.waitForTimeout(350);
    const cardCount = await indexedCount(page, 'cards');
    assert.ok(cardCount >= 2, `${name}: note generated card`);

    stage = 'review-start';
    process.stdout.write(`e2e:${name}:${stage}\n`);
    await page.locator('[data-route="home"]').click();
    await page.waitForTimeout(150);
    await page.getByRole('button', { name: /学習モードを選ぶ|今日の復習を始める/ }).click();
    await page.locator('#study-mode').selectOption('new');
    await page.locator('#study-style').selectOption('self');
    await page.locator('#study-form').evaluate((form) => form.requestSubmit());
    await page.waitForSelector('#review-screen:not([hidden])');

    stage = 'review-grade';
    process.stdout.write(`e2e:${name}:${stage}\n`);
    await page.locator('#show-answer').click();
    await page.locator('[data-rating="good"]').click();
    await page.waitForTimeout(350);
    assert.ok((await indexedCount(page, 'history')) >= 1, `${name}: review history persisted`);

    stage = 'reload-persistence';
    process.stdout.write(`e2e:${name}:${stage}\n`);
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('[data-route="cards"]').click();
    await page.waitForTimeout(150);
    assert.ok((await page.locator('#view').innerText()).includes('E2E-001'), `${name}: same-device persistence after reload`);
    assert.equal(errors.length, 0, `${name}: no uncaught runtime errors`);

    process.stdout.write(`e2e:${name}:pass\n`);
  } catch (error) {
    process.stderr.write(`e2e:${name}:FAIL:${stage}\n`);
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    throw error;
  } finally {
    await browser?.close();
  }
}

server.close();
process.stdout.write('browser-e2e: chromium + webkit ok\n');
