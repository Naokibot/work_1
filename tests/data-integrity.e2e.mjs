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

async function run(name, engine) {
  const browser=await engine.launch({headless:true});
  try {
    const context=await browser.newContext({viewport:{width:1024,height:768},timezoneId:'Asia/Tokyo',serviceWorkers:'allow'});
    const page=await context.newPage();
    await page.goto(url,{waitUntil:'networkidle'});
    await page.waitForSelector('.main-toolbar');
    const result=await page.evaluate(async()=>{
      const db=await import('/assets/storage/db.js');
      const collection=await import('/assets/anki/collection.js');
      const defaults=await import('/assets/anki/defaults.js');
      const now='2026-08-18T00:00:00.000Z';
      const state=defaults.createDefaultAnkiState();
      state.profiles.push({id:'profile_b',name:'B',createdAt:now});
      state.decks.push(
        {id:'deck_math_a',profileId:'profile_default',name:'Math',description:'',presetId:'preset_default',createdAt:now,updatedAt:now},
        {id:'deck_default_b',profileId:'profile_b',name:'Default',description:'',presetId:'preset_default',createdAt:now,updatedAt:now},
        {id:'deck_geometry_b',profileId:'profile_b',name:'Math::Geometry',description:'',presetId:'preset_default',createdAt:now,updatedAt:now}
      );
      const a={...defaults.emptyCard(new Date(now)),id:'card_integrity_a',question:'A',answer:'A answer',profileId:'profile_default',deckId:'deck_math_a'};
      const b={...defaults.emptyCard(new Date(now)),id:'card_integrity_b',question:'B',answer:'B answer',profileId:'profile_b',deckId:'deck_geometry_b'};
      await db.replaceCollection([a,b],[],state);

      const snapshot=await collection.createSnapshot('manual','multi-profile');
      await collection.restoreSnapshot(snapshot.id);
      const restored=(await db.getCards(true,true)).map(card=>card.id).sort();

      await collection.renameDeck('deck_math_a','Mathematics');
      let renamedState=await db.getAnkiState();
      const otherAfterRename=renamedState.decks.find(deck=>deck.id==='deck_geometry_b')?.name;
      renamedState={...renamedState,decks:renamedState.decks.map(deck=>deck.id==='deck_math_a'?{...deck,name:'Math'}:deck.id==='deck_geometry_b'?{...deck,name:'Math::Geometry'}:deck)};
      await db.saveAnkiState(renamedState);
      await collection.deleteDeck('deck_math_a');
      const afterDelete=await db.getAnkiState();
      const otherDeckExists=afterDelete.decks.some(deck=>deck.id==='deck_geometry_b'&&deck.profileId==='profile_b');
      const movedA=(await db.getCard('card_integrity_a',true))?.deckId;

      await db.saveCurrentSession({id:'current',mode:'deck',style:'self',queue:['card_integrity_a'],cursor:0,answered:0,tag:'',examSize:20,startedAt:now,profileId:'profile_default'});
      await db.saveAnkiState({...afterDelete,activeProfileId:'profile_b'});
      const crossProfileSession=await db.getCurrentSession();

      const historyA={id:'history_integrity_a',cardId:'card_integrity_a',questionSnapshot:'A',tags:[],rating:'good',isCorrect:true,responseMs:1000,reviewedAt:now,nextDue:now,device:'e2e',requestId:'req_historyaaaaaa',profileId:'profile_default',source:'scheduled',wasNew:false};
      const historyB={...historyA,id:'history_integrity_b',cardId:'card_integrity_b',questionSnapshot:'B',requestId:'req_historybbbbbb',profileId:'profile_b'};
      await db.saveHistory(historyA,false);await db.saveHistory(historyB,false);
      const visibleHistory=(await db.getHistory()).map(item=>item.id);

      const bCurrent=await db.getCard('card_integrity_b');
      await db.saveCard({...bCurrent,flag:2,version:bCurrent.version+1,updatedAt:'2026-08-18T00:01:00.000Z'});
      const once=await db.getCard('card_integrity_b');
      await db.saveCard({...once,flag:3,version:once.version+1,updatedAt:'2026-08-18T00:02:00.000Z'});
      const queued=(await db.getQueue()).filter(item=>item.action==='upsertCard'&&item.payload.card?.id==='card_integrity_b');

      await db.replaceCollection([a,b],[],state);
      await collection.pushUndo('review integrity',[a]);
      const changed={...a,version:2,updatedAt:'2026-08-18T00:03:00.000Z',flag:4};
      await db.saveCard(changed);
      await db.saveHistory(historyA);
      await collection.undoLast();
      const undone=await db.getCard('card_integrity_a');
      const historyAfterUndo=await db.getHistory();
      const queueAfterUndo=await db.getQueue();

      return {
        restored,
        otherAfterRename,
        otherDeckExists,
        movedA,
        crossProfileSession:Boolean(crossProfileSession),
        visibleHistory,
        queueRequestIds:queued.map(item=>item.requestId),
        undoneFlag:undone?.flag??0,
        historyAfterUndo:historyAfterUndo.map(item=>item.id),
        appendAfterUndo:queueAfterUndo.filter(item=>item.action==='appendHistory'&&item.payload.history?.id==='history_integrity_a').length
      };
    });

    assert.deepEqual(result.restored,['card_integrity_a','card_integrity_b'],`${name}: snapshot keeps every profile`);
    assert.equal(result.otherAfterRename,'Math::Geometry',`${name}: rename stays within profile`);
    assert.equal(result.otherDeckExists,true,`${name}: delete stays within profile`);
    assert.equal(result.movedA,'deck_default',`${name}: deleted deck cards move to same-profile Default`);
    assert.equal(result.crossProfileSession,false,`${name}: stale profile session is discarded`);
    assert.deepEqual(result.visibleHistory,['history_integrity_b'],`${name}: history is profile scoped`);
    assert.equal(result.queueRequestIds.length,2,`${name}: both local edits enter sync queue`);
    assert.notEqual(result.queueRequestIds[0],result.queueRequestIds[1],`${name}: local edits get fresh request IDs`);
    assert.equal(result.undoneFlag,0,`${name}: undo restores card state`);
    assert.ok(!result.historyAfterUndo.includes('history_integrity_a'),`${name}: undo removes generated history`);
    assert.equal(result.appendAfterUndo,0,`${name}: undo removes unsent history queue entry`);
    await context.close();
    process.stdout.write(`data-integrity:${name}:pass\n`);
  } finally { await browser.close(); }
}

for(const [name,engine] of [['chromium',chromium],['webkit',webkit]]) await run(name,engine);
server.close();
process.stdout.write('data-integrity-e2e: chromium + webkit ok\n');
