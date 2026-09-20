import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultSession} from '../dist/core.js';
import {MIDIJog,JOG_SECONDS_PER_TICK} from '../dist/midi-jog.js';

function setup(){
 const s=defaultSession(),calls=[],timers=new Map();let next=0;
 const a={s,getTrack:()=>({bpm:120}),position:i=>s.decks[i].position,
  seekDeck(i,p){s.decks[i].position=p;calls.push(['seek',i,p]);},
  disengageSync:i=>calls.push(['syncOff',i]),
  engine:{applyDeck:(i,d)=>calls.push(['rate',i,d.rate]),scratch:(...args)=>calls.push(['touch',...args]),scratchMove:(...args)=>calls.push(['move',...args])}};
 const jog=new MIDIJog(a,{schedule:fn=>{timers.set(++next,fn);return next;},cancel:id=>timers.delete(id)});
 return {s,jog,calls,flush(){for(const [id,fn]of [...timers]){timers.delete(id);fn();}}};
}
test('capacitive platter moves by calibrated distance; rim packets do not double scratch',()=>{
 const f=setup();f.jog.touch(0,true);f.jog.move(0,1,{jogMode:'touch'});f.jog.move(0,-1,{jogMode:'touch'});
 assert.deepEqual(f.calls.filter(c=>c[0]==='move'),[['move',0,.0025],['move',0,-.0025]]);
 const before=f.calls.length;f.jog.move(0,20,{jogMode:'bend'});assert.equal(f.calls.length,before);
 f.jog.touch(0,false);assert.deepEqual(f.calls.at(-1),['touch',0,false,0]);
});
test('rim gives small transient pitch bend and restores the latest saved tempo',()=>{
 const f=setup();f.s.decks[0].playing=true;f.s.decks[0].rate=1.1;
 f.jog.move(0,1,{jogMode:'bend'});assert.ok(Math.abs(f.calls.at(-1)[2]-1.1*1.006)<1e-12);
 assert.equal(f.s.decks[0].rate,1.1);assert.equal(f.calls.some(c=>c[0]==='move'),false);
 f.jog.move(0,-63,{jogMode:'bend'});assert.equal(f.calls.at(-1)[2],1.1*.92);
 f.s.decks[0].rate=1.2;f.flush();assert.deepEqual(f.calls.at(-1),['rate',0,1.2]);
});
test('top touch cancels a pending bend; reset restores both decks without a stuck scratch',()=>{
 const f=setup();f.s.decks[0].playing=true;f.s.decks[1].playing=true;
 f.jog.move(0,3);f.jog.move(1,-2);f.jog.touch(0,true);
 assert.deepEqual(f.calls.slice(-2),[['rate',0,1],['touch',0,true,0]]);
 f.jog.reset();const before=f.calls.length;f.flush();assert.equal(f.calls.length,before);
 assert.ok(f.calls.some(c=>c[0]==='rate'&&c[1]===1&&c[2]===1));
 assert.ok(f.jog.states.every(s=>!s.touch&&!s.bending));
});
test('stopped rim is fine cue positioning, SHIFT is faster search, sensitivity round-trips',()=>{
 const f=setup();f.s.decks[0].position=5;
 f.jog.move(0,4,{jogMode:'bend'});assert.equal(f.s.decks[0].position,5+4*JOG_SECONDS_PER_TICK);
 f.jog.move(0,-4,{jogMode:'bend'});assert.equal(f.s.decks[0].position,5);
 f.jog.touch(0,true);f.jog.move(0,4,{jogMode:'seek'});assert.equal(f.s.decks[0].position,5.16);
 f.jog.move(0,10,{jogMode:'touch',sensitivity:.5});assert.deepEqual(f.calls.at(-1),['move',0,.0125]);
 const before=f.calls.length;f.jog.move(0,NaN);f.jog.move(0,0);assert.equal(f.calls.length,before);
});
test('vinyl-off top rotation releases the platter and bends; vinyl-on restores scratching',()=>{
 const f=setup();f.s.decks[0].playing=true;f.jog.touch(0,true);
 f.jog.move(0,1,{jogMode:'vinyl-off'});
 assert.ok(f.calls.some(c=>c[0]==='touch'&&c[2]===false));assert.equal(f.calls.at(-1)[0],'rate');
 f.jog.touch(0,false);f.jog.touch(0,true);assert.deepEqual(f.calls.at(-1),['touch',0,false,0]);
 f.jog.move(0,-2,{jogMode:'touch'});assert.deepEqual(f.calls.at(-1),['move',0,-.005]);
});
