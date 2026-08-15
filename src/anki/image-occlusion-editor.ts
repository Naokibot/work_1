import type { ImageOcclusionMask } from '../types.js';
import { createNote } from './collection.js';
import { serializeNativeOcclusions } from './image-occlusion.js';
import { getAnkiState } from '../storage/db.js';
import { uid } from '../utils/core.js';

type Tool = 'select' | 'rect' | 'ellipse' | 'polygon' | 'text';
type Point = { x: number; y: number };

function cloneMasks(masks: ImageOcclusionMask[]): ImageOcclusionMask[] {
  return masks.map((mask) => ({ ...mask, points: mask.points?.map((point) => ({ ...point })) }));
}

function clamp(value: number, min = 0, max = 100): number { return Math.max(min, Math.min(max, value)); }

function style(): HTMLStyleElement {
  const node = document.createElement('style');
  node.textContent = `
  .io-editor-dialog{width:min(1100px,calc(100vw - 18px));max-width:none;height:min(850px,calc(100vh - 18px));padding:0;border:1px solid #777;border-radius:5px;background:#ececec;color:#222;box-shadow:0 14px 44px rgba(0,0,0,.35)}
  .io-editor-dialog::backdrop{background:rgba(0,0,0,.34)}
  .io-editor-shell{display:grid;grid-template-rows:auto auto 1fr auto;height:100%;min-height:0}
  .io-editor-title{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:linear-gradient(#f7f7f7,#ddd);border-bottom:1px solid #bbb;font-weight:600}
  .io-editor-title button{border:0;background:transparent;font-size:21px;padding:0 7px}
  .io-editor-toolbar{display:flex;align-items:center;gap:4px;flex-wrap:wrap;padding:6px 8px;border-bottom:1px solid #c9c9c9;background:#f4f4f4}
  .io-editor-toolbar button,.io-editor-toolbar select{min-height:30px;border:1px solid #aaa;border-radius:3px;background:linear-gradient(#fff,#e7e7e7);padding:4px 9px}
  .io-editor-toolbar button.is-active{background:#d9ecff;border-color:#6d9fc4}
  .io-editor-toolbar .sep{width:1px;height:24px;background:#bbb;margin:0 3px}
  .io-editor-body{display:grid;grid-template-columns:minmax(0,1fr) 280px;min-height:0;overflow:hidden}
  .io-editor-canvas-wrap{overflow:auto;display:grid;place-items:center;background:#777;padding:14px;min-height:0}
  .io-editor-stage{position:relative;display:inline-block;max-width:100%;touch-action:none;user-select:none;background:#fff;line-height:0}
  .io-editor-stage img{display:block;max-width:100%;max-height:calc(100vh - 210px);width:auto;height:auto;pointer-events:none}
  .io-editor-mask{position:absolute;background:rgba(40,40,40,.72);border:2px solid rgba(255,255,255,.95);box-shadow:0 0 0 1px rgba(0,0,0,.65);cursor:pointer;line-height:normal;color:#fff;overflow:hidden;transform-origin:center}
  .io-editor-mask.shape-ellipse{border-radius:50%}.io-editor-mask.shape-polygon{left:0!important;top:0!important;width:100%!important;height:100%!important}
  .io-editor-mask.is-selected{outline:2px solid #5db8ff;outline-offset:2px;background:rgba(35,100,170,.72)}
  .io-editor-mask .resize{position:absolute;width:13px;height:13px;right:-2px;bottom:-2px;background:#fff;border:1px solid #12689e;cursor:nwse-resize;border-radius:2px}
  .io-editor-mask.shape-polygon .resize{display:none}
  .io-editor-draft{position:absolute;pointer-events:none;border:2px dashed #70c9ff;background:rgba(50,140,210,.28)}
  .io-editor-sidebar{overflow:auto;border-left:1px solid #bbb;background:#f6f6f6;padding:10px}
  .io-editor-sidebar label{display:grid;gap:4px;margin:8px 0;font-size:12px}.io-editor-sidebar textarea{min-height:64px;resize:vertical}.io-editor-sidebar input,.io-editor-sidebar textarea{width:100%;border:1px solid #aaa;background:#fff;color:#222;border-radius:3px;padding:6px}
  .io-mask-list{display:grid;gap:4px;margin-top:8px}.io-mask-item{display:flex;align-items:center;gap:5px;text-align:left;border:1px solid #ccc;background:#fff;padding:5px;border-radius:3px;font-size:12px}.io-mask-item.is-selected{border-color:#5a9cca;background:#e8f4fd}
  .io-editor-footer{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 10px;border-top:1px solid #bbb;background:#f3f3f3}.io-editor-footer .actions{display:flex;gap:7px}.io-editor-footer button{min-height:32px;border:1px solid #999;border-radius:4px;padding:5px 13px;background:linear-gradient(#fff,#e6e6e6)}.io-editor-footer .primary{background:linear-gradient(#4e98d4,#2b76ae);border-color:#256493;color:#fff}
  .io-editor-empty{padding:36px;text-align:center;color:#eee;line-height:1.6}.io-editor-hint{font-size:11px;color:#666;line-height:1.45;margin:7px 0}.io-editor-count{font-size:12px;color:#666}
  .review-io-stage{position:relative;display:inline-block;max-width:100%;line-height:0}.review-io-stage img{display:block;max-width:100%;height:auto}.review-io-mask{position:absolute;background:rgba(55,55,55,.82);border:1px solid rgba(255,255,255,.95);box-sizing:border-box;transform-origin:center}.review-io-mask.shape-ellipse{border-radius:50%}.review-io-mask.is-inactive{background:rgba(70,70,70,.62)}
  @media(max-width:760px){.io-editor-dialog{width:100vw;height:100vh;max-height:none;border:0;border-radius:0}.io-editor-body{grid-template-columns:1fr;grid-template-rows:minmax(300px,1fr) auto}.io-editor-sidebar{border-left:0;border-top:1px solid #bbb;max-height:250px}.io-editor-stage img{max-height:55vh}.io-editor-toolbar{overflow-x:auto;flex-wrap:nowrap}.io-editor-toolbar button{white-space:nowrap}}
  @media(prefers-color-scheme:dark){.io-editor-dialog{background:#292929;color:#eee}.io-editor-title,.io-editor-toolbar,.io-editor-footer{background:#333;border-color:#555}.io-editor-toolbar button,.io-editor-toolbar select,.io-editor-footer button{background:#3b3b3b;color:#eee;border-color:#666}.io-editor-sidebar{background:#303030;border-color:#555}.io-editor-sidebar input,.io-editor-sidebar textarea,.io-mask-item{background:#222;color:#eee;border-color:#555}.io-editor-hint,.io-editor-count{color:#bbb}}
  `;
  return node;
}

