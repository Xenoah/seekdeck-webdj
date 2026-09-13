import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {defaultSession,normalizeSession,normalizeTrack} from '../dist/core.js';
import {parseAudioMetadata} from '../dist/audio-metadata.js';
import {parseCSV,writeCSV} from '../dist/exchange-core.js';
import {applyExchange,planExchange} from '../dist/exchange.js';
const base={id:'a',name:'Metadata',filename:'a.mp3',duration:10,bpm:120};
test('imported Serato loop slots and lock flags survive normalization, JSON recovery and CSV exchange',()=>{
 const bytes=Buffer.from(fs.readFileSync(new URL('./fixtures/metadata.mp3.base64',import.meta.url),'utf8'),'base64'),{metadata}=parseAudioMetadata(bytes),track=normalizeTrack({...base,...metadata});
 const recovered=normalizeTrack(JSON.parse(JSON.stringify(track)));assert.equal(recovered.cues[0],.5);assert.equal(recovered.memoryCues[0].seratoSlot,4);assert.equal(recovered.memoryCues[0].locked,true);assert.equal(recovered.memoryCues[0].name,'保存ループ');assert.equal(recovered.tempoMap[0].time,.125);
 const csv=parseCSV(writeCSV([recovered],{}),'set');assert.equal(csv.tracks[0].memoryCues[0].seratoSlot,4);assert.equal(csv.tracks[0].memoryCues[0].locked,true);
});
test('metadata normalization rejects malformed slots, lock strings and grid positions beyond the audio',()=>{
 const track=normalizeTrack({...base,gridMarkers:[7,.25,7,-1,NaN,Infinity,11,'2',2],memoryCues:[{type:'loop',start:1,end:2,seratoSlot:99,locked:'false'},{type:'loop',start:2,end:3,seratoSlot:4.5,locked:true},{type:'cue',start:3,seratoSlot:4,locked:true},{type:'loop',start:8,end:11,seratoSlot:5,locked:true}]});
 assert.deepEqual(track.gridMarkers,[.25,2,7]);assert.equal(track.memoryCues[0].seratoSlot,undefined);assert.equal(track.memoryCues[0].locked,false);assert.equal(track.memoryCues[1].seratoSlot,undefined);assert.equal(track.memoryCues[1].locked,true);assert.equal(track.memoryCues[2].seratoSlot,undefined);assert.equal(track.memoryCues[2].locked,undefined);assert.equal(track.memoryCues[3].type,'cue');assert.equal(track.memoryCues[3].seratoSlot,undefined);
 assert.equal(normalizeTrack({...base,gridMarkers:Array.from({length:5000},(_,i)=>i/1000)}).gridMarkers.length,4096);
});
test('playlist folders persist through exchange commit and restored session without losing repeated track order',async()=>{
 const original=normalizeTrack(base),parsed=parseCSV('path,title\na.mp3,First\na.mp3,Again','set');parsed.playlists[0].folderPath=['Festival','夜'];
 const api={tracks:new Map([[original.id,original]]),s:defaultSession(),async persistExchange(tracks,playlists){tracks.forEach(t=>this.tracks.set(t.id,t));this.s.playlists.push(...playlists);}};
 await applyExchange(api,planExchange(parsed,[original]));api.s.decks[0].playing=true;const restored=normalizeSession(JSON.parse(JSON.stringify(api.s)));assert.deepEqual(restored.playlists[0].folderPath,['Festival','夜']);assert.deepEqual(restored.playlists[0].tracks,['a','a']);assert.equal(restored.decks[0].playing,false);
 const invalid=normalizeSession({...defaultSession(),playlists:[{id:'p',name:'Set',tracks:[],folderPath:[null,{},1,'Valid',...Array(40).fill('x'.repeat(250))]}]}).playlists[0];assert.equal(invalid.folderPath.length,32);assert.equal(invalid.folderPath[0],'Valid');assert.equal(invalid.folderPath[1].length,200);
});
