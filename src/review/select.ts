import type { AnkiState, ReviewHistory, ReviewMode, StudyCard } from '../types.js';
import { isDue, retrievability } from '../scheduler/scheduler.js';
import { shuffle } from '../utils/core.js';
import { cardsInDeck } from '../anki/collection.js';

export interface SelectionOptions {
  mode: ReviewMode;
  tag?: string;
  examSize?: number;
  newLimit?: number;
  reviewLimit?: number;
  now?: Date;
  state?: AnkiState;
  deckId?: string;
  filteredDeckId?: string;
}
export function latestHistoryByCard(history:ReviewHistory[]):Map<string,ReviewHistory>{const map=new Map<string,ReviewHistory>();for(const item of [...history].sort((a,b)=>a.reviewedAt.localeCompare(b.reviewedAt)))map.set(item.cardId,item);return map;}
function available(card:StudyCard,now:Date):boolean{return !card.deletedAt&&!card.suspended&&(!card.buriedUntil||new Date(card.buriedUntil).getTime()<=now.getTime());}
export function selectCards(cards:StudyCard[],history:ReviewHistory[],options:SelectionOptions):StudyCard[]{
 const now=options.now??new Date(); const latest=latestHistoryByCard(history); let active=cards.filter(c=>available(c,now));
 if(options.state&&options.deckId) active=cardsInDeck(active,options.state,options.deckId,true);
 let result:StudyCard[];
 switch(options.mode){
  case'new':result=active.filter(c=>(c.queue??(c.schedule.reps===0?'new':'review'))==='new').sort((a,b)=>(a.position??0)-(b.position??0)).slice(0,options.newLimit??20);break;
  case'weak':result=active.filter(c=>{const t=c.stats.correct+c.stats.incorrect;return t>=2&&c.stats.correct/t<.7;});break;
  case'wrong':result=active.filter(c=>latest.get(c.id)?.isCorrect===false);break;
  case'favorite':result=active.filter(c=>c.favorite||c.marked);break;
  case'tag':result=active.filter(c=>Boolean(options.tag)&&c.tags.includes(options.tag!));break;
  case'exam':return shuffle(active).slice(0,options.examSize??20);
  case'deck':
  case'filtered':
  case'due':
  default:{
   const learning=active.filter(c=>['learning','relearning'].includes(c.queue??'')&&isDue(c.schedule,now)).sort((a,b)=>a.schedule.due.localeCompare(b.schedule.due));
   const reviews=active.filter(c=>(c.queue??(c.schedule.reps?'review':'new'))==='review'&&isDue(c.schedule,now));
   if(options.state){const deck=options.state.decks.find(d=>d.id===(options.deckId??active[0]?.deckId));const preset=options.state.presets.find(p=>p.id===deck?.presetId)??options.state.presets[0];if(preset?.reviewOrder==='random')reviews.splice(0,reviews.length,...shuffle(reviews));else if(preset?.reviewOrder==='difficulty')reviews.sort((a,b)=>b.schedule.difficulty-a.schedule.difficulty);else if(preset?.reviewOrder==='retrievability')reviews.sort((a,b)=>retrievability(a.schedule,now)-retrievability(b.schedule,now));else if(preset?.reviewOrder==='overdue')reviews.sort((a,b)=>a.schedule.due.localeCompare(b.schedule.due));else reviews.sort((a,b)=>a.schedule.due.localeCompare(b.schedule.due));}
   result=[...learning,...reviews.slice(0,options.reviewLimit??200)];
  }
 }
 return options.mode==='random'?shuffle(active):shuffle(result);
}
