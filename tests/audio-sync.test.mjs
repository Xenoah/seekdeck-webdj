import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import * as beatgrid from '../dist/audio/beatgrid.js';
const source=fs.readFileSync(new URL('../dist/audio/processor.js',import.meta.url),'utf8').replace(/^import .*beatgrid\.js';\n/,'');
function fixture(){
 let Processor;const events=[];
 vm.runInNewContext(source,{...beatgrid,sampleRate:48000,Float32Array,Float64Array,Math,Map,Array,AudioWorkletProcessor:class{constructor(){this.port={postMessage:m=>events.push(m)};}},registerProcessor:(n,p)=>{Processor=p;}});
 const p=new Processor(),pcm=new Float32Array(48000*24);
 for(let start=0;start<pcm.length;start+=24000)for(let i=0;i<96;i++)pcm[start+i]=.7*Math.sin(Math.PI*i/96);
 p.command({type:'buffer',id:'clicks',channels:[pcm,pcm],sampleRate:48000});
 const load=(deck,bpm,position=0,tempoMap=[])=>{p.command({type:'load',deck,id:'clicks',position});p.command({type:'params',deck,rate:1});p.command({type:'grid',deck,bpm,gridOffset:0,tempoMap});};
 const render=seconds=>{const blocks=Math.round(seconds*48000/128);for(let i=0;i<blocks;i++)p.process([],Array.from({length:5},()=>[new Float32Array(128),new Float32Array(128)]));};
 return {p,load,render,events};
}
test('continuous sync follows later master tempo changes without UI messages or one-shot seeks',()=>{
 const f=fixture();f.load(0,100,1);f.load(3,120,1.37); // Master renders after follower.
 f.p.command({type:'sync',deck:0,master:3,enabled:true});
 f.p.command({type:'play',deck:0,on:true});f.p.command({type:'play',deck:3,on:true});f.render(1);
 assert.ok(Math.abs(f.p.decks[0].syncRate-1.2)<.0001);
 f.p.command({type:'params',deck:3,rate:1.1});f.render(3);
 assert.ok(Math.abs(f.p.decks[0].syncRate-1.32)<.0001);
 const followerBeat=f.p.decks[0].pos/48000*100/60,masterBeat=f.p.decks[3].pos/48000*2;
 const error=masterBeat-followerBeat-Math.round(masterBeat-followerBeat);
 assert.ok(Math.abs(error)<1e-7,`phase error ${error} beats`);
 assert.equal(f.p.decks[0].syncState,'locked');
 assert.ok(f.events.some(e=>e.rates?.[0]>1.31));
});
test('variable BPM anchors update playback rate at the correct source-time boundary',()=>{
 const f=fixture();f.load(0,120,0,[{time:2,bpm:90}]);f.load(1,120,0,[{time:4,bpm:150}]);
 f.p.command({type:'sync',deck:0,master:1,enabled:true});for(let deck=0;deck<2;deck++)f.p.command({type:'play',deck,on:true});
 f.render(3);assert.ok(Math.abs(f.p.decks[0].syncRate-4/3)<.002);
 // Source time is 2 s at 120, then 4/3 s at 90. Both contain 6 beats.
 assert.ok(Math.abs(f.p.decks[0].pos/48000-(2+4/3))<.003);
 f.render(2);assert.equal(f.p.decks[0].syncState,'range');assert.equal(f.p.decks[0].syncRate,1.5);
});
test('sync suspends for intentional scratch and converges smoothly after release',()=>{
 const f=fixture();f.load(0,120,1);f.load(1,120,1);f.p.command({type:'sync',deck:0,master:1,enabled:true});
 for(let deck=0;deck<2;deck++)f.p.command({type:'play',deck,on:true});
 f.p.command({type:'scratch',deck:0,active:true,speed:-1});f.render(.04);assert.equal(f.p.decks[0].syncState,'suspended');
 f.p.command({type:'scratch',deck:0,active:false});const before=f.p.decks[0].pos;f.render(128/48000);
 assert.ok(f.p.decks[0].pos-before<=128*1.025+.001,'recovery uses a bounded speed change, never a hidden seek');
 f.render(5);assert.ok(Math.abs(f.p.decks[0].pos-f.p.decks[1].pos)/48000<.003);
 f.p.command({type:'sync',deck:0,enabled:false});f.render(.01);assert.equal(f.p.decks[0].syncState,'off');
});
test('a stopped master does not stop the follower and cyclic sync is rejected',()=>{
 const f=fixture();f.load(0,100,1);f.load(1,120,1);f.p.command({type:'sync',deck:0,master:1,enabled:true});
 f.p.command({type:'sync',deck:1,master:0,enabled:true});assert.equal(f.p.decks[1].syncMaster,-1);
 f.p.command({type:'play',deck:0,on:true});const before=f.p.decks[0].pos;f.render(1);
 assert.ok(Math.abs((f.p.decks[0].pos-before)/48000-1.2)<.003);
 assert.equal(f.p.decks[0].syncState,'tempo');
});
