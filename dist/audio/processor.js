import {normalizeTempoMap,beatAtTime,timeAtBeat,bpmAtTime,phaseDifference} from './beatgrid.js';
/* Original SeekDeck PCM transport. Sample-loop storage is preallocated; status reports are sent at 25 Hz.
 * A-rate vinyl resampling; optional two-grain overlap-add pitch/time mode.
 * The granular mode is experimental and is not equivalent to commercial DSP.
 */
const N=2048,H=N/2;
const win=new Float32Array(N);for(let i=0;i<N;i++)win[i]=.5-.5*Math.cos(2*Math.PI*i/N);
const wrap=(x,n)=>((x%n)+n)%n;
function makeDeck(){return {id:null,pos:0,playing:false,speed:1,pitch:1,keyLock:false,reverse:false,loop:false,start:0,end:0,slip:false,ghost:0,scratch:false,scratchRate:0,gain:0,grainPhase:0,g1:0,g2:0,reset:true,roll:false,rollGhost:0,rollState:null,tempoMap:normalizeTempoMap(),syncMaster:-1,syncRate:1,syncState:'off',alignmentReference:new Float32Array(96)};}
class OrbitProcessor extends AudioWorkletProcessor{
 constructor(){super();this.tracks=new Map();this.decks=Array.from({length:4},makeDeck);this.voices=Array.from({length:16},()=>({on:false,slot:-1,id:null,pos:0,end:0,start:0,gain:1,loop:false}));this.blockPositions=new Float64Array(4);this.blockRates=new Float64Array(4);this.frames=0;this.report=0;this.port.onmessage=e=>this.command(e.data);}
 command(m){
  if(m.type==='buffer'){this.tracks.set(m.id,{channels:m.channels,length:m.channels[0].length,sr:m.sampleRate});this.port.postMessage({type:'buffered',id:m.id});return;}
  if(m.type==='unload'){this.tracks.delete(m.id);return;}
  if(m.type==='sample'){let existing=this.voices.find(v=>v.on&&v.slot===m.slot);if(existing&&m.toggle){existing.on=false;return;}let v=this.voices.find(v=>!v.on);if(!v){v=this.voices[0];}const t=this.tracks.get(m.id);if(!t)return;Object.assign(v,{on:true,id:m.id,slot:m.slot,start:Math.max(0,m.start*t.sr),pos:Math.max(0,m.start*t.sr),end:Math.min(t.length,(m.start+m.duration)*t.sr),gain:m.gain,loop:m.loop});return;}
  if(m.type==='stopSamples'){for(const v of this.voices)v.on=false;return;}
  const d=this.decks[m.deck];if(!d)return;const t=this.tracks.get(d.id);
  if(m.type==='grid'){d.tempoMap=normalizeTempoMap(m.tempoMap,m.bpm,m.gridOffset);return;}
  if(m.type==='sync'){
   if(!m.enabled){if(d.syncMaster>=0)d.speed=d.syncRate;d.syncMaster=-1;d.syncState='off';return;}
   const master=this.decks[m.master],mt=this.tracks.get(master?.id);
   // A master never follows another deck; this prevents cyclic rate feedback.
   if(!t||!mt||!master||m.master===m.deck||master.syncMaster>=0)return;
   for(const other of this.decks)if(other.syncMaster===m.deck){other.syncMaster=-1;other.speed=other.syncRate;other.syncState='off';}
   d.syncMaster=m.master;d.syncRate=d.speed;
   if(!d.reverse&&!master.reverse&&!d.scratch&&!master.scratch&&!d.roll&&!master.roll){
    const current=beatAtTime(d.tempoMap,d.pos/t.sr),target=beatAtTime(master.tempoMap,master.pos/mt.sr);
    const aligned=timeAtBeat(d.tempoMap,current+phaseDifference(target,current))*t.sr;
    d.pos=Math.max(0,Math.min(t.length-1,aligned));d.ghost=d.pos;d.reset=true;
   }
   return;
  }
  if(m.type==='load'){Object.assign(d,makeDeck(),{id:m.id,pos:m.position*(this.tracks.get(m.id)?.sr||sampleRate)});return;}
  if(m.type==='play'){if(m.on&&t&&d.pos>=t.length)d.pos=0;d.playing=m.on;d.ghost=d.pos;d.reset=true;return;}
  if(m.type==='seek'){d.pos=Math.max(0,Math.min((t?.length||0)-1,m.position*(t?.sr||sampleRate)));d.ghost=d.pos;d.reset=true;return;}
  if(m.type==='scratch'){if(m.active&&!d.scratch)d.ghost=d.pos;if(!m.active&&d.scratch){if(d.slip)d.pos=d.ghost;d.reset=true;}d.scratch=m.active;d.scratchRate=Math.max(-8,Math.min(8,m.speed||0));return;}
  if(m.type==='roll'){if(m.on&&!d.roll){d.rollState={loop:d.loop,start:d.start,end:d.end};d.rollGhost=d.pos;d.roll=true;d.loop=true;d.start=m.start*(t?.sr||sampleRate);d.end=m.end*(t?.sr||sampleRate);d.pos=d.start;d.reset=true;}else if(!m.on&&d.roll){d.roll=false;d.pos=d.rollGhost;Object.assign(d,d.rollState);d.rollState=null;d.reset=true;}return;}
  if(m.type==='params'){if(d.keyLock!==!!m.keyLock||d.reverse!==!!m.reverse||Math.abs(d.pitch-Math.pow(2,(m.pitch||0)/12))>.0001)d.reset=true;d.speed=m.rate??d.speed;d.pitch=Math.pow(2,(m.pitch||0)/12);d.keyLock=!!m.keyLock;d.reverse=!!m.reverse;d.slip=!!m.slip;if(!d.roll){d.loop=!!m.loop?.enabled;d.start=(m.loop?.start||0)*(t?.sr||sampleRate);d.end=(m.loop?.end||0)*(t?.sr||sampleRate);}}
 }
 read(t,ch,p,d){if(d?.loop&&d.end>d.start){const len=d.end-d.start;if(p>=d.end||p<d.start)p=d.start+wrap(p-d.start,len);}if(p<0||p>=t.length-1)return 0;const a=t.channels[ch]||t.channels[0],j=Math.floor(p),f=p-j;return a[j]*(1-f)+a[j+1]*f;}
 alignmentScore(t,d,candidate,pitch,energy,channels){let cross=0,power=0,index=0;for(let k=0;k<384;k+=8)for(let ch=0;ch<channels;ch++){const a=d.alignmentReference[index++],b=this.read(t,ch,candidate+k*pitch,d);cross+=a*b;power+=b*b;}return power>1e-12?cross/Math.sqrt(energy*power):-1;}
 align(t,d,candidate,old,pitch){
  // One shared offset for stereo preserves channel timing. Looking only at the
  // left channel made right-only material drift and pulse during key lock.
  const channels=Math.min(2,t.channels.length);let energy=0,index=0;
  for(let k=0;k<384;k+=8)for(let ch=0;ch<channels;ch++){const value=this.read(t,ch,old+k*pitch,d);d.alignmentReference[index++]=value;energy+=value*value;}
  if(energy<1e-10)return candidate;
  let best=0,score=-Infinity;
  for(let off=-256;off<=256;off+=16){const value=this.alignmentScore(t,d,candidate+off,pitch,energy,channels);if(value>score){score=value;best=off;}}
  const center=best;
  for(let off=Math.max(-256,center-16);off<=Math.min(256,center+16);off++){const value=this.alignmentScore(t,d,candidate+off,pitch,energy,channels);if(value>score){score=value;best=off;}}
  return candidate+best;
 }
 updateSync(){
  // Snapshot every source before processing outputs: followers may precede their
  // master in the output array, but all comparisons use the same audio instant.
  for(let i=0;i<4;i++){const d=this.decks[i],t=this.tracks.get(d.id);this.blockPositions[i]=d.pos/(t?.sr||sampleRate);this.blockRates[i]=d.speed;}
  for(let i=0;i<4;i++){
   const d=this.decks[i],m=this.decks[d.syncMaster];if(!m){d.syncState='off';continue;}
   if(!this.tracks.has(d.id)||!this.tracks.has(m.id)||m.syncMaster>=0){d.syncState='waiting';this.blockRates[i]=d.syncRate;continue;}
   if(d.reverse||m.reverse||d.scratch||m.scratch||d.roll||m.roll){d.syncState='suspended';this.blockRates[i]=d.syncRate;continue;}
   const pos=this.blockPositions[i],masterPos=this.blockPositions[d.syncMaster],bpm=bpmAtTime(d.tempoMap,pos),masterBpm=bpmAtTime(m.tempoMap,masterPos),rate=masterBpm*this.blockRates[d.syncMaster]/bpm;
   const limited=Math.max(.5,Math.min(1.5,rate));let corrected=limited;
   if(rate<.5||rate>1.5)d.syncState='range';
   else if(d.playing&&m.playing){const error=phaseDifference(beatAtTime(m.tempoMap,masterPos),beatAtTime(d.tempoMap,pos));corrected+=Math.max(-limited*.025,Math.min(limited*.025,error*60/bpm*3));d.syncState=Math.abs(error)<.01?'locked':'aligning';}
   else d.syncState='tempo';
   d.syncRate=Math.max(.5,Math.min(1.5,corrected));this.blockRates[i]=d.syncRate;
  }
 }
 process(_,outputs){
  const len=outputs[0]?.[0]?.length||128;this.updateSync();
  for(let di=0;di<4;di++){
   const d=this.decks[di],t=this.tracks.get(d.id),out=outputs[di];if(!out?.[0]||!t)continue;const l=out[0],r=out[1]||out[0],ratio=t.sr/sampleRate,dir=d.reverse?-1:1;let speed=(d.scratch?d.scratchRate:this.blockRates[di]*dir)*ratio;const pitch=(d.keyLock?d.pitch:this.blockRates[di]*d.pitch)*dir*ratio;const granular=!d.scratch&&(d.keyLock||Math.abs(d.pitch-1)>.0001)&&Math.abs(pitch-speed)>.0001;
   if(d.reset){d.g1=d.pos;d.g2=d.pos;d.grainPhase=0;d.reset=false;}
   for(let i=0;i<len;i++){
    const active=d.scratch?Math.abs(speed)>.00001:d.playing;const target=active?1:0;d.gain+=(target-d.gain)*.035;
    if(d.playing&&d.scratch)d.ghost+=this.blockRates[di]*dir*ratio;if(d.playing&&d.roll)d.rollGhost+=this.blockRates[di]*dir*ratio;
    if(!active&&d.gain<.00001)continue;
    let a,b;
    if(granular){const phase=d.grainPhase;if(phase===0)d.g1=this.align(t,d,d.pos,d.g2,pitch);if(phase===H)d.g2=this.align(t,d,d.pos,d.g1,pitch);const w1=win[phase],w2=win[(phase+H)%N];a=this.read(t,0,d.g1,d)*w1+this.read(t,0,d.g2,d)*w2;b=this.read(t,1,d.g1,d)*w1+this.read(t,1,d.g2,d)*w2;d.g1+=pitch;d.g2+=pitch;d.grainPhase=(phase+1)%N;}else{a=this.read(t,0,d.pos,d);b=this.read(t,1,d.pos,d);}
    l[i]=a*d.gain;r[i]=b*d.gain;
    // Freeze a stopped transport while the short output envelope closes.
    if(active)d.pos+=speed;
    if(d.loop&&d.end>d.start){if(d.pos>=d.end||d.pos<d.start)d.pos=d.start+wrap(d.pos-d.start,d.end-d.start);}
    else if(d.pos>=t.length-1||d.pos<0){d.pos=Math.max(0,Math.min(t.length-1,d.pos));if(d.playing){d.playing=false;this.port.postMessage({type:'ended',deck:di});}d.gain=0;}
   }
  }
  const sampleOut=outputs[4];if(sampleOut?.[0])for(const v of this.voices){if(!v.on)continue;const t=this.tracks.get(v.id);if(!t){v.on=false;continue;}for(let i=0;i<len;i++){if(v.pos>=v.end){if(v.loop)v.pos=v.start+wrap(v.pos-v.start,v.end-v.start);else{v.on=false;break;}}const fade=Math.min(1,(v.pos-v.start)/128,(v.end-v.pos)/128);sampleOut[0][i]+=this.read(t,0,v.pos)*v.gain*fade;if(sampleOut[1])sampleOut[1][i]+=this.read(t,1,v.pos)*v.gain*fade;v.pos+=t.sr/sampleRate;}}
  this.report+=len;if(this.report>=sampleRate/25){this.report=0;this.port.postMessage({type:'positions',positions:this.decks.map(d=>d.pos/(this.tracks.get(d.id)?.sr||sampleRate)),playing:this.decks.map(d=>d.playing),rates:Array.from(this.blockRates),syncStates:this.decks.map(d=>d.syncState),samples:this.voices.filter(v=>v.on).map(v=>v.slot)});}
  return true;
 }
}
registerProcessor('orbit-transport',OrbitProcessor);
