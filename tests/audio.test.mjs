import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import * as beatgrid from '../dist/audio/beatgrid.js';
import {analysePCM} from '../dist/audio/analysis.js';
import {AudioEngine} from '../dist/audio/engine.js';
const source=fs.readFileSync(new URL('../dist/audio/processor.js',import.meta.url),'utf8').replace(/^import .*beatgrid\.js';\n/,'');
function fixture({sourceRate=48000,outputRate=48000}={}){let Processor;const events=[];const ctx={...beatgrid,sampleRate:outputRate,Float32Array,Math,Map,Array,AudioWorkletProcessor:class{constructor(){this.port={postMessage:m=>events.push(m)};}},registerProcessor:(name,c)=>{assert.equal(name,'orbit-transport');Processor=c;}};vm.runInNewContext(source,ctx);const p=new Processor();const pcm=Float32Array.from({length:sourceRate*8},(_,i)=>Math.sin(2*Math.PI*440*i/sourceRate)*.4);p.command({type:'buffer',id:'tone',channels:[pcm,pcm],sampleRate:sourceRate});const render=(blocks=1,frames=128)=>{const capture=[];for(let b=0;b<blocks;b++){const outputs=Array.from({length:5},()=>[new Float32Array(frames),new Float32Array(frames)]);assert.equal(p.process([],outputs),true);capture.push(outputs);}return capture;};const load=(i=0,pos=0)=>{p.command({type:'load',deck:i,id:'tone',position:pos});p.command({type:'params',deck:i,rate:1,pitch:0,loop:{enabled:false},keyLock:false});};return {p,events,render,load};}
const energy=a=>a.reduce((sum,x)=>sum+x*x,0);
test('four independent stereo transports advance only when playing',()=>{const f=fixture();for(let i=0;i<4;i++){f.load(i,i);f.p.command({type:'play',deck:i,on:true});}const o=f.render(20).at(-1);for(let i=0;i<4;i++){assert.ok(energy(o[i][0])>1);assert.deepEqual(o[i][0],o[i][1]);assert.ok(Math.abs(f.p.decks[i].pos-(48000*i+2560))<.01);}assert.equal(energy(o[4][0]),0);f.p.command({type:'play',deck:2,on:false});const pos=f.p.decks[2].pos;f.render(30);assert.equal(f.p.decks[2].pos,pos);});
test('rate, seek, loop and reverse use source sample positions',()=>{const f=fixture();f.load();f.p.command({type:'params',deck:0,rate:1.5,loop:{enabled:false}});f.p.command({type:'play',deck:0,on:true});f.render(10);assert.equal(f.p.decks[0].pos,1920);f.p.command({type:'seek',deck:0,position:1});assert.equal(f.p.decks[0].pos,48000);f.p.command({type:'params',deck:0,rate:1,reverse:true,loop:{enabled:false}});f.render(10);assert.equal(f.p.decks[0].pos,46720);f.p.command({type:'params',deck:0,rate:1,reverse:false,loop:{enabled:true,start:1,end:1.01}});f.p.command({type:'seek',deck:0,position:1});f.render(20);assert.ok(f.p.decks[0].pos>=48000&&f.p.decks[0].pos<48480);});
test('SLIP scratch restores unheard transport timeline',()=>{const f=fixture();f.load(0,1);f.p.command({type:'params',deck:0,rate:1,slip:true,loop:{enabled:false}});f.p.command({type:'play',deck:0,on:true});f.p.command({type:'scratch',deck:0,active:true,speed:-1});f.render(20);assert.equal(f.p.decks[0].pos,48000-2560);f.p.command({type:'scratch',deck:0,active:false});assert.equal(f.p.decks[0].pos,48000+2560);});
test('audio engine forwards jog distance without converting it to a lasting rate',()=>{
 const engine=new AudioEngine(),messages=[];engine.node={port:{postMessage:m=>messages.push(m)}};
 engine.scratch(1,true);engine.scratchMove(1,-.004);engine.scratch(1,false);
 assert.deepEqual(messages,[{type:'scratch',deck:1,active:true,speed:0},{type:'scratchMove',deck:1,seconds:-.004},{type:'scratch',deck:1,active:false,speed:0}]);
});
test('jog distance follows in about 10 ms and a held still platter becomes silent',()=>{
 const f=fixture();f.load(0,2);f.p.command({type:'play',deck:0,on:true});f.p.command({type:'scratch',deck:0,active:true});f.p.command({type:'scratchMove',deck:0,seconds:.01});
 f.render(1,480);assert.ok(f.p.decks[0].pos>96000+480*.99);assert.ok(f.p.decks[0].pos<=96480);
 f.render(30);const stopped=f.p.decks[0].pos;assert.ok(Math.abs(stopped-96480)<.000001);
 const tail=f.render(30).at(-1);assert.equal(f.p.decks[0].pos,stopped);assert.equal(energy(tail[0][0]),0);assert.equal(f.p.decks[0].playing,true);
 f.p.command({type:'scratchMove',deck:0,seconds:-.015});f.render(30);assert.ok(Math.abs(f.p.decks[0].pos-95760)<.000001);
});
test('jog endpoints agree for grouped, separated and touch-up-before-render packets',()=>{
 const f=fixture(),steps=[.006,.006,.006,.006,.006,-.004,-.003,.002],total=steps.reduce((a,b)=>a+b,0);
 for(let deck=0;deck<4;deck++){f.load(deck,3);f.p.command({type:'scratch',deck,active:true});}
 f.p.command({type:'scratchMove',deck:0,seconds:total});
 for(const seconds of steps)f.p.command({type:'scratchMove',deck:1,seconds});
 f.p.command({type:'scratchMove',deck:3,seconds:total});f.p.command({type:'scratch',deck:3,active:false});
 for(const seconds of steps){f.p.command({type:'scratchMove',deck:2,seconds});f.render(1,96);}
 f.render(40);for(const d of f.p.decks)assert.ok(Math.abs(d.pos-(3+total)*48000)<.000001,`endpoint ${d.pos}`);
});
test('jog displacement uses source sample rate and render velocity stays below eight times',()=>{
 for(const sourceRate of [44100,96000])for(const sign of [-1,1]){
  const outputRate=48000,f=fixture({sourceRate,outputRate});f.load(0,3);f.p.command({type:'scratch',deck:0,active:true});f.p.command({type:'scratchMove',deck:0,seconds:sign*.1});
  let previous=f.p.decks[0].pos;
  for(let i=0;i<40;i++){f.render(1,1);const step=f.p.decks[0].pos-previous;assert.ok(step*sign>0);assert.ok(Math.abs(step)<=8*sourceRate/outputRate+.0000001);previous=f.p.decks[0].pos;}
  f.render(50);assert.ok(Math.abs(f.p.decks[0].pos/sourceRate-(3+sign*.1))<1e-10);
 }
});
test('distance scratch ignores inactive or non-finite input and clears pending motion on load',()=>{
 const f=fixture();f.load(0,2);f.p.command({type:'scratchMove',deck:0,seconds:1});f.render(2);assert.equal(f.p.decks[0].pos,96000);
 f.p.command({type:'scratch',deck:0,active:true});
 for(const seconds of [NaN,Infinity,-Infinity,Number.MAX_VALUE,'0.1',undefined])f.p.command({type:'scratchMove',deck:0,seconds});
 f.render(2);assert.equal(f.p.decks[0].pos,96000);
 f.p.command({type:'scratchMove',deck:0,seconds:.1});f.load(0,1);f.render(5);assert.equal(f.p.decks[0].pos,48000);
 f.p.command({type:'scratch',deck:0,active:true});f.render(5);assert.equal(f.p.decks[0].pos,48000);
});
test('rate-based screen scratches remain independent from a previous distance gesture',()=>{
 const f=fixture();f.load(0,2);f.p.command({type:'scratch',deck:0,active:true});f.p.command({type:'scratchMove',deck:0,seconds:.01});f.p.command({type:'scratch',deck:0,active:false});assert.equal(f.p.decks[0].pos,96480);
 f.p.command({type:'scratch',deck:0,active:true,speed:-.5});f.render(2);assert.equal(f.p.decks[0].pos,96352);
 f.p.command({type:'scratch',deck:0,active:true,speed:0});f.render(10);assert.equal(f.p.decks[0].pos,96352);
 f.p.command({type:'scratchMove',deck:0,seconds:.01});f.p.command({type:'scratch',deck:0,active:true,speed:1});f.render(1);assert.equal(f.p.decks[0].pos,96480);
});
test('distance scratch wraps loops in either direction and touch-up commits its remaining endpoint',()=>{
 const f=fixture();f.load(0,1.05);f.p.command({type:'params',deck:0,rate:1,loop:{enabled:true,start:1,end:1.1}});f.p.command({type:'scratch',deck:0,active:true});
 f.p.command({type:'scratchMove',deck:0,seconds:.08});f.render(40);assert.ok(Math.abs(f.p.decks[0].pos/48000-1.03)<1e-10);
 f.p.command({type:'scratchMove',deck:0,seconds:-.06});f.p.command({type:'scratch',deck:0,active:false});assert.ok(Math.abs(f.p.decks[0].pos/48000-1.07)<1e-10);
});
test('distance scratch can reverse away from a track edge and stops normal playback only after release',()=>{
 const f=fixture();f.load(0,.001);f.p.command({type:'play',deck:0,on:true});f.p.command({type:'scratch',deck:0,active:true});f.p.command({type:'scratchMove',deck:0,seconds:-.1});f.render(40);
 assert.equal(f.p.decks[0].pos,0);assert.equal(f.p.decks[0].playing,true);assert.equal(f.events.filter(e=>e.type==='ended').length,0);
 f.p.command({type:'scratchMove',deck:0,seconds:.01});f.render(40);assert.ok(Math.abs(f.p.decks[0].pos-480)<.000001);
 f.p.command({type:'seek',deck:0,position:7.999});f.p.command({type:'scratchMove',deck:0,seconds:.1});f.p.command({type:'scratch',deck:0,active:false});assert.equal(f.p.decks[0].pos,48000*8-1);
 f.render(2);assert.equal(f.p.decks[0].playing,false);assert.equal(f.events.filter(e=>e.type==='ended').length,1);
});
test('SLIP distance scratching resumes the continuous timeline even after hitting a track edge',()=>{
 const f=fixture();f.load(0,.001);f.p.command({type:'params',deck:0,rate:1,slip:true,loop:{enabled:false}});f.p.command({type:'play',deck:0,on:true});f.p.command({type:'scratch',deck:0,active:true});f.p.command({type:'scratchMove',deck:0,seconds:-.1});f.render(20);
 assert.equal(f.p.decks[0].pos,0);f.p.command({type:'scratch',deck:0,active:false});assert.equal(f.p.decks[0].pos,48+2560);assert.equal(f.p.decks[0].playing,true);assert.equal(f.events.filter(e=>e.type==='ended').length,0);
 f.load(0,1.05);f.p.command({type:'params',deck:0,rate:1,slip:true,loop:{enabled:true,start:1,end:1.1}});f.p.command({type:'play',deck:0,on:true});f.p.command({type:'scratch',deck:0,active:true});f.p.command({type:'scratchMove',deck:0,seconds:-.02});f.render(50);f.p.command({type:'scratch',deck:0,active:false});
 assert.ok(Math.abs(f.p.decks[0].pos-(48000+(50400+6400-48000)%4800))<.000001);
});
test('roll restores previous loop and continuous position on release',()=>{const f=fixture();f.load(0,1);f.p.command({type:'play',deck:0,on:true});f.p.command({type:'roll',deck:0,on:true,start:1,end:1.01});f.render(20);assert.ok(f.p.decks[0].pos<48480);f.p.command({type:'roll',deck:0,on:false});assert.equal(f.p.decks[0].pos,50560);assert.equal(f.p.decks[0].loop,false);});
test('sampler renders only its fifth output and stops after region',()=>{const f=fixture();f.p.command({type:'sample',slot:0,id:'tone',start:0,duration:.04,gain:.8,loop:false});const out=f.render(6).at(-1);assert.ok(energy(out[4][0])>0);assert.equal(energy(out[0][0]),0);f.render(20);assert.equal(f.p.voices.filter(v=>v.on).length,0);});
test('end of track emits stop and positions remain bounded',()=>{const f=fixture();f.load(0,7.99);f.p.command({type:'play',deck:0,on:true});f.render(20);assert.equal(f.p.decks[0].playing,false);assert.ok(f.p.decks[0].pos<48000*8);assert.ok(f.events.some(e=>e.type==='ended'&&e.deck===0));});
function frequency(blocks,channel=0){const a=blocks.slice(12).flatMap(b=>Array.from(b[channel][0]));let crossings=0;for(let i=1;i<a.length;i++)if(a[i-1]<=0&&a[i]>0)crossings++;return crossings/(a.length/48000);}
test('key lock advances 1.25x while keeping a 440 Hz tone near its pitch',()=>{const f=fixture();f.load(0,1);f.p.command({type:'params',deck:0,rate:1.25,keyLock:true,pitch:0,loop:{enabled:false}});f.p.command({type:'play',deck:0,on:true});const blocks=f.render(375),hz=frequency(blocks);assert.ok(Math.abs(hz-440)<12,`observed ${hz} Hz`);assert.equal(f.p.decks[0].pos,108000);for(const b of blocks)for(const v of b[0][0])assert.ok(Number.isFinite(v)&&Math.abs(v)<1);});
test('independent +12 semitone processing approximates one octave',()=>{const f=fixture();f.load(0,1);f.p.command({type:'params',deck:0,rate:1,pitch:12,keyLock:true,loop:{enabled:false}});f.p.command({type:'play',deck:0,on:true});const hz=frequency(f.render(375));assert.ok(Math.abs(hz-880)<25,`observed ${hz} Hz`);assert.equal(f.p.decks[0].pos,96000);});
test('key lock treats right-only and left-only audio symmetrically without stereo bleed',()=>{
 const f=fixture(),tone=f.p.tracks.get('tone').channels[0],silence=new Float32Array(tone.length);
 f.p.command({type:'buffer',id:'left',channels:[tone,silence],sampleRate:48000});
 f.p.command({type:'buffer',id:'right',channels:[silence,tone],sampleRate:48000});
 for(let deck=0;deck<2;deck++){f.p.command({type:'load',deck,id:deck?'right':'left',position:1});f.p.command({type:'params',deck,rate:1.25,keyLock:true,pitch:0});f.p.command({type:'play',deck,on:true});}
 const blocks=f.render(750),samples=[],rms=[];
 for(const b of blocks){assert.deepEqual(b[0][0],b[1][1]);assert.equal(energy(b[0][1]),0);assert.equal(energy(b[1][0]),0);samples.push(...b[1][1]);}
 // Check the rendered signal's envelope, not the chosen alignment offsets.
 // After startup a sustained tone must not pulse or disappear at grain joins.
 for(let i=4800;i+4800<samples.length;i+=4800)rms.push(Math.sqrt(energy(samples.slice(i,i+4800))/4800));
 assert.ok(Math.min(...rms)>.27,`lowest RMS ${Math.min(...rms)}`);
 assert.ok(Math.max(...rms)-Math.min(...rms)<.008,`RMS range ${Math.max(...rms)-Math.min(...rms)}`);
 let crossings=0;for(let i=4801;i<samples.length;i++)if(samples[i-1]<=0&&samples[i]>0)crossings++;
 const hz=crossings/((samples.length-4800)/48000);assert.ok(Math.abs(hz-440)<1.5,`right-only pitch ${hz} Hz`);
});
test('tempo estimator recovers a known 120 BPM pulse train',()=>{const sr=11025,a=new Float32Array(sr*18);for(let beat=0;beat<36;beat++){const start=Math.round(beat*.5*sr);for(let i=0;i<1800&&start+i<a.length;i++)a[start+i]=Math.sin(2*Math.PI*70*i/sr)*Math.exp(-i/210);}const result=analysePCM(a,sr);assert.ok(Math.abs(result.bpm-120)<1.5,JSON.stringify(result));assert.ok(result.gridOffset>=0&&result.gridOffset<.51);});