class ImageOcclusionEditor {
  private readonly dialog = document.createElement('dialog');
  private readonly stage = document.createElement('div');
  private readonly image = document.createElement('img');
  private readonly file = document.createElement('input');
  private readonly mode = document.createElement('select');
  private readonly maskList = document.createElement('div');
  private readonly header = document.createElement('textarea');
  private readonly backExtra = document.createElement('textarea');
  private readonly comments = document.createElement('textarea');
  private readonly count = document.createElement('span');
  private readonly saveButton = document.createElement('button');
  private readonly finishPolygonButton = document.createElement('button');
  private tool: Tool = 'select';
  private masks: ImageOcclusionMask[] = [];
  private selectedId: string | null = null;
  private undoStack: ImageOcclusionMask[][] = [];
  private redoStack: ImageOcclusionMask[][] = [];
  private polygon: Point[] = [];
  private gesture: { kind: 'draw' | 'move' | 'resize'; id?: string; start: Point; original?: ImageOcclusionMask } | null = null;
  private draft: HTMLElement | null = null;
  private imageDataUrl = '';

  constructor() {
    this.dialog.className = 'io-editor-dialog';
    this.dialog.setAttribute('aria-label', 'Image Occlusion');
    this.build();
    this.bind();
    document.body.append(this.dialog);
  }

  open(): void {
    this.reset();
    const cardDialog = document.getElementById('card-dialog') as HTMLDialogElement | null;
    cardDialog?.close();
    this.dialog.showModal();
  }

