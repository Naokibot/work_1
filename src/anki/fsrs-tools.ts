import type { DeckOptionsPreset, ReviewHistory, StudyCard } from '../types.js';
import { FSRS6_DEFAULT_PARAMETERS, initialSchedule, retrievability, scheduleReview, intervalForRetention } from '../scheduler/scheduler.js';

export interface FsrsEvaluation { reviews:number; logLoss:number; rmse:number; }
function clampParam(value:number,index:number):number{if(!Number.isFinite(value))return FSRS6_DEFAULT_PARAMETERS[index]??1;if(index<=3)return Math.max(.01,Math.min(100,value));if(index===4)return Math.max(1,Math.min(10,value));if(index===20)return Math.max(.02,Math.min(1,value));return Math.max(-20,Math.min(20,value));}
export function evaluateFsrs(history:ReviewHistory[], parameters:readonly number[]=FSRS6_DEFAULT_PARAMETERS):FsrsEvaluation{
 const byCard=new Map<string,ReviewHistory[]>();for(const item of history){const arr=byCard.get(item.cardId)??[];arr.push(item);byCard.set(item.cardId,arr)}
 let loss=0,squared=0,count=0;for(const items of byCard.values()){items.sort((a,b)=>a.reviewedAt.localeCompare(b.reviewedAt));let state=initialSchedule(new Date(items[0]?.reviewedAt??Date.now()));for(const item of items){const now=new Date(item.reviewedAt);if(state.reps>0){const p=Math.max(.001,Math.min(.999,retrievability(state,now,{parameters})));const y=item.isCorrect?1:0;loss+=-(y*Math.log(p)+(1-y)*Math.log(1-p));squared+=(p-y)**2;count++}state=scheduleReview(state,item.rating,now,{parameters,desiredRetention:.9,learningStepsMinutes:[],relearningStepsMinutes:[]}).state}}
 return{reviews:count,logLoss:count?loss/count:0,rmse:count?Math.sqrt(squared/count):0};
}
export function optimizeFsrsParameters(history:ReviewHistory[], starting:readonly number[]=FSRS6_DEFAULT_PARAMETERS):number[]{
 let best=[...starting].slice(0,21).map(clampParam);while(best.length<21)best.push(FSRS6_DEFAULT_PARAMETERS[best.length]??1);let score=evaluateFsrs(history,best).logLoss;if(history.length<20)return best;
 const indices=[0,1,2,3,4,5,6,8,9,10,11,12,13,14,15,16,17,18,19,20];
 for(let pass=0;pass<2;pass++){for(const index of indices){for(const factor of [0.85,1.15]){const candidate=[...best];const current=candidate[index]??1;candidate[index]=clampParam(current===0?(factor-1):current*factor,index);const next=evaluateFsrs(history,candidate).logLoss;if(next>0&&next<score){best=candidate;score=next}}}}
 return best;
}
export function minimumRecommendedRetention(cards:StudyCard[], preset:DeckOptionsPreset):number{
 const mature=cards.filter(c=>c.schedule.stability>0);if(!mature.length)return .9;let best=.9,bestCost=Infinity;for(let r=.75;r<=.96;r+=.01){let workload=0;for(const card of mature)workload+=1/Math.max(1,intervalForRetention(card.schedule.stability,r,{parameters:preset.fsrsParameters}));const cost=workload/Math.max(.01,r);if(cost<bestCost){bestCost=cost;best=r}}return Math.round(best*100)/100;
}
export function rescheduleForRetention(cards:StudyCard[], preset:DeckOptionsPreset, now=new Date()):StudyCard[]{return cards.map(card=>{if(card.schedule.reps===0||card.schedule.stability<=0)return card;const days=Math.max(1,Math.min(preset.maximumIntervalDays,intervalForRetention(card.schedule.stability,preset.desiredRetention,{parameters:preset.fsrsParameters})));return{...card,schedule:{...card.schedule,due:new Date(now.getTime()+days*86400000).toISOString()},updatedAt:now.toISOString(),version:card.version+1}})}
