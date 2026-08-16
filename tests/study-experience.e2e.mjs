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
    await openFirstDeck(page);

    const modes = page.locator('.enhanced-study-grid .enhanced-study-button');
    assert.equal(await modes.count(), 5, `${name}: five high-value study shortcuts are shown`);
    assert.deepEqual(await modes.locator('strong').allTextContents(), ['Learn','テスト','筆記','スペル','間違い'], `${name}: shortcut labels`);

    const examDate = page.locator('.enhanced-plan-date input[type="date"]');
    await examDate.fill('2027-02-14');
    await page.locator('.enhanced-plan-date button').click();
    await page.waitForFunction(() => document.querySelector('.enhanced-plan-result')?.textContent?.includes('1日の目安'));
    assert.match(await page.locator('.enhanced-plan-result').innerText(), /試験まで/, `${name}: exam planner renders a countdown`);

    await page.getByRole('button', { name: /筆記答えを入力して確認/ }).click();
    await page.waitForSelector('#study-dialog[open]');
    assert.equal(await page.locator('#study-mode').inputValue(), 'deck', `${name}: Write uses due+new learning course`);
    assert.equal(await page.locator('#study-style').inputValue(), 'type', `${name}: Write selects typed answers`);
    await page.locator('#study-cancel').click();

    await page.getByRole('button', { name: /スペル音声を聞いて入力/ }).click();
    await page.waitForSelector('#study-dialog[open]');
    assert.equal(await page.locator('#study-style').inputValue(), 'spell', `${name}: Spell selects speech-assisted typing`);
    await page.locator('#study-form button[type="submit"]').click();
    await page.waitForSelector('#review-screen:not([hidden])');
    await page.waitForSelector('#review-screen.enhanced-spell-session');
    assert.equal(await page.locator('#type-answer-area').isVisible(), true, `${name}: Spell shows typed answer input`);
    assert.equal(await page.locator('#review-question').isVisible(), false, `${name}: Spell hides written prompt`);
    assert.match(await page.locator('#enhanced-spell-prompt').innerText(), /音声を聞いて入力/, `${name}: Spell shows audio instruction`);

    await page.locator('#review-close').click();
    await page.waitForSelector('#review-screen[hidden]');
    await page.getByRole('button', { name: '今すぐ学習', exact: true }).click();
    await page.waitForSelector('#review-screen:not([hidden])');
    assert.equal(await page.locator('#review-screen').evaluate((node) => node.classList.contains('enhanced-spell-session')), false, `${name}: normal study clears transient Spell mode`);
    await page.locator('#review-close').click();

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
