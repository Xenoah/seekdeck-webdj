import test from 'node:test';
import assert from 'node:assert/strict';
import {WaveformAccumulator,frequencyColor,normalizeWaveform} from '../dist/audio/waveform.js';
import {normalizeSession,defaultSession} from '../dist/core.js';
const sr=48000;
function tone(f){return Float32Array.from({length:sr},(_,i)=>.45*Math.sin(2*Math.PI*f*i/sr));}
function analyse(channels,chunk=sr){const a=new WaveformAccumulator(channels[0].length,sr,channels.length);for(let i=0;i<channels[0].length;i+=chunk)a.push(channels.map(c=>c.subarray(i,i+chunk)));return a.finish();}
for(const [f,band]of [[60,'low'],[1000,'mid'],[9000,'high']])test(f+' Hz produces the expected dominant waveform band',()=>{
  const {waveform:w}=analyse([tone(f)]),averages=Object.fromEntries(['low','mid','high'].map(k=>[k,w[k].reduce((a,b)=>a+b)/w[k].length]));
  for(const other of Object.keys(averages))if(other!==band)assert.ok(averages[band]>averages[other]*1.6,JSON.stringify(averages));
});
test('waveform chunk boundaries preserve analysis and stereo phase does not cancel',()=>{
 const left=tone(60),right=left.map(x=>-x);
 assert.deepEqual(analyse([left,right],733),analyse([left,right]));
 assert.deepEqual(analyse([left,right]),analyse([left]));
});
test('silent and malformed waveform metadata stay bounded',()=>{
 const result=analyse([new Float32Array(sr)]);
 assert.ok(result.peaks.every(x=>x===0));assert.ok(result.waveform.low.every(x=>x===0));
 assert.equal(normalizeWaveform({version:1,low:[2],mid:[],high:[]},1),null);
 assert.equal(normalizeWaveform([],1),null);
 assert.equal(frequencyColor(0,0,0),'rgba(92,112,130,1)');
 assert.ok(!frequencyColor(255,0,0).includes('NaN'));
});
test('waveform style is restored without resuming playback',()=>{
 const s=defaultSession();s.waveformStyle='3band';s.decks[0].playing=true;
 assert.equal(normalizeSession(s).waveformStyle,'3band');assert.equal(normalizeSession(s).decks[0].playing,false);
 s.waveformStyle='invalid';assert.equal(normalizeSession(s).waveformStyle,'rgb');
});
