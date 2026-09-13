import {clamp,quantize} from './core.js';

// Each finger owns its gesture until release, cancellation or removal of its
// control. A second finger on the same control cannot steal the first one's hold.
export function attachGestures(a,doc=document,win=window){
 const active=new Map(),owners=new Map();
 function finish(id){
  const g=active.get(id);if(!g)return;active.delete(id);owners.delete(g.owner);clearTimeout(g.timer);
  if(g.kind==='jog'){a.engine.scratch(g.i,false);a.save();}
  else if(g.kind==='nudge')a.engine.applyDeck(g.i,a.s.decks[g.i],a.getTrack(g.i)?.bpm);
  else if(g.kind==='roll'){a.engine.roll(g.i,false);g.el.classList.remove('pressed');a.save();}
  try{if(g.el.hasPointerCapture?.(id))g.el.releasePointerCapture(id);}catch{}
 }
 function releaseAll(deck){for(const [id,g]of active)if(deck==null||g.i===deck)finish(id);}
 function capture(e,g){
  g.owner=`${g.kind}:${g.i}:${g.key||''}`;if(owners.has(g.owner)||active.has(e.pointerId))return false;
  e.preventDefault();g.el.setPointerCapture(e.pointerId);active.set(e.pointerId,g);owners.set(g.owner,e.pointerId);return true;
 }
 doc.addEventListener('pointerdown',e=>{
  if(a.layout.editing||a.controllers.learning||e.button!==0)return;
  const knob=e.target.closest('.knob'),wheel=e.target.closest('[data-jog]'),over=e.target.closest('[data-overview]'),nud=e.target.closest('[data-nudge]'),pad=e.target.closest('[data-pad]');
  if(knob){const input=knob.querySelector('input[type=range]');if(input)capture(e,{kind:'knob',el:input,i:Number(input.dataset.deck),key:input.dataset.param,x:e.clientX,y:e.clientY,value:Number(input.value),min:Number(input.min),max:Number(input.max)});return;}
  if(over){const i=Number(over.dataset.overview),r=over.getBoundingClientRect();a.seekDeck(i,(e.clientX-r.left)/r.width*(a.getTrack(i)?.duration||0));return;}
  if(wheel){const i=Number(wheel.dataset.jog);if(!a.engine.has(a.s.decks[i].trackId)){a.toast('一度再生するとジョグを使えます。');return;}
   if(capture(e,{kind:'jog',el:wheel,i,x:e.clientX,t:e.timeStamp,timer:null}))a.engine.scratch(i,true,0);return;}
  if(nud){const i=Number(nud.dataset.deck);if(capture(e,{kind:'nudge',el:nud,i}))a.engine.applyDeck(i,{...a.s.decks[i],rate:a.s.decks[i].rate*(1+Number(nud.dataset.nudge)*.035)},a.getTrack(i)?.bpm);return;}
  if(pad){const i=Number(pad.dataset.deck),t=a.getTrack(i);if(a.s.decks[i].padMode!=='roll'||!t||!a.s.decks[i].playing)return;
   if(capture(e,{kind:'roll',el:pad,i})){const beats=[.125,.25,.5,1,2,4,8,16][Number(pad.dataset.pad)],start=quantize(a.position(i),t.bpm,t.gridOffset);pad.classList.add('pressed');a.engine.roll(i,true,start,Math.min(t.duration,start+beats*60/t.bpm));}}
 });
 doc.addEventListener('pointermove',e=>{
  const g=active.get(e.pointerId);if(!g)return;e.preventDefault();
  if(g.kind==='knob'){const value=clamp(g.value+((e.clientX-g.x)-(e.clientY-g.y))*(g.max-g.min)/120,g.min,g.max);a.replaceValue(g.i,g.key,value);g.el.value=value;a.updateParamUI(g.i,g.key,value);}
  else if(g.kind==='jog'){const dt=Math.max(1,e.timeStamp-g.t),speed=clamp((e.clientX-g.x)/dt*3,-8,8);g.x=e.clientX;g.t=e.timeStamp;a.engine.scratch(g.i,true,speed);clearTimeout(g.timer);g.timer=setTimeout(()=>{if(active.get(e.pointerId)===g)a.engine.scratch(g.i,true,0);},80);}
 });
 for(const event of ['pointerup','pointercancel','lostpointercapture'])doc.addEventListener(event,e=>finish(e.pointerId));
 for(const event of ['resize','blur','pagehide'])win.addEventListener(event,()=>releaseAll());
 doc.addEventListener('visibilitychange',()=>{if(doc.hidden)releaseAll();});
 if(typeof MutationObserver!=='undefined'){const observer=new MutationObserver(()=>{for(const [id,g]of active)if(g.el.isConnected===false)finish(id);});observer.observe(doc.getElementById('workspace')||doc.body,{childList:true,subtree:true});}
 return {releaseAll};
}
