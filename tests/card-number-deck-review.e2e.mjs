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

async function fillBasic(page, front, back) {
  await page.getByRole('textbox',{name:'表面',exact:true}).fill(front);
  await page.getByRole('textbox',{name:'裏面',exact:true}).fill(back);
}

async function run(name, engine) {
  const browser = await engine.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, serviceWorkers: 'allow' });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForSelector('.main-toolbar');

    await page.locator('#add-card-button').click();
    await page.waitForSelector('#card-dialog[open]');
    const number = page.getByLabel('カード番号', { exact: true });
    await page.waitForFunction(() => document.querySelector('select[aria-label="カード番号"]')?.value === '1');
    assert.equal(await number.inputValue(), '1', `${name}: first card defaults to number 1`);

    page.once('dialog', (dialog) => dialog.accept('数学'));
    await page.locator('#note-deck-create').click();
    await page.waitForFunction(() => [...document.querySelectorAll('#note-deck option')].some((option) => option.textContent === '数学'));
    assert.equal(await page.locator('#note-deck').locator('option:checked').textContent(), '数学', `${name}: new deck is selected immediately`);

    await fillBasic(page, '1+1は？', '2');
    await page.locator('#card-save').click();
    await page.waitForFunction(() => document.getElementById('status-message')?.textContent?.includes('1枚のカードを追加'));
    await page.waitForFunction(() => document.querySelector('select[aria-label="カード番号"]')?.value === '2');
    assert.equal(await number.inputValue(), '2', `${name}: second card defaults to number 2`);
    const optionsAfterFirst = await number.locator('option').evaluateAll((options) => options.map((option) => option.value));
    assert.ok(!optionsAfterFirst.includes('1'), `${name}: used card number 1 is not selectable`);

    await fillBasic(page, '2+2は？', '4');
    await page.locator('#card-save').click();
    await page.waitForFunction(() => document.querySelector('select[aria-label="カード番号"]')?.value === '3');

    await page.locator('#note-type').selectOption({ label: '基本（表裏2枚）' });
    await page.waitForFunction(() => document.querySelector('select[aria-label="カード番号"]')?.value === '3');
    await fillBasic(page, '日本の首都', '東京');
    await page.locator('#card-save').click();
    await page.waitForFunction(() => document.querySelector('select[aria-label="カード番号"]')?.value === '5');

    const numbers = await page.evaluate(async () => {
      const db = await new Promise((resolve,reject)=>{const r=indexedDB.open('work_1_study_cards');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
      const tx = db.transaction('cards','readonly');
      const cards = await new Promise((resolve,reject)=>{const r=tx.objectStore('cards').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
      return cards.filter((card) => !card.deletedAt && card.deckId).map((card) => card.cardNumber).filter(Boolean).sort((a,b)=>Number(a)-Number(b));
    });
    assert.deepEqual(numbers, ['1','2','3','4'], `${name}: generated cards have unique sequential numbers`);

    await page.locator('#card-close').click();
    await page.locator('[data-route="home"]').click();
    await page.getByRole('button', { name: '数学', exact: true }).click();
    await page.getByRole('button', { name: '今すぐ学習', exact: true }).click();
    await page.waitForSelector('#review-screen:not([hidden])');
    assert.ok((await page.locator('#review-question').innerText()).trim().length > 0, `${name}: question is visible`);
    assert.match(await page.locator('#review-number').innerText(), /^No\. [1-4]$/, `${name}: card number is visible during review`);
    assert.equal(await page.locator('#answer-panel').isHidden(), true, `${name}: answer starts hidden`);
    await page.locator('#show-answer').click();
    assert.equal(await page.locator('#answer-panel').isVisible(), true, `${name}: answer is revealed after explicit action`);
    assert.equal(await page.locator('#rating-row').isVisible(), true, `${name}: four Anki-style rating buttons appear after answer`);
    const ratingButtons = page.locator('#rating-row [data-rating]');
    assert.equal(await ratingButtons.count(), 4, `${name}: Again/Hard/Good/Easy buttons exist`);
    for (let index = 0; index < 4; index += 1) {
      assert.ok((await ratingButtons.nth(index).locator('small').innerText()).trim().length > 0, `${name}: rating interval preview ${index + 1}`);
    }

    await context.close();
    process.stdout.write(`card-number-deck-review:${name}:pass\n`);
  } finally { await browser.close(); }
}

for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) await run(name, engine);
server.close();
process.stdout.write('card-number-deck-review-e2e: chromium + webkit ok\n');
