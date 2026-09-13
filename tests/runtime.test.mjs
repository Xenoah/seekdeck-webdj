import test from 'node:test';
import assert from 'node:assert/strict';
import {PerformanceRuntime} from '../dist/runtime.js';

function fixture({wakeRequest}={}){
 const document=Object.assign(new EventTarget(),{visibilityState:'visible',querySelector:()=>null,querySelectorAll:()=>[]}),window=Object.assign(new EventTarget(),{innerWidth:844,innerHeight:390,devicePixelRatio:2}),calls=[];
 const engine=Object.assign(new EventTarget(),{context:{state:'running',sampleRate:48000},route:'stereo',sampleSlots:[],buffers:new Map(),positions:[3,7,0,0],loadedIds:['one','two',null,null],latency:{base:5,output:12},play:(i,on)=>calls.push(['play',i,on]),scratch:(...args)=>calls.push(['scratch',...args]),roll:(...args)=>calls.push(['roll',...args]),stopSamples(){this.sampleSlots=[];}});
 const api={engine,s:{decks:[{trackId:'one',playing:true},{trackId:'two',playing:true},{playing:false},{playing:false}],runtime:{keepAwake:false}},position:i=>engine.positions[i],invalidateDeck:i=>calls.push(['invalidate',i]),renderDeck:()=>{},save:()=>calls.push(['save']),toast:()=>{},downloadBlob:()=>{},async startAudio(){engine.context.state='running';engine.dispatchEvent(new Event('state'));},async playDeck(i,on){runtime.cancelDeck(i);this.s.decks[i].playing=on;engine.play(i,on);}};
 let now=0;const runtime=new PerformanceRuntime(api,{document,window,navigator:{userAgent:'test',...(wakeRequest?{wakeLock:{request:wakeRequest}}:{})},timer:false,now:()=>now});api.runtime=runtime;
 return {runtime,api,engine,document,window,calls,advance:n=>{now+=n;runtime.tick();},state:value=>{engine.context.state=value;engine.dispatchEvent(new Event('state'));}};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function sentinel(){return Object.assign(new EventTarget(),{released:false,async release(){this.released=true;this.dispatchEvent(new Event('release'));}});}

test('interruption pauses at saved positions and an OS resume never starts decks',async()=>{
 const f=fixture();f.state('interrupted');assert.deepEqual(f.api.s.decks.map(d=>d.playing),[false,false,false,false]);assert.equal(f.api.s.decks[0].position,3);assert.equal(f.api.s.decks[1].position,7);assert.equal(f.runtime.needsResume,true);f.state('running');assert.equal(f.api.s.decks.some(d=>d.playing),false);await f.runtime.resume();assert.deepEqual(f.api.s.decks.map(d=>d.playing),[true,true,false,false]);assert.equal(f.runtime.needsResume,false);f.runtime.dispose();
});
test('explicit stop and a changed track exclude a deck from resumed intent',async()=>{
 const f=fixture();f.state('suspended');f.runtime.cancelDeck(0);f.api.s.decks[1].trackId='replacement';await f.runtime.resume();assert.equal(f.api.s.decks.some(d=>d.playing),false);f.runtime.dispose();
});
test('restore or navigation cancels in-flight resume and stops back-forward cache playback',async()=>{
 const f=fixture();f.state('interrupted');let resolve;f.api.startAudio=()=>new Promise(r=>resolve=r);const pending=f.runtime.resume();f.runtime.reset();resolve();await pending;assert.equal(f.api.s.decks.some(d=>d.playing),false);assert.equal(f.runtime.needsResume,false);f.api.s.decks[0].playing=true;f.window.dispatchEvent(new Event('pagehide'));assert.equal(f.api.s.decks[0].playing,false);assert.equal(f.runtime.needsResume,false);f.runtime.dispose();
});
test('a stalled separate CUE context stops all output transport',()=>{
 const f=fixture();f.engine.route='device';f.engine.cueContext=Object.assign(new EventTarget(),{state:'running'});f.runtime.refresh();f.engine.cueContext.state='suspended';f.engine.cueContext.dispatchEvent(new Event('statechange'));assert.equal(f.api.s.decks.some(d=>d.playing),false);assert.equal(f.runtime.state,'cue-suspended');f.runtime.dispose();
});
test('closed contexts and hidden pages reject explicit resume',async()=>{
 const f=fixture();f.state('closed');assert.equal(f.runtime.needsResume,false);await assert.rejects(f.runtime.resume(),/終了/);f.engine.context.state='running';f.document.visibilityState='hidden';await assert.rejects(f.runtime.resume(),/画面/);f.runtime.dispose();
});
test('wake lock is opt-in, releases while hidden or idle, and reacquires in foreground',async()=>{
 const locks=[],f=fixture({wakeRequest:async()=>{const lock=sentinel();locks.push(lock);return lock;}});await settle();assert.equal(locks.length,0);f.api.s.runtime.keepAwake=true;f.runtime.refresh();await settle();assert.equal(locks.length,1);assert.equal(f.runtime.wake,locks[0]);f.document.visibilityState='hidden';f.document.dispatchEvent(new Event('visibilitychange'));await settle();assert.equal(locks[0].released,true);f.document.visibilityState='visible';f.document.dispatchEvent(new Event('visibilitychange'));await settle();assert.equal(locks.length,2);f.api.s.decks.forEach(d=>d.playing=false);f.runtime.refresh();await settle();assert.equal(locks[1].released,true);f.runtime.dispose();
});
test('a late wake grant after stop is immediately released and a denial does not retry-loop',async()=>{
 let grant;const f=fixture({wakeRequest:()=>new Promise(resolve=>grant=resolve)});f.api.s.runtime.keepAwake=true;f.runtime.refresh();await settle();f.api.s.decks.forEach(d=>d.playing=false);f.runtime.refresh();const lock=sentinel();grant(lock);await settle();assert.equal(lock.released,true);assert.equal(f.runtime.wake,null);f.runtime.dispose();
 let requests=0;const g=fixture({wakeRequest:async()=>{requests++;throw new DOMException('denied','NotAllowedError');}});g.api.s.runtime.keepAwake=true;g.runtime.refresh();await settle();for(let i=0;i<20;i++)g.runtime.refresh();await settle();assert.equal(requests,1);assert.equal(g.runtime.wake,null);g.runtime.dispose();
});
test('diagnostics are bounded and do not identify music or pretend to measure sound latency',()=>{
 const f=fixture();f.advance(1400);for(let i=0;i<150;i++)f.runtime.note('event',i);f.api.s.decks[0].trackId='PRIVATE SONG NAME';f.engine.buffers.set('PRIVATE PATH',{bytes:64});const report=f.runtime.diagnostics();assert.equal(report.recentEvents.length,100);assert.equal(report.audio.physicalLatencyMeasured,false);assert.equal(report.audio.physicalInputToSoundLatencyMs,null);assert.equal(report.audio.browserReportedBaseLatencyMs,5);assert.equal(report.audio.decodedBytes,64);assert.equal(report.foregroundTimer.maxSchedulingGapMs,400);assert.doesNotMatch(JSON.stringify(report),/PRIVATE/);f.document.visibilityState='hidden';f.document.dispatchEvent(new Event('visibilitychange'));f.advance(10000);assert.equal(f.runtime.diagnostics().foregroundTimer.maxSchedulingGapMs,400);f.runtime.dispose();
});
