import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium, webkit } from 'playwright';
import { unzipSync } from 'fflate';
import initSqlJs from 'sql.js';

const dist = path.resolve('dist');
const mime = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.wasm':'application/wasm','.webmanifest':'application/manifest+json' };
const server = http.createServer(async (req,res)=>{try{const pathname=new URL(req.url??'/','http://localhost').pathname;let file=path.join(dist,pathname==='/'?'index.html':pathname.replace(/^\//,''));if((await stat(file)).isDirectory())file=path.join(file,'index.html');res.writeHead(200,{'Content-Type':mime[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store'});res.end(await readFile(file));}catch{res.writeHead(404);res.end('not found');}});
await new Promise((resolve)=>server.listen(0,'127.0.0.1',resolve));
const address=server.address();if(!address||typeof address==='string')throw new Error('server');const url=`http://127.0.0.1:${address.port}/`;
const temp=await mkdtemp(path.join(os.tmpdir(),'work1-deck-'));
const SQL=await initSqlJs();

async function addHistory(page, cardId) {
  await page.evaluate(async ({ cardId }) => {
    const db = await new Promise((resolve,reject)=>{const r=indexedDB.open('work_1_study_cards');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    const tx=db.transaction('history','readwrite'); const store=tx.objectStore('history');
    const days=[5,20,200,500];
    days.forEach((daysAgo,index)=>{const d=new Date();d.setDate(d.getDate()-daysAgo);const iso=d.toISOString();store.put({id:`stats_${index}`,cardId,questionSnapshot:'Q',tags:['統計タグ'],rating:index===1?'again':'good',isCorrect:index!==1,responseMs:60000,reviewedAt:iso,nextDue:iso,device:'e2e',requestId:`stats_req_${index}`});});
    await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});
  }, { cardId });
}

async function periodCount(page, label) {
  await page.getByRole('tab', { name: label }).click();
  const summary=page.locator('.stats-period-summary');
  return Number(await summary.locator('.metric').filter({hasText:'復習数'}).locator('strong').innerText());
}

async function run(name, engine) {
  const browser=await engine.launch({headless:true});
  try {
    const context=await browser.newContext({viewport:{width:1024,height:768},acceptDownloads:true,serviceWorkers:'allow'});
    const page=await context.newPage(); await page.goto(url,{waitUntil:'networkidle'}); await page.waitForSelector('.main-toolbar');

    await page.locator('#add-card-button').click();
    await page.waitForSelector('#card-dialog[open]');
    const optionLabels=await page.locator('#note-type option').allTextContents();
    for(const expected of ['基本','基本（表裏2枚）','基本（任意で表裏2枚）','基本（解答入力）','穴埋め','画像穴埋め']) assert.ok(optionLabels.includes(expected),`${name}: Japanese note type ${expected}`);
    assert.ok(await page.getByRole('textbox',{name:'表面',exact:true}).isVisible(),`${name}: Front field localized`);
    assert.ok(await page.getByRole('textbox',{name:'裏面',exact:true}).isVisible(),`${name}: Back field localized`);
    await page.locator('#card-close').click();

    page.once('dialog',(dialog)=>dialog.accept('書き出しテスト'));
    await page.getByRole('button',{name:'デッキを作成',exact:true}).click();
    await page.waitForFunction(()=>document.getElementById('view')?.textContent?.includes('書き出しテスト'));

    await page.locator('#add-card-button').click();
    await page.waitForSelector('#card-dialog[open]');
    await page.locator('#note-deck').selectOption({label:'書き出しテスト'});
    await page.getByRole('textbox',{name:'表面',exact:true}).fill('書き出し問題');
    await page.getByRole('textbox',{name:'裏面',exact:true}).fill('書き出し答え');
    await page.locator('#card-save').click();
    await page.waitForFunction(()=>document.getElementById('status-message')?.textContent?.includes('カードを追加'));
    await page.locator('#card-close').click();

    const cardId=await page.evaluate(async()=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('work_1_study_cards');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});const tx=db.transaction('cards','readonly');const cards=await new Promise((resolve,reject)=>{const r=tx.objectStore('cards').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});return cards.find((card)=>card.question.includes('書き出し問題'))?.id;});
    assert.ok(cardId,`${name}: card created`); await addHistory(page,cardId);

    await page.locator('[data-route="home"]').click();
    await page.getByRole('button',{name:'書き出しテスト',exact:true}).click();
    const downloadPromise=page.waitForEvent('download');
    await page.getByRole('button',{name:'デッキを書き出す (.apkg)',exact:true}).click();
    const download=await downloadPromise; const saved=path.join(temp,`${name}-書き出しテスト.apkg`); await download.saveAs(saved);
    assert.match(download.suggestedFilename(),/書き出しテスト\.apkg$/,`${name}: deck-specific filename`);
    const archive=unzipSync(new Uint8Array(await readFile(saved))); assert.ok(archive['collection.anki21'],`${name}: legacy-compatible Anki collection present`);
    const db=new SQL.Database(archive['collection.anki21']);
    assert.equal(db.exec('select count(*) from notes')[0].values[0][0],1,`${name}: one exported note`);
    assert.equal(db.exec('select count(*) from cards')[0].values[0][0],1,`${name}: one exported card`);
    const decks=JSON.parse(String(db.exec('select decks from col')[0].values[0][0]));
    assert.ok(Object.values(decks).some((deck)=>deck.name==='書き出しテスト'),`${name}: selected deck exported`); db.close();

    await page.locator('[data-route="stats"]').click();
    assert.equal(await periodCount(page,'過去1週間'),1,`${name}: week stats`);
    assert.equal(await periodCount(page,'過去1か月'),2,`${name}: month stats`);
    assert.equal(await periodCount(page,'過去1年'),3,`${name}: year stats`);
    assert.equal(await periodCount(page,'全期間'),4,`${name}: all-time stats`);

    const clean=await browser.newContext({viewport:{width:1024,height:768},serviceWorkers:'allow'}); const imported=await clean.newPage();
    await imported.goto(url,{waitUntil:'networkidle'}); await imported.locator('#import-file').setInputFiles(saved);
    await imported.waitForFunction(()=>document.getElementById('status-message')?.textContent?.includes('Ankiパッケージを読み込みました'));
    await imported.waitForTimeout(900); await imported.waitForSelector('.main-toolbar');
    assert.ok((await imported.locator('#view').innerText()).includes('書き出しテスト'),`${name}: exported Anki deck can be re-imported`);
    await clean.close(); await context.close(); process.stdout.write(`deck-portability-stats:${name}:pass\n`);
  } finally { await browser.close(); }
}
for(const [name,engine] of [['chromium',chromium],['webkit',webkit]]) await run(name,engine);
server.close(); process.stdout.write('deck-portability-stats-e2e: chromium + webkit ok\n');
