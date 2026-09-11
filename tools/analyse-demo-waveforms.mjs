import fs from 'node:fs';
import {DEMOS} from '../dist/demo-data.js';
import {WaveformAccumulator} from '../dist/audio/waveform.js';
for(const demo of DEMOS){
  const buffer=fs.readFileSync(new URL('../dist/'+demo.source.slice(2),import.meta.url));
  if(buffer.toString('ascii',0,4)!=='RIFF'||buffer.readUInt16LE(20)!==1||buffer.readUInt16LE(34)!==16)throw new Error('Expected generated PCM16 WAV');
  const channels=buffer.readUInt16LE(22),sampleRate=buffer.readUInt32LE(24),frames=buffer.readUInt32LE(40)/(channels*2);
  const analysis=new WaveformAccumulator(frames,sampleRate,Math.min(2,channels));
  for(let start=0;start<frames;start+=262144){
    const n=Math.min(262144,frames-start),pcm=Array.from({length:Math.min(2,channels)},()=>new Float32Array(n));
    for(let c=0;c<pcm.length;c++)for(let i=0;i<n;i++)pcm[c][i]=buffer.readInt16LE(44+((start+i)*channels+c)*2)/32768;
    analysis.push(pcm);
  }
  Object.assign(demo,analysis.finish());
}
fs.writeFileSync(new URL('../dist/demo-data.js',import.meta.url),'export const DEMOS = '+JSON.stringify(DEMOS)+';\n');
console.log('Analysed 4 demo waveforms into low, mid, and high bands.');
