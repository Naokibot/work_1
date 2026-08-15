import http from 'node:http';
import { mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const dist = path.resolve('dist');
const out = path.resolve('demo-output');
await mkdir(out, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };
const server = http.createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    let file = path.join(dist, pathname === '/' ? 'index.html' : pathname.replace(/^\//, ''));
    if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('server failed');
const url = `http://127.0.0.1:${address.port}/`;

const pause = (ms = 900) => new Promise((resolve) => setTimeout(resolve, ms));
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: out, size: { width: 1280, height: 720 } }
});
const page = await context.newPage();
const video = page.video();

try {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForSelector('.main-toolbar');
  await pause(1300);

  await page.locator('#add-card-button').click();
  await page.waitForSelector('#card-dialog[open]');
  await pause(900);

  const number = page.locator('textarea[data-field="__CardNumber"]');
  if (await number.count()) await number.fill('001');
  await page.locator('textarea[data-field="Front"]').fill('日本の首都は？');
  await pause(500);
  await page.locator('textarea[data-field="Back"]').fill('東京');
  await page.locator('#note-tags').fill('地理 日本');
  await pause(900);
  await page.locator('#card-form').evaluate((form) => form.requestSubmit());
  await pause(1200);
  await page.locator('#card-close').click();
  await pause(900);

  await page.locator('.deck-name-button').filter({ hasText: 'Default' }).first().click();
  await pause(1000);
  await page.getByRole('button', { name: '今すぐ学習' }).click();
  await page.waitForSelector('#review-screen:not([hidden])');
  await pause(1600);
  await page.locator('#show-answer').click();
  await pause(1600);
  await page.locator('[data-rating="good"]').click();
  await pause(1200);

  if (await page.locator('#review-screen:not([hidden])').count()) await page.locator('#review-close').click();
  await pause(700);
  await page.locator('[data-route="anki"]').click();
  await pause(1500);
  await page.locator('[data-route="stats"]').click();
  await pause(1600);
  await page.locator('[data-route="home"]').click();
  await pause(1200);

  await page.close();
  if (!video) throw new Error('Playwright video was not created');
  await video.saveAs(path.join(out, 'anki-demo.webm'));
} finally {
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
  server.close();
}
