import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { chromium, webkit } from 'playwright';

const dist = path.resolve('dist');
const mime = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.wasm':'application/wasm','.webmanifest':'application/manifest+json' };
const server = http.createServer(async (req,res)=>{try{const pathname=new URL(req.url??'/','http://localhost').pathname;let file=path.join(dist,pathname==='/'?'index.html':pathname.replace(/^\//,''));if((await stat(file)).isDirectory())file=path.join(file,'index.html');res.writeHead(200,{'Content-Type':mime[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store'});res.end(await readFile(file));}catch{res.writeHead(404);res.end('not found');}});
await new Promise((resolve)=>server.listen(0,'127.0.0.1',resolve));
const address=server.address();if(!address||typeof address==='string')throw new Error('server');const url=`http://127.0.0.1:${address.port}/`;

async function addBasicCard(page, question, answer) {
  await page.locator('#add-card-button').click();
  await page.waitForSelector('#card-dialog[open]');
  await page.getByRole('textbox',{name:'表面',exact:true}).fill(question);
  await page.getByRole('textbox',{name:'裏面',exact:true}).fill(answer);
  await page.locator('#card-save').click();
  await page.waitForFunction(() => document.getElementById('status-message')?.textContent?.includes('カードを追加'));
  await page.locator('#card-close').click();
}

async function openFirstDeck(page) {
  await page.locator('[data-route="home"]').click();
  const deck = page.locator('.deck-name-button').first();
  await deck.click();
  await page.waitForSelector('.deck-overview');
  await page.waitForSelector('.enhanced-study-section');
}

function shortcut(page, label) {
  return page.locator('.enhanced-study-grid .enhanced-study-button').filter({ has: page.locator('strong', { hasText: label }) }).first();
}

async function waitForReviewHidden(page) {
  await page.waitForFunction(() => document.getElementById('review-screen')?.hasAttribute('hidden') === true);
}

async function currentCardSnapshot(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('work_1_study_cards', 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const tx = db.transaction(['sessions','cards'], 'readonly');
      const session = await new Promise((resolve, reject) => {
        const request = tx.objectStore('sessions').get('current');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const id = session.queue[session.cursor];
      const card = await new Promise((resolve, reject) => {
        const request = tx.objectStore('cards').get(id);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return { id: card.id, answer: card.answer, schedule: structuredClone(card.schedule), incorrect: card.stats.incorrect };
    } finally { db.close(); }
  });
}

async function cardSnapshot(page, id) {
  return page.evaluate(async (cardId) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('work_1_study_cards', 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const tx = db.transaction('cards', 'readonly');
      return await new Promise((resolve, reject) => {
        const request = tx.objectStore('cards').get(cardId);
        request.onsuccess = () => resolve({ schedule: structuredClone(request.result.schedule), incorrect: request.result.stats.incorrect });
        request.onerror = () => reject(request.error);
      });
    } finally { db.close(); }
  }, id);
}

async function finishSelfReview(page) {
  for (let guard = 0; guard < 20; guard += 1) {
    const hidden = await page.locator('#review-screen').evaluate((node) => node.hasAttribute('hidden'));
    if (hidden) return;
    if (await page.locator('#show-answer').isVisible()) await page.locator('#show-answer').click();
    if (await page.locator('#rating-row [data-rating="good"]').isVisible()) await page.locator('#rating-row [data-rating="good"]').click();
    await page.waitForTimeout(60);
  }
  throw new Error('normal review did not complete');
}

async function run(name, engine) {
  const browser = await engine.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, serviceWorkers: 'allow' });
    const page = await context.newPage();
    await page.addInitScript(() => {
      class MockSpeechSynthesisUtterance {
        constructor(text = '') { this.text = text; this.lang = ''; this.rate = 1; }
      }
      Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: MockSpeechSynthesisUtterance });
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { cancel() {}, speak() {} } });
    });
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForSelector('.main-toolbar');
    await addBasicCard(page, 'apple', 'りんご');
    await addBasicCard(page, 'banana', 'バナナ');
    await addBasicCard(page, 'cherry', 'さくらんぼ');
    await addBasicCard(page, 'grape', 'ぶどう');
    await openFirstDeck(page);

    const modes = page.locator('.enhanced-study-grid .enhanced-study-button');
    assert.equal(await modes.count(), 5, `${name}: five high-value study shortcuts are shown`);
    assert.deepEqual(await modes.locator('strong').allTextContents(), ['Learn','テスト','筆記','スペル','間違い'], `${name}: shortcut labels`);

    const examDate = page.locator('.enhanced-plan-date input[type="date"]');
    await examDate.fill('2027-02-14');
    await page.locator('.enhanced-plan-date button').click();
    await page.waitForFunction(() => document.querySelector('.enhanced-plan-result')?.textContent?.includes('試験まで'));
    assert.match(await page.locator('.enhanced-plan-result').innerText(), /試験まで/, `${name}: exam planner renders a countdown`);

    await shortcut(page, '筆記').click();
    await page.waitForSelector('#study-dialog[open]');
    assert.equal(await page.locator('#study-mode').inputValue(), 'deck', `${name}: Write uses due+new learning course`);
    assert.equal(await page.locator('#study-style').inputValue(), 'type', `${name}: Write selects typed answers`);
    await page.locator('#study-cancel').click();

    await shortcut(page, 'テスト').click();
    await page.waitForSelector('#study-dialog[open]');
    assert.equal(await page.locator('#study-mode').inputValue(), 'exam', `${name}: Test uses exam mode`);
    assert.equal(await page.locator('#study-style').inputValue(), 'choice', `${name}: Test uses choice mode`);
    await page.locator('#study-form button[type="submit"]').click();
    await page.waitForSelector('#review-screen:not([hidden])');
    await page.waitForFunction(() => document.querySelectorAll('#choice-list .choice-button').length === 4);
    const before = await currentCardSnapshot(page);
    const choices = await page.locator('#choice-list .choice-button').allTextContents();
    const wrong = choices.find((value) => value.trim() !== before.answer.trim());
    assert.ok(wrong, `${name}: Test has a wrong choice`);
    await page.getByRole('button', { name: wrong, exact: true }).click();
    assert.equal(await page.locator('#rating-row [data-rating="again"]').isDisabled(), false, `${name}: Again stays enabled after a wrong answer`);
    assert.equal(await page.locator('#rating-row [data-rating="good"]').isDisabled(), true, `${name}: Good is disabled after a wrong answer`);
    assert.equal(await page.locator('#rating-row [data-rating="easy"]').isDisabled(), true, `${name}: Easy is disabled after a wrong answer`);
    await page.locator('#rating-row [data-rating="again"]').click();
    await page.waitForTimeout(80);
    const after = await cardSnapshot(page, before.id);
    assert.deepEqual(after.schedule, before.schedule, `${name}: Test does not change FSRS schedule`);
    assert.equal(after.incorrect, before.incorrect + 1, `${name}: Test still records correctness statistics`);
    await page.locator('#review-close').click();
    await waitForReviewHidden(page);

    await openFirstDeck(page);
    await shortcut(page, 'スペル').click();
    await page.waitForSelector('#study-dialog[open]');
    assert.equal(await page.locator('#study-style').inputValue(), 'spell', `${name}: Spell is a first-class review style`);
    await page.locator('#study-form button[type="submit"]').click();
    await page.waitForSelector('#review-screen:not([hidden])');
    await page.waitForSelector('#review-screen.enhanced-spell-session');
    assert.equal(await page.locator('#type-answer-area').isVisible(), true, `${name}: Spell shows typed answer input`);
    assert.equal(await page.locator('#review-question').isVisible(), false, `${name}: Spell hides written prompt`);
    assert.match(await page.locator('#enhanced-spell-prompt').innerText(), /音声を聞いて入力/, `${name}: Spell shows audio instruction`);

    await page.evaluate(() => sessionStorage.clear());
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('#review-screen:not([hidden])');
    await page.waitForSelector('#review-screen.enhanced-spell-session');
    assert.equal(await page.locator('#review-question').isVisible(), false, `${name}: Spell resumes after transient storage is cleared`);
    assert.equal(await page.locator('#type-answer-area').isVisible(), true, `${name}: resumed Spell remains typed input`);

    await page.locator('#review-close').click();
    await waitForReviewHidden(page);
    await openFirstDeck(page);
    await page.getByRole('button', { name: '今すぐ学習', exact: true }).click();
    await page.waitForSelector('#review-screen:not([hidden])');
    assert.equal(await page.locator('#review-screen').evaluate((node) => node.classList.contains('enhanced-spell-session')), false, `${name}: normal study does not inherit Spell mode`);
    await finishSelfReview(page);
    await waitForReviewHidden(page);

    await page.reload({ waitUntil: 'networkidle' });
    await openFirstDeck(page);
    assert.equal(await page.locator('.enhanced-plan-date input[type="date"]').inputValue(), '2027-02-14', `${name}: exam date persists on the same device`);

    await context.close();
    process.stdout.write(`study-experience:${name}:pass\n`);
  } finally { await browser.close(); }
}

for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) await run(name, engine);
server.close();
process.stdout.write('study-experience-e2e: chromium + webkit ok\n');