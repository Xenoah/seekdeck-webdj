import assert from 'node:assert/strict';
import test from 'node:test';
import {attachGestures} from '../dist/gestures.js';
import {defaultSession} from '../dist/core.js';
function setup(){
 const listeners=new Map(),windowListeners=new Map(),scratch=new Map(),rolls=new Map(),rates=new Map(),s=defaultSession();s.decks.forEach(d=>{d.playing=true;d.padMode='roll';});
 const doc={hidden:false,addEventListener:(k,f)=>{if(!listeners.has(k))listeners.set(k,[]);listeners.get(k).push(f);}},win={addEventListener:(k,f)=>windowListeners.set(k,f)};
 const a={s,layout:{editing:false},controllers:{learning:false},engine:{has:()=>true,scratch:(i,on,rate=0)=>scratch.set(i,{on,rate}),roll:(i,on)=>rolls.set(i,on),applyDeck:(i,d)=>rates.set(i,d.rate)},save(){},toast(){},getTrack:()=>({bpm:120,duration:60,gridOffset:0}),position:()=>1};
 const gestures=attachGestures(a,doc,win);
 const control=(kind,i)=>({dataset:{jog:String(i),deck:String(i),nudge:'1',pad:'2'},classList:{add(){},remove(){}},setPointerCapture(){},closest(selector){return selector===({jog:'[data-jog]',nudge:'[data-nudge]',roll:'[data-pad]'})[kind]?this:null;}});
 const event=(target,id,x=20,time=0)=>({target,pointerId:id,button:0,clientX:x,clientY:20,timeStamp:time,preventDefault(){}});
 const send=(type,e)=>listeners.get(type)?.forEach(f=>f(e));
 return {a,doc,win,scratch,rolls,rates,gestures,control,event,send,windowListeners};
}
for(const order of [[11,22],[22,11]])test(`two jogs release independently, order ${order}`,()=>{
 const f=setup(),a=f.control('jog',0),b=f.control('jog',1);f.send('pointerdown',f.event(a,11));f.send('pointerdown',f.event(b,22));
 f.send('pointermove',f.event(a,11,40,20));f.send('pointermove',f.event(b,22,10,20));assert.ok(f.scratch.get(0).rate>0);assert.ok(f.scratch.get(1).rate<0);
 f.send('pointerup',f.event(order[0]===11?a:b,order[0]));assert.equal(f.scratch.get(order[0]===11?0:1).on,false);assert.equal(f.scratch.get(order[0]===11?1:0).on,true);
 f.send('pointerup',f.event(order[1]===11?a:b,order[1]));assert.ok([...f.scratch.values()].every(d=>!d.on));
});
test('both rolls and nudges end on cancellation, capture loss and blur',()=>{
 const f=setup();for(const kind of ['roll','nudge']){const a=f.control(kind,0),b=f.control(kind,1);f.send('pointerdown',f.event(a,1));f.send('pointerdown',f.event(b,2));f.send('pointercancel',f.event(a,1));f.send('lostpointercapture',f.event(b,2));}
 assert.deepEqual([...f.rolls.values()],[false,false]);assert.equal(f.rates.get(0),f.a.s.decks[0].rate);assert.equal(f.rates.get(1),f.a.s.decks[1].rate);
 for(let i=0;i<2;i++)f.send('pointerdown',f.event(f.control('jog',i),i+1));f.windowListeners.get('blur')();assert.ok([...f.scratch.values()].every(d=>!d.on));
});
test('second finger on the same deck does not steal an active jog',()=>{
 const f=setup(),a=f.control('jog',0);f.send('pointerdown',f.event(a,1));f.send('pointerdown',f.event(a,2));f.send('pointerup',f.event(a,2));assert.equal(f.scratch.get(0).on,true);f.send('pointerup',f.event(a,1));assert.equal(f.scratch.get(0).on,false);
});
test('release removes pending scratch timers and hidden-page holds',async()=>{
 const f=setup(),a=f.control('jog',0),b=f.control('jog',1);for(const [el,id]of [[a,1],[b,2]]){f.send('pointerdown',f.event(el,id));f.send('pointermove',f.event(el,id,40,20));}
 f.doc.hidden=true;f.send('visibilitychange',{});await new Promise(r=>setTimeout(r,100));assert.ok([...f.scratch.values()].every(d=>!d.on));
});
