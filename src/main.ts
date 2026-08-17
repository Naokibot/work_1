import { App } from './app/app.js';
import { installCardNumberField } from './app/card-number.js';
import { installAnkiPackageHooks } from './anki/package-hooks.js';
import { installImageOcclusionEditor } from './anki/image-occlusion-editor.js';
import './study/enhancements.js';

function prepareDialogs():void{
  for(const dialog of document.querySelectorAll<HTMLDialogElement>('dialog')){
    const d=dialog as HTMLDialogElement&{showModal?:()=>void;close?:()=>void};
    if(typeof d.showModal!=='function') d.showModal=()=>dialog.setAttribute('open','');
    if(typeof d.close!=='function') d.close=()=>dialog.removeAttribute('open');
  }
  const bindings:Array<[string,string]>=[['card-close','card-dialog'],['card-cancel','card-dialog'],['study-close','study-dialog'],['study-cancel','study-dialog']];
  for(const [buttonId,dialogId] of bindings){
    document.getElementById(buttonId)?.addEventListener('click',()=>{const d=document.getElementById(dialogId) as HTMLDialogElement|null;d?.close();});
  }
}
async function persistent():Promise<void>{try{await navigator.storage?.persist?.()}catch{}}
async function serviceWorker():Promise<void>{if(!('serviceWorker'in navigator))return;try{await navigator.serviceWorker.register(new URL('sw.js',document.baseURI),{scope:'./'})}catch{}}
function bootError(error:unknown):void{const s=document.getElementById('status-message');if(!s)return;s.textContent=error instanceof Error?`初期化に失敗しました: ${error.message}`:'初期化に失敗しました。';s.classList.add('is-error');s.removeAttribute('hidden');}
try{prepareDialogs();installCardNumberField();void persistent();installAnkiPackageHooks();installImageOcclusionEditor();const app=new App();void app.init().then(serviceWorker).catch(bootError);}catch(e){bootError(e);}
