import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeTempoMap,beatAtTime,timeAtBeat,bpmAtTime,quantizeTrack,advanceBeats,parseTempoMap} from '../dist/audio/beatgrid.js';
import {defaultSession,normalizeSession,normalizeTrack} from '../dist/core.js';

const track={bpm:120,gridOffset:.25,tempoMap:[{time:4.25,bpm:90,beat:1,meter:4},{time:8.25,bpm:150,beat:3,meter:4}]};
test('tempo changes integrate beats continuously and invert across segment boundaries',()=>{
 const map=normalizeTempoMap(track.tempoMap,track.bpm,track.gridOffset);
 assert.equal(beatAtTime(map,.25),0);
 assert.equal(beatAtTime(map,4.25),8);
 assert.equal(beatAtTime(map,8.25),14);
 assert.equal(timeAtBeat(map,17),9.45);
 assert.equal(bpmAtTime(map,4.249),120);
 assert.equal(bpmAtTime(map,4.25),90);
 for(let time=0;time<20;time+=.073)assert.ok(Math.abs(timeAtBeat(map,beatAtTime(map,time))-time)<1e-11);
});
test('loop lengths and beat jumps span variable-tempo sections in musical beats',()=>{
 assert.equal(advanceBeats(3.25,5,track),6.25); // 2 beats at 120, then 3 at 90.
 assert.equal(advanceBeats(6.25,-5,track),3.25);
 assert.equal(quantizeTrack(4.65,track),4.25+2/3);
 assert.equal(quantizeTrack(0,track),.25);
});
test('tempo normalization is bounded, does not mutate metadata, and resolves duplicate anchors',()=>{
 const source=[{time:4,bpm:140},{time:2,bpm:90,beat:8,meter:3},{time:2,bpm:100},{time:3,bpm:NaN},{time:-2,bpm:120},{time:7,bpm:0}];
 const before=JSON.stringify(source),map=normalizeTempoMap(source,120,0);
 assert.equal(JSON.stringify(source),before);
 assert.deepEqual(map.map(a=>[a.time,a.bpm,a.cumulativeBeat]),[[0,120,0],[2,100,4],[4,140,4+10/3]]);
 assert.ok(normalizeTempoMap(Array.from({length:10000},(_,i)=>({time:i,bpm:120}))).length<=4097);
});
test('grid editor rejects malformed or out-of-song anchors before persistence',()=>{
 for(const text of ['null','{}','bad','[{"time":-1,"bpm":90}]','[{"time":25,"bpm":90}]','[{"time":2,"bpm":90},{"time":2,"bpm":100}]','[{"time":2,"bpm":0}]','[{"time":2,"bpm":90,"denominator":3}]'])assert.throws(()=>parseTempoMap(text,120,0,20));
 const map=parseTempoMap('[{"time":2,"bpm":90,"meter":3,"denominator":8}]',120,0,20);
 const restored=normalizeTrack({id:'variable',name:'Variable',duration:20,bpm:120,gridOffset:0,tempoMap:map});
 assert.equal(restored.tempoMap[1].denominator,8);assert.equal(restored.tempoMap[1].meter,3);
 assert.equal(advanceBeats(1,4,restored),2+4/3);
});
test('session restoration keeps follower intent but never lets the master follow itself',()=>{
 const s=defaultSession();s.decks[0].syncEnabled=true;s.decks[1].syncEnabled=true;s.decks[1].playing=true;
 const restored=normalizeSession(JSON.parse(JSON.stringify(s)));
 assert.equal(restored.decks[0].syncEnabled,false);assert.equal(restored.decks[1].syncEnabled,true);assert.equal(restored.decks[1].playing,false);
});