  private build(): void {
    const shell = document.createElement('div'); shell.className = 'io-editor-shell';
    const title = document.createElement('div'); title.className = 'io-editor-title'; title.append(document.createTextNode('Image Occlusion'));
    const close = document.createElement('button'); close.type = 'button'; close.textContent = '×'; close.dataset.action = 'close'; title.append(close);
    const toolbar = document.createElement('div'); toolbar.className = 'io-editor-toolbar';
    for (const [tool, label] of [['select','選択'],['rect','矩形'],['ellipse','楕円'],['polygon','多角形'],['text','テキスト']] as Array<[Tool,string]>) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.dataset.tool = tool; if (tool === 'select') button.classList.add('is-active'); toolbar.append(button);
    }
    const sep1 = document.createElement('span'); sep1.className = 'sep'; toolbar.append(sep1);
    this.finishPolygonButton.type = 'button'; this.finishPolygonButton.textContent = '多角形を確定'; this.finishPolygonButton.hidden = true; toolbar.append(this.finishPolygonButton);
    for (const [action,label] of [['undo','元に戻す'],['redo','やり直す'],['duplicate','複製'],['delete','削除']] as const) {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.action = action; button.textContent = label; toolbar.append(button);
    }
    const sep2 = document.createElement('span'); sep2.className = 'sep'; toolbar.append(sep2);
    this.file.type = 'file'; this.file.accept = 'image/*'; this.file.hidden = true;
    const load = document.createElement('button'); load.type = 'button'; load.dataset.action = 'load'; load.textContent = '画像を開く'; toolbar.append(load, this.file);
    const modeLabel = document.createElement('label'); modeLabel.textContent = 'モード '; this.mode.append(new Option('Hide All, Guess One','hide-all-guess-one'), new Option('Hide One, Guess One','hide-one-guess-one')); modeLabel.append(this.mode); toolbar.append(modeLabel);

