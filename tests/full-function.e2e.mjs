import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { chromium, webkit } from 'playwright';

const dist = path.resolve('dist');
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json', '.svg':'image/svg+xml', '.wasm':'application/wasm', '.webmanifest':'application/manifest+json' };
const server = http.createServer(async (req,res)=>{
  try {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    let file = path.join(dist, pathname === '/' ? 'index.html' : pathname.replace(/^\//,''));
    if ((await stat(file)).isDirectory()) file = path.join(file,'index.html');
    res.writeHead(200, {'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control':'no-store'});
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const address=server.address();
if(!address||typeof address==='string') throw new Error('server');
const url=`http://127.0.0.1:${address.port}/`;

async function idb(page, expression, arg) {
  return page.evaluate(async ({ expression, arg }) => {
    const db = await new Promise((resolve,reject)=>{ const r=indexedDB.open('work_1_study_cards'); r.onsuccess=()=>resolve(r.result); r.onerror=()=>reject(r.error); });
    const tx=db.transaction(['cards','history','snapshots','sessions','settings','queue','anki'],'readonly');
    const getAll=(name)=>new Promise((resolve,reject)=>{const r=tx.objectStore(name).getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
    const getOne=(name,key)=>new Promise((resolve,reject)=>{const r=tx.objectStore(name).get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
    if(expression==='count') return (await getAll(arg)).length;
    if(expression==='cards') return await getAll('cards');
    if(expression==='history') return await getAll('history');
    if(expression==='snapshots') return await getAll('snapshots');
    if(expression==='session') return await getOne('sessions','current');
    return null;
  }, { expression, arg });
}

function panel(page, title) { return page.locator('.settings-card').filter({ hasText: title }).first(); }
async function acceptNext(page, value='') { page.once('dialog', d => d.type()==='confirm' ? d.accept() : d.accept(value)); }

async function addDialogNote(page, { type='Basic', deck='ReviewDeck', number='', fields={}, tags='' }) {
  await page.locator('#add-card-button').click();
  await page.waitForSelector('#card-dialog[open]');
  await page.locator('#note-type').selectOption({ label:type });
  await page.locator('#note-type').dispatchEvent('change');
  if (deck) await page.locator('#note-deck').selectOption({ label:deck });
  const numberInput=page.locator('textarea[data-field="__CardNumber"]');
  if(number && await numberInput.count()) await numberInput.fill(number);
  for(const [name,value] of Object.entries(fields)) await page.locator(`textarea[data-field="${name}"]`).fill(value);
  await page.locator('#note-tags').fill(tags);
  await page.locator('#card-form').evaluate(form=>form.requestSubmit());
  await page.waitForTimeout(250);
  const error=(await page.locator('#card-form-error').textContent())?.trim();
  assert.equal(error,'',`add dialog ${type}: no validation error`);
  await page.locator('#card-close').click();
}

async function testEngine(name, engine) {
  let browser; let stage='launch';
  try {
    browser=await engine.launch({headless:true});
    const context=await browser.newContext({viewport:{width:1024,height:768},acceptDownloads:true,serviceWorkers:'allow'});
    const page=await context.newPage();
    const runtimeErrors=[]; page.on('pageerror',e=>runtimeErrors.push(String(e)));
    const consoleErrors=[]; page.on('console',msg=>{if(msg.type()==='error') consoleErrors.push(msg.text())});

    stage='boot';
    await page.goto(url,{waitUntil:'networkidle'});
    await page.waitForSelector('.main-toolbar');
    assert.equal(await page.locator('#page-title').textContent(),'デッキ');
    assert.equal(runtimeErrors.length,0,`${name}: boot runtime errors`);

    stage='pwa-manifest-service-worker';
    assert.ok(await page.locator('link[rel="manifest"]').count(),`${name}: manifest linked`);
    await page.evaluate(()=>navigator.serviceWorker?.ready);
    assert.ok(await page.evaluate(()=>Boolean(navigator.serviceWorker?.controller || navigator.serviceWorker)),`${name}: service worker available`);

    stage='deck-create';
    await acceptNext(page,'ReviewDeck');
    await page.getByRole('button',{name:'デッキを作成',exact:true}).first().click();
    await page.waitForTimeout(250);
    assert.ok((await page.locator('#view').innerText()).includes('ReviewDeck'),`${name}: deck created`);

    stage='basic-card-create';
    const beforeBasic=await idb(page,'count','cards');
    await addDialogNote(page,{number:'001',fields:{Front:'日本の首都は？',Back:'東京',Extra:'日本の首都です。'},tags:'geography japan'});
    const cardsAfterBasic=await idb(page,'cards');
    assert.equal(cardsAfterBasic.length,beforeBasic+1,`${name}: basic card generated`);
    assert.ok(cardsAfterBasic.some(c=>c.cardNumber==='001' && String(c.question).includes('日本の首都')),`${name}: card number and content persisted`);

    stage='reverse-card-create';
    const beforeReverse=(await idb(page,'cards')).length;
    await addDialogNote(page,{type:'Basic (and reversed card)',number:'R-01',fields:{Front:'表',Back:'裏',Extra:'双方向'},tags:'reverse'});
    assert.equal((await idb(page,'cards')).length,beforeReverse+2,`${name}: reverse creates two cards`);

    stage='cloze-card-create';
    const beforeCloze=(await idb(page,'cards')).length;
    await addDialogNote(page,{type:'Cloze',number:'C-01',fields:{Text:'日本の首都は {{c1::東京}}、最大都市も {{c2::東京}}。','Back Extra':'地理'},tags:'cloze'});
    assert.equal((await idb(page,'cards')).length,beforeCloze+2,`${name}: cloze creates siblings`);

    stage='custom-study-dialog';
    await page.getByRole('button',{name:'カスタム学習',exact:true}).first().click();
    await page.waitForSelector('#study-dialog[open]');
    await page.locator('#study-mode').selectOption('random');
    await page.locator('#study-style').selectOption('self');
    await page.locator('#study-cancel').click();

    stage='review-and-scratch';
    const deckButton=page.locator('.deck-name-button').filter({hasText:'ReviewDeck'}).first();
    await deckButton.click();
    await page.getByRole('button',{name:'今すぐ学習'}).click();
    await page.waitForSelector('#review-screen:not([hidden])');
    const scratch=page.locator('.scratch-section'); await scratch.evaluate(el=>el.open=true);
    const canvas=page.locator('#scratch-pad'); const box=await canvas.boundingBox();
    assert.ok(box && box.width>50 && box.height>50,`${name}: scratch canvas sized`);
    await page.mouse.move(box.x+20,box.y+20); await page.mouse.down(); await page.mouse.move(box.x+80,box.y+60,{steps:3}); await page.mouse.up();
    await page.locator('#pad-undo').click(); await page.locator('#pad-redo').click(); await page.locator('#pad-clear').click();
    await page.locator('#show-answer').click();
    await page.waitForSelector('#rating-row:not([hidden])');
    await page.locator('[data-rating="good"]').click();
    await page.waitForTimeout(250);
    assert.ok((await idb(page,'count','history'))>=1,`${name}: review history saved`);

    stage='session-restore';
    if(await page.locator('#review-screen:not([hidden])').count()===0){
      await page.locator('.deck-name-button').filter({hasText:'ReviewDeck'}).first().click();
      await page.getByRole('button',{name:'今すぐ学習'}).click();
      await page.waitForSelector('#review-screen:not([hidden])');
    }
    const sessionBefore=await idb(page,'session');
    assert.ok(sessionBefore && sessionBefore.queue?.length>sessionBefore.cursor,`${name}: active session persisted`);
    await page.reload({waitUntil:'networkidle'});
    await page.waitForSelector('#review-screen:not([hidden])');
    assert.ok((await page.locator('#status-message').textContent())?.includes('途中の学習を復元'),`${name}: interrupted session auto-restored`);
    await page.locator('#review-close').click();

    stage='browser-search-actions';
    await page.locator('[data-route="anki"]').click(); await page.waitForTimeout(250);
    const browserPanel=panel(page,'ブラウザ / 高度な検索');
    const search=browserPanel.getByLabel('検索');
    await search.fill('deck:ReviewDeck');
    await page.waitForTimeout(100);
    assert.ok(await browserPanel.locator('.anki-browser-row').count()>=1,`${name}: browser search returns cards`);
    await browserPanel.locator('.anki-browser-row input[type="checkbox"]').first().check();
    await browserPanel.locator('.browser-toolbar select').selectOption('suspend');
    await browserPanel.getByRole('button',{name:'実行'}).click(); await page.waitForTimeout(200);
    const refreshedBrowser=panel(page,'ブラウザ / 高度な検索');
    await refreshedBrowser.getByLabel('検索').fill('is:suspended'); await page.waitForTimeout(100);
    assert.ok(await refreshedBrowser.locator('.anki-browser-row').count()>=1,`${name}: suspend action persisted`);
    await refreshedBrowser.locator('.anki-browser-row input[type="checkbox"]').first().check();
    await refreshedBrowser.locator('.browser-toolbar select').selectOption('unsuspend');
    await refreshedBrowser.getByRole('button',{name:'実行'}).click(); await page.waitForTimeout(200);

    stage='filtered-deck';
    const filtered=panel(page,'フィルターデッキ / Custom Study');
    await filtered.getByLabel('名前').fill('Review Filter');
    await filtered.getByLabel('検索条件').fill('deck:ReviewDeck');
    await filtered.getByLabel('上限').fill('10');
    await filtered.getByRole('button',{name:'フィルターデッキを作成'}).click(); await page.waitForTimeout(200);
    assert.ok((await panel(page,'フィルターデッキ / Custom Study').innerText()).includes('Review Filter'),`${name}: filtered deck created`);

    stage='custom-note-type';
    const noteTypes=panel(page,'ノートタイプ / フィールド / カードテンプレート');
    await noteTypes.getByLabel('新しいノートタイプ名').fill('Review Custom');
    await noteTypes.getByRole('button',{name:'カスタムノートタイプを作成'}).click(); await page.waitForTimeout(200);
    assert.ok((await panel(page,'ノートタイプ / フィールド / カードテンプレート').innerText()).includes('Review Custom'),`${name}: custom note type created`);

    stage='fsrs-options';
    const fsrs=panel(page,'FSRS-6 / デッキオプション');
    await fsrs.getByLabel('希望保持率 (0.70〜0.99)').fill('0.91');
    await fsrs.getByRole('button',{name:'デッキオプションを保存'}).click();
    await fsrs.getByRole('button',{name:'FSRSを評価'}).click(); await page.waitForTimeout(100);
    assert.ok((await page.locator('#status-message').textContent())?.includes('FSRS評価'),`${name}: FSRS evaluation action works`);

    stage='backup-maintenance';
    const backupPanel=panel(page,'インポート / エクスポート / 自動バックアップ');
    const beforeSnapshots=await idb(page,'count','snapshots');
    await backupPanel.getByRole('button',{name:'今すぐバックアップ'}).click(); await page.waitForTimeout(200);
    assert.ok((await idb(page,'count','snapshots'))>beforeSnapshots,`${name}: manual snapshot created`);
    const maintenance=panel(page,'メンテナンス');
    await maintenance.getByRole('button',{name:'データベースをチェック'}).click(); await page.waitForTimeout(100);
    assert.ok((await page.locator('#status-message').textContent())?.includes('データベースチェック'),`${name}: database check works`);
    await maintenance.getByRole('button',{name:'メディアをチェック'}).click(); await page.waitForTimeout(100);
    assert.ok((await page.locator('#status-message').textContent())?.includes('メディアチェック'),`${name}: media check works`);

    stage='stats';
    await page.locator('[data-route="stats"]').click(); await page.waitForTimeout(150);
    const statsText=await page.locator('#view').innerText();
    assert.ok(statsText.includes('コレクション統計') && statsText.includes('カード状態 / 保持率') && statsText.includes('予測 / 間隔'),`${name}: stats page renders`);

    stage='settings-and-export';
    await page.locator('[data-route="settings"]').click(); await page.waitForTimeout(100);
    const settingsText=await page.locator('#view').innerText(); assert.ok(settingsText.includes('同期')&&settingsText.includes('読み込み / 書き出し'));
    const jsonDownload=page.waitForEvent('download'); await page.getByRole('button',{name:'完全JSON'}).click(); const jsonFile=await jsonDownload; assert.ok(jsonFile.suggestedFilename().endsWith('.json'),`${name}: JSON export`);
    const csvDownload=page.waitForEvent('download'); await page.getByRole('button',{name:'CSV',exact:true}).click(); const csvFile=await csvDownload; assert.ok(jsonFile && csvFile.suggestedFilename().endsWith('.csv'),`${name}: CSV export`);

    stage='sync-mocked-transport';
    await page.evaluate(() => {
      const nativeFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const target = typeof input === 'string' ? input : input.url;
        if (target.startsWith('https://script.google.com/macros/s/')) return new Response('', { status: 200 });
        return nativeFetch(input, init);
      };
      const nativeAppend = Element.prototype.append;
      Element.prototype.append = function(...nodes) {
        const intercepted = this === document.head && nodes.find(node => node instanceof HTMLScriptElement && node.src.startsWith('https://script.google.com/macros/s/'));
        if (intercepted) {
          const callback = new URL(intercepted.src).searchParams.get('callback');
          setTimeout(() => {
            if (callback && typeof window[callback] === 'function') {
              window[callback]({ ok:true, serverTime:new Date().toISOString(), cards:[], history:[], syncResults:[] });
            }
          }, 0);
          return;
        }
        return nativeAppend.apply(this, nodes);
      };
    });
    await page.evaluate(async()=>{const db=await import('./assets/storage/db.js');const s=await db.getSettings();await db.saveSettings({...s,gasUrl:'https://script.google.com/macros/s/abcdefghijklmnop/exec',syncSecret:'0123456789abcdef',autoSync:false});});
    await page.locator('#sync-button').click();
    await page.waitForFunction(()=>document.getElementById('status-message')?.textContent?.includes('同期完了'),null,{timeout:15000});

    stage='profile-create-switch';
    await page.locator('[data-route="anki"]').click(); await page.waitForTimeout(150);
    const profiles=panel(page,'プロファイル');
    await acceptNext(page,'Review Profile');
    await profiles.getByRole('button',{name:'プロファイルを追加'}).click(); await page.waitForTimeout(200);
    assert.equal((await page.locator('#profile-label').textContent())?.trim(),'Review Profile',`${name}: profile created and activated`);
    const profiles2=panel(page,'プロファイル'); await profiles2.getByLabel('現在のプロファイル').selectOption({label:'Default'}); await page.waitForTimeout(200);
    assert.equal((await page.locator('#profile-label').textContent())?.trim(),'Default',`${name}: profile switch works`);

    stage='offline-shell';
    await page.locator('[data-route="home"]').click();
    await page.evaluate(()=>navigator.serviceWorker?.ready);
    await page.waitForTimeout(300);
    if (name === 'chromium') {
      await context.setOffline(true);
      await page.reload({waitUntil:'domcontentloaded',timeout:15000});
      await page.waitForSelector('.main-toolbar',{timeout:10000});
      assert.ok(await page.locator('.main-toolbar').isVisible(),`${name}: offline PWA shell loads`);
      await context.setOffline(false);
    } else {
      const cachedShell = await page.evaluate(async () => {
        const names = await caches.keys();
        for (const cacheName of names) {
          const cache = await caches.open(cacheName);
          const response = await cache.match(new URL('index.html', document.baseURI));
          if (response) return true;
        }
        return false;
      });
      assert.ok(cachedShell,`${name}: Service Worker cache contains offline app shell`);
    }

    assert.equal(runtimeErrors.length,0,`${name}: no uncaught runtime errors: ${runtimeErrors.join(' | ')}`);
    process.stdout.write(`full-review:${name}:pass\n`);
  } catch(error) {
    process.stderr.write(`full-review:${name}:FAIL:${stage}\n${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    throw error;
  } finally { await browser?.close(); }
}

for (const [name,engine] of [['chromium',chromium],['webkit',webkit]]) await testEngine(name,engine);
server.close();
process.stdout.write('full-function-e2e: chromium + webkit ok\n');
