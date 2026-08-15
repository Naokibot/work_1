import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const fixture = process.env.OFFICIAL_ANKI_PACKAGE;
if (!fixture) throw new Error('OFFICIAL_ANKI_PACKAGE is required');
const fixtureStat = await stat(fixture);
assert.ok(fixtureStat.size > 1000, 'official Anki package exists');

const dist = path.resolve('dist');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml' };
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

let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const runtimeErrors = [];
  page.on('pageerror', (error) => runtimeErrors.push(String(error)));
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.locator('#import-file').setInputFiles(fixture);
  await page.waitForFunction(() => document.getElementById('status-message')?.textContent?.includes('Ankiパッケージを読み込みました'), null, { timeout: 30000 });
  await page.waitForTimeout(1000);
  await page.waitForLoadState('networkidle');

  const snapshot = await page.evaluate(async () => {
    const storage = await import('./assets/storage/db.js');
    const [cards, state] = await Promise.all([storage.getCards(), storage.getAnkiState()]);
    return {
      cards: cards.map((card) => ({ id: card.id, question: card.question, answer: card.answer, deckId: card.deckId, noteId: card.noteId })),
      decks: state.decks.map((deck) => ({ id: deck.id, name: deck.name })),
      notes: state.notes.map((note) => ({ id: note.id, fields: note.fields, deckId: note.deckId, noteTypeId: note.noteTypeId }))
    };
  });
  const importedCard = snapshot.cards.find((card) => card.question.includes('Official Anki 26.5 fixture'));
  assert.ok(importedCard, `official Anki card imported; snapshot=${JSON.stringify(snapshot)}`);
  assert.ok(snapshot.decks.some((deck) => deck.name === 'Interop::Official 26.5'), `official Anki deck imported; decks=${JSON.stringify(snapshot.decks)}`);
  assert.ok(snapshot.notes.some((note) => Object.values(note.fields).some((value) => String(value).includes('Official Anki 26.5 fixture'))), 'official Anki note fields preserved');

  await page.locator('[data-route="anki"]').click();
  await page.waitForTimeout(300);
  const content = await page.locator('#view').innerText();
  assert.ok(content.includes('Official Anki 26.5 fixture'), 'official imported card appears in browser UI');
  assert.equal(runtimeErrors.length, 0, `no browser runtime errors: ${runtimeErrors.join('\n')}`);
  process.stdout.write('official-anki-interop: Anki 26.5 latest collection package imported\n');
} finally {
  await browser?.close();
  server.close();
}
