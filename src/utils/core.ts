function randomId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
export function uid(prefix='id'): string { return `${prefix}_${randomId()}`; }
export function nowIso(): string { return new Date().toISOString(); }
export function clamp(value:number,min:number,max:number):number { return Math.min(max,Math.max(min,value)); }
export function shuffle<T>(values: readonly T[]): T[] { const copy=[...values]; for(let i=copy.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1)); [copy[i],copy[j]]=[copy[j] as T,copy[i] as T];} return copy; }
export function normalizeTags(raw:string):string[]{ return [...new Set(raw.split(/[;,]/u).map(v=>v.trim()).filter(Boolean))].slice(0,100); }
export function formatDuration(ms:number):string { const s=Math.max(0,Math.round(ms/1000)); const h=Math.floor(s/3600); const m=Math.floor((s%3600)/60); const sec=s%60; return h?`${h}時間${m}分`:m?`${m}分${sec}秒`:`${sec}秒`; }
export function deviceLabel():string { const ua=navigator.userAgent; if(/iPad/i.test(ua)||(/Macintosh/i.test(ua)&&navigator.maxTouchPoints>1))return'iPad'; if(/iPhone/i.test(ua))return'iPhone'; return'Web'; }
export function downloadText(filename:string,text:string,type:string):void { const url=URL.createObjectURL(new Blob([text],{type})); const a=document.createElement('a'); a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1000); }
export function csvEscape(value:string|number|boolean|null):string { const text=value===null?'':String(value); return `"${text.replaceAll('"','""')}"`; }