    const body = document.createElement('div'); body.className = 'io-editor-body';
    const canvasWrap = document.createElement('div'); canvasWrap.className = 'io-editor-canvas-wrap';
    this.stage.className = 'io-editor-stage'; this.stage.tabIndex = 0;
    const empty = document.createElement('div'); empty.className = 'io-editor-empty'; empty.dataset.empty = 'true'; empty.textContent = '画像を開く、または画像をここへ貼り付けてください。';
    this.image.alt = ''; this.image.hidden = true; this.stage.append(empty, this.image); canvasWrap.append(this.stage);
    const sidebar = document.createElement('aside'); sidebar.className = 'io-editor-sidebar';
    sidebar.append(this.field('Header', this.header), this.field('Back Extra', this.backExtra), this.field('Comments', this.comments));
    const hint = document.createElement('p'); hint.className = 'io-editor-hint'; hint.textContent = '矩形・楕円はドラッグ。多角形は頂点を順にタップして「多角形を確定」。選択ツールでは移動と右下ハンドルでリサイズできます。Deleteキーでも削除できます。'; sidebar.append(hint);
    this.maskList.className = 'io-mask-list'; sidebar.append(this.maskList); body.append(canvasWrap, sidebar);
    const footer = document.createElement('div'); footer.className = 'io-editor-footer'; this.count.className = 'io-editor-count'; footer.append(this.count);
    const actions = document.createElement('div'); actions.className = 'actions'; const cancel = document.createElement('button'); cancel.type='button';cancel.dataset.action='close';cancel.textContent='キャンセル';this.saveButton.type='button';this.saveButton.className='primary';this.saveButton.textContent='追加';actions.append(cancel,this.saveButton);footer.append(actions);
    shell.append(title, toolbar, body, footer); this.dialog.append(shell);
  }

  private field(labelText: string, textarea: HTMLTextAreaElement): HTMLLabelElement { const label=document.createElement('label');label.textContent=labelText;label.append(textarea);return label; }

  private bind(): void {
    this.dialog.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button'); if (!button) return;
      if (button.dataset.tool) this.setTool(button.dataset.tool as Tool);
      else if (button.dataset.action === 'close') this.dialog.close();
      else if (button.dataset.action === 'load') this.file.click();
      else if (button.dataset.action === 'undo') this.undo();
      else if (button.dataset.action === 'redo') this.redo();
      else if (button.dataset.action === 'delete') this.deleteSelected();
      else if (button.dataset.action === 'duplicate') this.duplicateSelected();
    });
    this.file.addEventListener('change', () => { const image = this.file.files?.[0]; if (image) void this.loadImage(image); });
    this.finishPolygonButton.addEventListener('click', () => this.finishPolygon());
    this.saveButton.addEventListener('click', () => void this.save());
    this.stage.addEventListener('pointerdown', (event) => this.pointerDown(event));
    this.stage.addEventListener('pointermove', (event) => this.pointerMove(event));
    this.stage.addEventListener('pointerup', (event) => this.pointerUp(event));
    this.stage.addEventListener('pointercancel', (event) => this.pointerUp(event));
    this.stage.addEventListener('dblclick', () => { if (this.tool === 'polygon') this.finishPolygon(); });
    this.dialog.addEventListener('keydown', (event) => {
      if ((event.key === 'Delete' || event.key === 'Backspace') && !['INPUT','TEXTAREA'].includes((event.target as HTMLElement).tagName)) { event.preventDefault(); this.deleteSelected(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? this.redo() : this.undo(); }
    });
    this.dialog.addEventListener('paste', (event) => { const image=[...(event.clipboardData?.files ?? [])].find((file)=>file.type.startsWith('image/'));if(image){event.preventDefault();void this.loadImage(image);} });
    this.stage.addEventListener('dragover', (event) => event.preventDefault());
    this.stage.addEventListener('drop', (event) => { event.preventDefault(); const image=[...(event.dataTransfer?.files ?? [])].find((file)=>file.type.startsWith('image/'));if(image)void this.loadImage(image); });
  }

  private reset(): void {
    this.masks=[];this.selectedId=null;this.undoStack=[];this.redoStack=[];this.polygon=[];this.imageDataUrl='';this.image.src='';this.image.hidden=true;this.header.value='';this.backExtra.value='';this.comments.value='';this.file.value='';this.setTool('select');this.render();
  }

  private async loadImage(file: File): Promise<void> {
    if (!file.type.startsWith('image/')) return;
    if (file.size > 30 * 1024 * 1024) { this.setStatus('画像は30MB以下にしてください。', true); return; }
    const reader = new FileReader();
    const data = await new Promise<string>((resolve, reject) => { reader.onload=()=>resolve(String(reader.result??''));reader.onerror=()=>reject(reader.error);reader.readAsDataURL(file); });
    this.imageDataUrl=data;this.image.src=data;this.image.hidden=false;this.stage.querySelector<HTMLElement>('[data-empty]')?.setAttribute('hidden','');this.masks=[];this.pushSnapshot([]);this.render();
  }

  private point(event: PointerEvent): Point {
    const rect=this.stage.getBoundingClientRect();return{x:clamp((event.clientX-rect.left)/Math.max(1,rect.width)*100),y:clamp((event.clientY-rect.top)/Math.max(1,rect.height)*100)};
  }

  private pointerDown(event: PointerEvent): void {
    if (!this.imageDataUrl || event.button > 0) return;
    const target=(event.target as HTMLElement).closest<HTMLElement>('.io-editor-mask');
    const handle=(event.target as HTMLElement).closest<HTMLElement>('.resize');
    if (target) {
      const id=target.dataset.maskId??null;this.selectedId=id;this.render();
      const mask=this.masks.find((item)=>item.id===id);if(!mask)return;
      this.gesture={kind:handle?'resize':'move',id:mask.id,start:this.point(event),original:{...mask,points:mask.points?.map((point)=>({...point}))}};
      this.stage.setPointerCapture(event.pointerId);event.preventDefault();return;
    }
    if(this.tool==='select') { this.selectedId=null;this.render();return; }
    const p=this.point(event);
    if(this.tool==='polygon'){this.polygon.push(p);this.finishPolygonButton.hidden=this.polygon.length<3;this.renderDraftPolygon();event.preventDefault();return;}
    if(this.tool==='text'){const text=window.prompt('テキスト','');if(text){this.commit([{id:uid('io'),shape:'text',x:p.x,y:p.y,width:20,height:8,answer:text,text}]);}return;}
    this.gesture={kind:'draw',start:p};this.stage.setPointerCapture(event.pointerId);this.showDraft(p,p,this.tool);event.preventDefault();
  }

  private pointerMove(event: PointerEvent): void {
    if(!this.gesture)return;const p=this.point(event),g=this.gesture;
    if(g.kind==='draw'){this.showDraft(g.start,p,this.tool);return;}
    if(!g.id||!g.original)return;
    const dx=p.x-g.start.x,dy=p.y-g.start.y,original=g.original;
    const index=this.masks.findIndex((mask)=>mask.id===g.id);if(index<0)return;
    if(g.kind==='move'){
      const next={...original,x:clamp(original.x+dx,0,100-original.width),y:clamp(original.y+dy,0,100-original.height),points:original.points?.map((point)=>({x:clamp(point.x+dx),y:clamp(point.y+dy)}))};this.masks[index]=next;
    }else{
      const width=clamp(original.width+dx,.2,100-original.x),height=clamp(original.height+dy,.2,100-original.y);this.masks[index]={...original,width,height};
    }
    this.render(false);
  }

  private pointerUp(event: PointerEvent): void {
    if(!this.gesture)return;const p=this.point(event),g=this.gesture;this.gesture=null;try{this.stage.releasePointerCapture(event.pointerId)}catch{}
    if(g.kind==='draw'){this.removeDraft();const left=Math.min(g.start.x,p.x),top=Math.min(g.start.y,p.y),width=Math.abs(p.x-g.start.x),height=Math.abs(p.y-g.start.y);if(width>.4&&height>.4)this.commit([{id:uid('io'),shape:this.tool==='ellipse'?'ellipse':'rect',x:left,y:top,width,height,answer:''}]);}
    else this.saveHistory();
  }

  private showDraft(a:Point,b:Point,shape:Tool):void{this.removeDraft();const node=document.createElement('div');node.className='io-editor-draft';const left=Math.min(a.x,b.x),top=Math.min(a.y,b.y),width=Math.abs(a.x-b.x),height=Math.abs(a.y-b.y);Object.assign(node.style,{left:left+'%',top:top+'%',width:width+'%',height:height+'%',borderRadius:shape==='ellipse'?'50%':'0'});this.stage.append(node);this.draft=node;}
  private renderDraftPolygon():void{this.removeDraft();if(this.polygon.length<2)return;const node=document.createElement('div');node.className='io-editor-draft';Object.assign(node.style,{left:'0',top:'0',width:'100%',height:'100%',clipPath:'polygon('+this.polygon.map((point)=>point.x+'% '+point.y+'%').join(',')+')'});this.stage.append(node);this.draft=node;}
  private removeDraft():void{this.draft?.remove();this.draft=null;}
  private finishPolygon():void{if(this.polygon.length<3)return;const points=[...this.polygon],xs=points.map((p)=>p.x),ys=points.map((p)=>p.y),x=Math.min(...xs),y=Math.min(...ys),width=Math.max(...xs)-x,height=Math.max(...ys)-y;this.polygon=[];this.finishPolygonButton.hidden=true;this.removeDraft();this.commit([{id:uid('io'),shape:'polygon',x,y,width,height,points,answer:''}]);}

  private commit(additions:ImageOcclusionMask[]):void{this.undoStack.push(cloneMasks(this.masks));this.redoStack=[];this.masks=[...this.masks,...additions];this.selectedId=additions.at(-1)?.id??null;this.render();}
  private saveHistory():void{if(!this.gesture){this.undoStack.push(cloneMasks(this.masks));this.redoStack=[];this.render();}}
  private undo():void{const previous=this.undoStack.pop();if(!previous)return;this.redoStack.push(cloneMasks(this.masks));this.masks=previous;this.selectedId=null;this.render();}
  private redo():void{const next=this.redoStack.pop();if(!next)return;this.undoStack.push(cloneMasks(this.masks));this.masks=next;this.selectedId=null;this.render();}
  private deleteSelected():void{if(!this.selectedId)return;const before=cloneMasks(this.masks);this.masks=this.masks.filter((mask)=>mask.id!==this.selectedId);if(this.masks.length!==before.length){this.undoStack.push(before);this.redoStack=[];}this.selectedId=null;this.render();}
  private duplicateSelected():void{const mask=this.masks.find((item)=>item.id===this.selectedId);if(!mask)return;const dx=2,dy=2;this.commit([{...mask,id:uid('io'),x:clamp(mask.x+dx),y:clamp(mask.y+dy),points:mask.points?.map((point)=>({x:clamp(point.x+dx),y:clamp(point.y+dy)}))}]);}
  private setTool(tool:Tool):void{this.tool=tool;this.polygon=[];this.finishPolygonButton.hidden=true;this.removeDraft();this.dialog.querySelectorAll<HTMLButtonElement>('button[data-tool]').forEach((button)=>button.classList.toggle('is-active',button.dataset.tool===tool));}

  private render(rebuildList=true):void{
    this.stage.querySelectorAll('.io-editor-mask').forEach((node)=>node.remove());this.removeDraft();
    for(const mask of this.masks){const node=document.createElement('div'),shape=mask.shape??'rect';node.dataset.maskId=mask.id;node.className='io-editor-mask shape-'+shape+(mask.id===this.selectedId?' is-selected':'');if(shape==='polygon'&&mask.points?.length){Object.assign(node.style,{left:'0',top:'0',width:'100%',height:'100%',clipPath:'polygon('+mask.points.map((point)=>point.x+'% '+point.y+'%').join(',')+')'});}else{Object.assign(node.style,{left:mask.x+'%',top:mask.y+'%',width:mask.width+'%',height:mask.height+'%'});if(mask.angle)node.style.transform='rotate('+mask.angle+'deg)';}if(shape==='text')node.textContent=mask.text||mask.answer||'Text';if(mask.id===this.selectedId&&shape!=='polygon'){const handle=document.createElement('span');handle.className='resize';node.append(handle);}this.stage.append(node);}
    if(this.polygon.length>=2)this.renderDraftPolygon();this.count.textContent=`マスク ${this.masks.length}個`;this.saveButton.disabled=!this.imageDataUrl||!this.masks.length;
    if(rebuildList){this.maskList.replaceChildren();this.masks.forEach((mask,index)=>{const item=document.createElement('button');item.type='button';item.className='io-mask-item'+(mask.id===this.selectedId?' is-selected':'');item.textContent=`${index+1}. ${mask.shape??'rect'}${mask.text?' — '+mask.text:''}`;item.addEventListener('click',()=>{this.selectedId=mask.id;this.setTool('select');this.render();});this.maskList.append(item);});}
  }

  private async save():Promise<void>{
    if(!this.imageDataUrl||!this.masks.length)return;
    try{
      const state=await getAnkiState(),typeSelect=document.getElementById('note-type') as HTMLSelectElement|null,deckSelect=document.getElementById('note-deck') as HTMLSelectElement|null,tagsInput=document.getElementById('note-tags') as HTMLInputElement|null;
      const noteType=state.noteTypes.find((type)=>type.id===typeSelect?.value&&type.kind==='image-occlusion')??state.noteTypes.find((type)=>type.kind==='image-occlusion');if(!noteType)throw new Error('Image Occlusionノートタイプが見つかりません。');
      const deckId=deckSelect?.value||state.decks.find((deck)=>deck.profileId===state.activeProfileId)?.id;if(!deckId)throw new Error('デッキが見つかりません。');
      const tags=(tagsInput?.value??'').split(/[\s,]+/).map((tag)=>tag.trim()).filter(Boolean);
      const fields:Record<string,string>={Occlusions:serializeNativeOcclusions(this.masks,this.mode.value as 'hide-all-guess-one'|'hide-one-guess-one'),Image:this.imageDataUrl,Header:this.header.value,'Back Extra':this.backExtra.value,Comments:this.comments.value,Masks:JSON.stringify(this.masks),Extra:this.backExtra.value};
      const cards=await createNote({profileId:state.activeProfileId,deckId,noteTypeId:noteType.id,fields,tags});if(!cards.length)throw new Error('Image Occlusionカードを生成できませんでした。');
      this.setStatus(`Image Occlusionを${cards.length}枚追加しました。`);this.dialog.close();window.setTimeout(()=>window.location.reload(),350);
    }catch(error){this.setStatus(error instanceof Error?error.message:'Image Occlusionの保存に失敗しました。',true);}
  }

  private setStatus(message:string,error=false):void{const status=document.getElementById('status-message');if(!status)return;status.textContent=message;status.classList.toggle('is-error',error);status.removeAttribute('hidden');}
}

let editor:ImageOcclusionEditor|null=null;
export function installImageOcclusionEditor():void{
  if(!document.getElementById('io-editor-style')){const styles=style();styles.id='io-editor-style';document.head.append(styles);}
  editor=new ImageOcclusionEditor();
  document.addEventListener('click',(event)=>{const button=(event.target as HTMLElement).closest<HTMLButtonElement>('#note-fields button');if(!button||!button.textContent?.includes('Image Occlusion'))return;const select=document.getElementById('note-type') as HTMLSelectElement|null;if(!select)return;void getAnkiState().then((state)=>{const type=state.noteTypes.find((item)=>item.id===select.value);if(type?.kind!=='image-occlusion')return;event.preventDefault();event.stopImmediatePropagation();editor?.open();});},true);
}
