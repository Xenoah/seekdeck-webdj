import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultSession} from '../dist/core.js';
import {createControllerActions} from '../dist/controller-actions.js';

function setup(){
 const s=defaultSession(),calls=[],track={id:'demo-0',bpm:120,duration:60};
 const a={s,getTrack:()=>track,position:i=>s.decks[i].position,
  seekDeck(i,p){s.decks[i].position=p;calls.push(['seek',i,p]);},
  save(){},renderDeck(){},refreshSync(){},toast(){},disengageSync(){},
  loadDeck:(i,id)=>{calls.push(['loadRequest',i,id]);return Promise.resolve();},
  selectMaster:i=>{s.selectedDeck=i;return Promise.resolve();},
  loopDeck(i){s.decks[i].loop.enabled=!s.decks[i].loop.enabled;calls.push(['loop',i]);},
  ensureBuffer:()=>Promise.resolve(),
  controllers:{feedback:(...args)=>calls.push(['feedback',...args])},
  engine:{loadedIds:['demo-0',null,null,null],
   load:(...args)=>calls.push(['load',...args]),setGrid(){},
   applyDeck:(i,d)=>calls.push(['deck',i,structuredClone(d)]),
   scratch:(...args)=>calls.push(['scratch',...args]),scratchMove:(...args)=>calls.push(['move',...args])}};
 return {a,s,calls,actions:createControllerActions(a,{querySelectorAll:()=>[]})};
}
test('4 BEAT exits any active loop and RELOOP recalls its retained range',()=>{
 const f=setup(),d=f.s.decks[0];d.loopBeats=16;d.loop={enabled:true,start:2,end:10};
 f.actions.dispatch('deck.0.loop4',1,{pressed:true});assert.equal(d.loop.enabled,false);assert.equal(d.loop.end,10);
 f.actions.dispatch('deck.0.reloop',1,{pressed:true});assert.equal(d.loop.enabled,true);assert.equal(d.position,2);assert.equal(d.loop.end,10);
 f.actions.dispatch('deck.0.reloop',0,{pressed:false,released:true});assert.equal(d.loop.enabled,true);
});
test('FX A/B/both selector follows absolute releases, with depth audible only when enabled',()=>{
 const f=setup(),send=(target,value,pressed=value>0)=>f.actions.dispatch('fx.'+target,value,{pressed});
 send('mix',.8);assert.equal(f.s.decks[0].fx.mix,0);
 send('on',1);assert.equal(f.s.decks[0].fx.mix,.8);assert.equal(f.s.decks[1].fx.mix,0);
 send('on',0,false);assert.equal(f.s.decks[0].fx.mix,.8);
 send('assign1',1);assert.equal(f.s.decks[1].fx.mix,.8);
 send('assign0',0,false);assert.equal(f.s.decks[0].fx.mix,0);assert.equal(f.s.decks[1].fx.mix,.8);
 send('next',1);assert.equal(f.s.decks[1].fx.type,'reverb');
 send('beatsHalf',1);assert.equal(f.s.decks[1].fx.beats,.25);
 send('on',1);assert.equal(f.s.decks[1].fx.mix,0);
});
test('deferred scratch preparation cannot latch after release or reset',async()=>{
 for(const reset of [false,true]){
  const f=setup();f.a.engine.loadedIds[0]=null;let resolve;f.a.ensureBuffer=()=>new Promise(r=>resolve=r);
  const pending=f.actions.dispatch('deck.0.scratch',1);f.actions.dispatch('deck.0.jog',5,{relative:true,jogMode:'touch'});
  if(reset)f.actions.reset();else f.actions.dispatch('deck.0.scratch',0);
  resolve();await pending;assert.equal(f.calls.some(c=>c[0]==='load'),false);assert.equal(f.actions.jog.states[0].touch,false);
 }
});
test('overlapping top holds prepare audio once and preserve distance after loading',async()=>{
 const f=setup();f.a.engine.loadedIds[0]=null;let resolve,count=0;
 f.a.ensureBuffer=()=>{count++;return new Promise(r=>resolve=r);};
 const first=f.actions.dispatch('deck.0.scratch',1),second=f.actions.dispatch('deck.0.scratch',1);
 assert.equal(count,1);assert.equal(first,second);resolve();await first;
 assert.equal(f.calls.filter(c=>c[0]==='load').length,1);
 f.a.engine.loadedIds[0]='demo-0';f.actions.dispatch('deck.0.jog',4,{relative:true,jogMode:'touch'});
 const before=f.calls.length;f.actions.dispatch('deck.0.scratch',1);assert.equal(f.calls.length,before);
 assert.deepEqual(f.calls.at(-1),['move',0,.01]);
});
test('hardware LOAD uses the selected library item and release does not repeat the request',async()=>{
 const f=setup();f.s.selectedTrack='demo-2';await f.actions.dispatch('deck.1.load',1,{pressed:true});
 f.actions.dispatch('deck.1.load',0,{pressed:false});assert.deepEqual(f.calls,[['loadRequest',1,'demo-2']]);
});
