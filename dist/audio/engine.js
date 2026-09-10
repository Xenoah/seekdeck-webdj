import {xfadeGains,clamp} from '../core.js';
export class AudioEngine extends EventTarget{
 constructor(){super();this.context=null;this.ready=null;this.buffers=new Map();this.pending=new Map();this.positions=[0,0,0,0];this.playing=[false,false,false,false];this.sampleSlots=[];this.channels=[];this.recording=false;this.recordChunks=[];this.loadedIds=[null,null,null,null];this.maxBytes=512*1024*1024;this.meterArray=new Float32Array(512);}
 emit(type,detail){this.dispatchEvent(new CustomEvent(type,{detail}));}
 async init(){
  if(this.ready){await this.ready;await this.context.resume();if(this.cueContext)await this.cueContext.resume();return;}
  this.ready=this.setup();try{await this.ready;}catch(e){this.ready=null;await this.context?.close().catch(()=>{});this.context=null;throw e;}
 }
 async setup(){
  if(!globalThis.AudioContext||!globalThis.AudioWorkletNode)throw new Error('このブラウザはAudioWorkletに対応していません。');
  const c=this.context=new AudioContext({latencyHint:'interactive'});await c.resume();await c.audioWorklet.addModule(new URL('./processor.js',import.meta.url));
  this.node=new AudioWorkletNode(c,'orbit-transport',{numberOfInputs:0,numberOfOutputs:5,outputChannelCount:[2,2,2,2,2]});this.node.onprocessorerror=()=>this.emit('error','音声エンジンが停止しました。ページを再読み込みしてください。');
  this.node.port.onmessage=({data:m})=>{if(m.type==='positions'){this.positions=m.positions;this.playing=m.playing;this.sampleSlots=m.samples;}else if(m.type==='buffered'){this.pending.get(m.id)?.();this.pending.delete(m.id);}else if(m.type==='ended'){this.playing[m.deck]=false;this.emit('ended',m.deck);}};
  this.masterBus=c.createGain();this.masterGain=c.createGain();this.masterGain.gain.value=.75;this.limiter=c.createDynamicsCompressor();Object.assign(this.limiter.threshold,{value:-1});this.limiter.knee.value=0;this.limiter.ratio.value=20;this.limiter.attack.value=.002;this.limiter.release.value=.1;this.masterMeter=c.createAnalyser();this.masterMeter.fftSize=1024;this.masterBus.connect(this.masterGain).connect(this.limiter).connect(this.masterMeter);
  this.cueBus=c.createGain();this.cueLevel=c.createGain();this.cueSourceGain=c.createGain();this.cueMasterGain=c.createGain();this.cueBus.connect(this.cueSourceGain).connect(this.cueLevel);this.limiter.connect(this.cueMasterGain).connect(this.cueLevel);this.cueMasterGain.gain.value=0;
  this.recordDestination=c.createMediaStreamDestination();this.limiter.connect(this.recordDestination);
  const impulse=c.createBuffer(2,Math.ceil(c.sampleRate*1.8),c.sampleRate);let rand=76543;for(let ch=0;ch<2;ch++){const a=impulse.getChannelData(ch);for(let i=0;i<a.length;i++){rand=(Math.imul(rand,1664525)+1013904223)|0;a[i]=(rand/2147483648)*Math.pow(1-i/a.length,2.4)*.6;}}
  for(let i=0;i<4;i++){
   const trim=c.createGain(),low=c.createBiquadFilter(),mid=c.createBiquadFilter(),high=c.createBiquadFilter(),filter=c.createBiquadFilter();low.type='lowshelf';low.frequency.value=260;mid.type='peaking';mid.frequency.value=1100;mid.Q.value=.65;high.type='highshelf';high.frequency.value=4200;filter.type='lowpass';filter.frequency.value=22000;filter.Q.value=.707;
   const dry=c.createGain(),wet=c.createGain(),bus=c.createGain(),volume=c.createGain(),xfade=c.createGain(),cue=c.createGain(),meter=c.createAnalyser();meter.fftSize=512;wet.gain.value=0;cue.gain.value=0;
   this.node.connect(trim,i);trim.connect(low).connect(mid).connect(high).connect(filter);filter.connect(dry).connect(bus);wet.connect(bus);bus.connect(meter);bus.connect(volume).connect(xfade).connect(this.masterBus);bus.connect(cue).connect(this.cueBus);
   const delay=c.createDelay(4),feedback=c.createGain(),echoInput=c.createGain(),echoOut=c.createGain();feedback.gain.value=.38;filter.connect(echoInput).connect(delay);delay.connect(feedback).connect(delay);delay.connect(echoOut).connect(wet);
   const convolver=c.createConvolver(),reverbInput=c.createGain(),reverbOut=c.createGain();convolver.buffer=impulse;filter.connect(reverbInput).connect(convolver).connect(reverbOut).connect(wet);reverbInput.gain.value=0;reverbOut.gain.value=0;
   const flange=c.createDelay(.1),flangeInput=c.createGain(),flangeOut=c.createGain(),lfo=c.createOscillator(),depth=c.createGain();flange.delayTime.value=.004;lfo.frequency.value=.2;depth.gain.value=.003;lfo.connect(depth).connect(flange.delayTime);lfo.start();filter.connect(flangeInput).connect(flange).connect(flangeOut).connect(wet);flangeInput.gain.value=0;flangeOut.gain.value=0;
   this.channels.push({trim,low,mid,high,filter,dry,wet,bus,volume,xfade,cue,meter,delay,feedback,echoInput,echoOut,reverbInput,reverbOut,flangeInput,flangeOut,lfo});
  }
  this.samplerGain=c.createGain();this.samplerGain.gain.value=.65;this.node.connect(this.samplerGain,4);this.samplerGain.connect(this.masterBus);this.masterMeter.connect(c.destination);this.route='stereo';
  c.onstatechange=()=>this.emit('state',c.state);this.emit('state',c.state);
 }
 send(m){this.node?.port.postMessage(m);}
 param(p,v){if(p&&this.context)p.setTargetAtTime(v,this.context.currentTime,.007);}
 async decode(blob){await this.init();try{return await this.context.decodeAudioData(await blob.arrayBuffer());}catch{throw new Error('この音源をデコードできません。対応コーデックはブラウザによって異なります。WAV / MP3で再試行してください。');}}
 async addBuffer(id,audio,protect=[]){
  if(this.buffers.has(id))return;const needed=audio.length*audio.numberOfChannels*4;let used=[...this.buffers.values()].reduce((s,x)=>s+x.bytes,0);const keep=new Set([...this.loadedIds,...protect]);
  for(const [key,b] of this.buffers){if(used+needed<=this.maxBytes)break;if(!keep.has(key)){this.send({type:'unload',id:key});this.buffers.delete(key);used-=b.bytes;}}
  if(used+needed>this.maxBytes)throw new Error('デコード音源が512 MBの上限を超えます。使っていないデッキやサンプルを解除するか、短い音源を使ってください。');
  const channels=Array.from({length:Math.min(audio.numberOfChannels,2)},(_,i)=>audio.getChannelData(i).slice());this.buffers.set(id,{bytes:channels.length*audio.length*4,duration:audio.duration});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);this.buffers.delete(id);reject(new Error('音声バッファの受け渡しがタイムアウトしました。'));},15000);this.pending.set(id,()=>{clearTimeout(timer);resolve();});this.node.port.postMessage({type:'buffer',id,channels,sampleRate:audio.sampleRate},channels.map(a=>a.buffer));});
 }
 has(id){return this.buffers.has(id);}
 load(deck,id,position=0){this.loadedIds[deck]=id;this.positions[deck]=position;this.playing[deck]=false;this.send({type:'load',deck,id,position});}
 play(deck,on){this.playing[deck]=on;this.send({type:'play',deck,on});}
 seek(deck,position){this.positions[deck]=position;this.send({type:'seek',deck,position});}
 scratch(deck,active,speed=0){this.send({type:'scratch',deck,active,speed});}
 roll(deck,on,start,end){this.send({type:'roll',deck,on,start,end});}
 applyDeck(i,d,bpm=120){
  this.send({type:'params',deck:i,...d});const n=this.channels[i];if(!n)return;const db=v=>Math.pow(10,v/20);this.param(n.trim.gain,db(d.gain));this.param(n.low.gain,d.low);this.param(n.mid.gain,d.mid);this.param(n.high.gain,d.high);this.param(n.volume.gain,d.volume);this.param(n.cue.gain,d.cueOn?1:0);
  const f=d.filter;n.filter.type=f>0?'highpass':'lowpass';this.param(n.filter.frequency,f>0?30*Math.pow(600,f):22000*Math.pow(50/22000,-f));this.param(n.filter.Q,Math.abs(f)>.05?1:.707);
  this.param(n.dry.gain,1-d.fx.mix*.4);this.param(n.wet.gain,d.fx.mix*.7);this.param(n.delay.delayTime,Math.min(3.9,60/bpm*d.fx.beats));for(const type of ['echo','reverb','flange']){const on=d.fx.type===(type==='flange'?'flanger':type);this.param(n[type+'Input'].gain,on?1:0);this.param(n[type+'Out'].gain,on?1:0);}
 }
 applyMixer(m,decks){if(!this.context)return;this.param(this.masterGain.gain,m.master);this.param(this.cueLevel.gain,m.headphone);this.param(this.cueSourceGain.gain,1-m.cueMix);this.param(this.cueMasterGain.gain,m.cueMix);this.param(this.samplerGain.gain,m.sampler);const gains=xfadeGains(m.crossfader,m.curve);decks.forEach((d,i)=>this.param(this.channels[i].xfade.gain,d.assign==='A'?gains[0]:d.assign==='B'?gains[1]:1));}
 async setRoute(m){
  await this.init();const c=this.context;
  if(m.masterSink&&m.masterSink!=='default'){if(!c.setSinkId)throw new Error('このブラウザでは出力デバイスを選択できません。');await c.setSinkId(m.masterSink);}else if(c.setSinkId)await c.setSinkId('');
  if(m.route==='multi'&&c.destination.maxChannelCount<4)throw new Error('選択中の出力は4チャンネル出力に対応していません。');
  if(m.route==='device'){
   if(m.cueSink===m.masterSink||m.cueSink==='default')throw new Error('CUEにはMASTERと異なる出力機器を指定してください。');
   if(!c.setSinkId)throw new Error('このブラウザでは別デバイスへのCUE出力に対応していません。');
   if(!this.cueContext){this.cueDestination=c.createMediaStreamDestination();this.cueContext=new AudioContext({latencyHint:'interactive'});this.cueStreamSource=this.cueContext.createMediaStreamSource(this.cueDestination.stream);this.cueStreamSource.connect(this.cueContext.destination);}
   await this.cueContext.setSinkId(m.cueSink);await this.cueContext.resume();
  }
  // Keep recording and the master-to-cue mix connected; replace output branches only.
  try{this.masterMeter.disconnect();}catch{}try{this.cueLevel.disconnect();}catch{}for(const n of this.routingNodes||[])try{n.disconnect();}catch{}this.routingNodes=[];
  c.destination.channelCount=m.route==='multi'?4:2;
  if(m.route==='multi'){const a=c.createChannelSplitter(2),b=c.createChannelSplitter(2),join=c.createChannelMerger(4);this.masterMeter.connect(a);this.cueLevel.connect(b);a.connect(join,0,0);a.connect(join,1,1);b.connect(join,0,2);b.connect(join,1,3);join.connect(c.destination);this.routingNodes=[a,b,join];}
  else if(m.route==='split'){const a=c.createGain(),b=c.createGain(),join=c.createChannelMerger(2);a.channelCount=1;a.channelCountMode='explicit';b.channelCount=1;b.channelCountMode='explicit';this.masterMeter.connect(a).connect(join,0,0);this.cueLevel.connect(b).connect(join,0,1);join.connect(c.destination);this.routingNodes=[a,b,join];}
  else{this.masterMeter.connect(c.destination);if(m.route==='device')this.cueLevel.connect(this.cueDestination);}
  this.route=m.route;
 }
 meter(node){if(!node)return 0;node.getFloatTimeDomainData(this.meterArray);let max=0;for(let i=0;i<this.meterArray.length;i++)max=Math.max(max,Math.abs(this.meterArray[i]));return max;}
 startRecording(){if(!globalThis.MediaRecorder)throw new Error('このブラウザはミックス録音に対応していません。');if(this.recording)return;const mime=['audio/webm;codecs=opus','audio/ogg;codecs=opus','audio/mp4'].find(s=>MediaRecorder.isTypeSupported(s));this.recorder=new MediaRecorder(this.recordDestination.stream,mime?{mimeType:mime,audioBitsPerSecond:256000}:undefined);this.recordChunks=[];this.recorder.ondataavailable=e=>{if(e.data.size)this.recordChunks.push(e.data);};this.recorder.onerror=e=>{this.emit('error','録音中にエラーが発生しました。残っている音声を停止して保存してください。');};this.recorder.start(1000);this.recording=true;this.recordStarted=Date.now();}
 stopRecording(){return new Promise(resolve=>{if(!this.recording){resolve(null);return;}this.recorder.onstop=()=>{const blob=new Blob(this.recordChunks,{type:this.recorder.mimeType});this.recordChunks=[];this.recording=false;resolve(blob);};this.recorder.stop();});}
 sample(slot,p){this.send({type:'sample',id:p.trackId,slot,start:p.start,duration:p.duration,gain:p.gain,loop:p.loop,toggle:p.loop});}
 stopSamples(){this.send({type:'stopSamples'});}
 get latency(){const c=this.context;if(!c)return null;return {base:c.baseLatency*1000,output:typeof c.outputLatency==='number'?c.outputLatency*1000:null,sampleRate:c.sampleRate,state:c.state};}
}
