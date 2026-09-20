import {validTarget,clamp} from './core.js';
import {validMIDIMapping,validHIDMapping,validateControllerProfile,MAX_MAPPINGS} from './controller-profiles.js';
import {DDJFLX4_PROFILE,isDDJFLX4,flx4MessageMapping} from './ddj-flx4-profile.js';

export function decodeMIDI(data){
 if(!data||data.length!==3||!Number.isInteger(data[0])||data[0]<128||data[0]>239||![data[1],data[2]].every(v=>Number.isInteger(v)&&v>=0&&v<=127))return null;
 const kind=data[0]&0xf0,channel=data[0]&15;
 if(kind===0x90||kind===0x80)return {kind:'note',channel,number:data[1],value:kind===0x80?0:data[2],max:127};
 if(kind===0xb0)return {kind:'cc',channel,number:data[1],value:data[2],max:127};
 if(kind===0xe0)return {kind:'pitchbend',channel,number:0,value:(data[2]<<7)|data[1],max:16383};
 return null;
}
export function relative(value,mode){if(mode==='relative-offset')return value-64;if(mode==='relative-sign')return value>64?-(value-64):value===64?0:value;return value>63?value-128:value;}
const deviceName=input=>`${input.manufacturer||''}::${input.name||input.id}`;
const portKey=input=>`midi:${input.id||deviceName(input)}`;
function matches(map,input){return (!map.inputId||map.inputId===input.id)&&(!map.device||map.device===deviceName(input))&&(!map.deviceName||map.deviceName.toLowerCase()===(input.name||'').toLowerCase());}
const isHold=target=>target.endsWith('.scratch');
const jogMeta=map=>({...(map.jogMode!==undefined?{jogMode:map.jogMode}:{}),...(map.sensitivity!==undefined?{sensitivity:map.sensitivity}:{})});
const targetCenter=target=>({rate:.5,gain:2/3,high:5/7,mid:5/7,low:5/7,filter:.5,crossfader:.5})[target.split('.').at(-1)];

export class Controllers extends EventTarget{
 constructor(getSession,dispatch){
  super();Object.assign(this,{getSession,dispatch,access:null,learning:false,target:null,last:'入力待機',lastHID:'入力待機',hidDevices:[]});
  this.ccCache=new Map();this.lastActions=new Map();this.inputs=new Map();this.outputConnections=new Map();this.feedbackState=new Map();this.sentFeedback=new Map();this.hidKeys=new WeakMap();this.knownHID=new WeakSet();this.nextHID=0;
 }
 emit(type,detail){this.dispatchEvent(new CustomEvent(type,{detail}));}
 async connectMIDI(){
  if(this.access){this.attach();return;}
  if(this.connecting)return this.connecting;
  if(!navigator.requestMIDIAccess)throw new Error('このブラウザはWeb MIDIに対応していません。デスクトップ版Chrome / Edge等でお試しください。');
  this.connecting=(async()=>{this.access=await navigator.requestMIDIAccess({sysex:false});this.access.onstatechange=()=>{this.attach();this.emit('devices');};this.attach();this.emit('devices');})();
  try{await this.connecting;}finally{this.connecting=null;}
 }
 attach(){
  if(!this.access)return;
  const connected=new Set();
  for(const input of this.access.inputs.values()){
   if(input.state==='disconnected')continue;
   const key=portKey(input);connected.add(key);
   if(this.inputs.get(key)===input)continue;
   if(this.inputs.has(key))this.releaseInput(key);
   this.inputs.set(key,input);input.onmidimessage=e=>this.receive(input,e.data);
   if(input.open)Promise.resolve(input.open()).catch(e=>{this.last=`${input.name||'MIDI'}: ${e.message}`;this.emit('input',this.last);});
  }
  for(const [key,input]of this.inputs)if(!connected.has(key)){input.onmidimessage=null;this.inputs.delete(key);this.releaseInput(key);}
  let changed=false;
  const outputs=new Map();
  for(const out of this.access.outputs.values())if(out.state!=='disconnected'){outputs.set(out.id,out);if(this.outputConnections.get(out.id)!==out)changed=true;}
  if(outputs.size!==this.outputConnections.size)changed=true;
  this.outputConnections=outputs;if(changed){this.sentFeedback.clear();this.syncFeedback();}
 }
 arm(target){if(!validTarget(target))return;this.target=target;this.emit('learn',target);}
 importProfile(raw,{kind,inputId,merge=false}={}){
  // Validate the entire file before releasing held controls or changing the session.
  const profile=validateControllerProfile(raw,{kind}),s=this.getSession();
  if(inputId){const input=this.access?.inputs.get(inputId);if(!input||input.state==='disconnected')throw new Error('割り当て先のMIDI入力を接続してください。');for(const m of profile.midiMappings||[]){m.inputId=input.id;m.device=deviceName(input);delete m.deviceName;}}
  for(const key of ['midiMappings','hidMappings'])if(profile[key]&&merge&&(s[key]?.length||0)+profile[key].length>MAX_MAPPINGS)throw new Error('合計の割り当てが1000件を超えます。');
  this.resetInputState();
  for(const key of ['midiMappings','hidMappings'])if(profile[key])s[key]=merge?[...(s[key]||[]),...profile[key]]:profile[key];
  this.sentFeedback.clear();this.syncFeedback();this.emit('mapped',profile.name);return profile;
 }
 resetInputState(){for(const key of [...this.lastActions.keys()])this.releaseInput(key);this.ccCache.clear();}
 releaseInput(key){
  const actions=this.lastActions.get(key);this.lastActions.delete(key);this.ccCache.delete(key);
  if(!actions)return;
  const holds=new Set([...actions].filter(([m,v])=>v>0&&isHold(m.target)).map(([m])=>m.target));
  for(const target of holds)if(!this.heldElsewhere(target))this.dispatch(target,0,{relative:false,pressed:false,released:true,disconnected:true});
 }
 heldElsewhere(target){for(const actions of this.lastActions.values())for(const [m,value]of actions)if(m.target===target&&value>0)return true;return false;}
 absolute(key,map,value,flx4Touch=false){
  let actions=this.lastActions.get(key);if(!actions)this.lastActions.set(key,actions=new Map());
  const v=map.invert?1-value:value;let previous=actions.get(map)||0;
  // Normal/SHIFT touch notes describe one physical capacitive sensor. A release
  // under a changed SHIFT state must also release its preceding note number.
  if(flx4Touch)for(const [other,held]of actions)if(other.target===map.target&&other.kind==='note'&&other.channel===map.channel&&[54,103].includes(other.number)){previous=Math.max(previous,held);actions.set(other,0);}
  actions.set(map,v);
  if(isHold(map.target)&&v===0&&this.heldElsewhere(map.target))return;
  this.dispatch(map.target,v,{relative:false,pressed:v>0&&previous===0,released:v===0&&previous>0});
 }
 learnMIDI(input,m){
  const target=this.target,flx4=isDDJFLX4(input),known=flx4?flx4MessageMapping(m):null;
  // A platter touch arrives before rotation. Do not learn it as an absolute jog.
  if(m.kind==='note'&&m.value===0||target.endsWith('.jog')&&(m.kind!=='cc'||flx4&&known?.target.split('.').at(-1)!=='jog'))return false;
  if(flx4&&target.endsWith('.scratch')&&known?.target.split('.').at(-1)!=='scratch')return false;
  if(known?.mode.startsWith('relative')&&!relative(m.value,known.mode))return false;
  const binding={device:deviceName(input),inputId:input.id,invert:false},s=this.getSession();
  let learned;
  if(flx4&&(target.endsWith('.jog')||target.endsWith('.scratch'))){
   // Preserve all physical wheel surfaces when re-learning a deck. Otherwise
   // touching the top to learn it silently removes the separate side-wheel CC.
   const deck=target.slice(0,target.lastIndexOf('.')),sourceDeck=known.target.slice(0,known.target.lastIndexOf('.'));
   learned=DDJFLX4_PROFILE.midiMappings.filter(x=>x.target===known.target||target.endsWith('.jog')&&x.target===`${sourceDeck}.scratch`).map(x=>{
    const {deviceName,...map}=x;return {...map,target:`${deck}.${x.target.split('.').at(-1)}`,...binding};
   });
  }else{
   const mode=known?.mode??(target.endsWith('.jog')?'relative-twos':'absolute');
   const center=mode==='cc14'?targetCenter(target):undefined;
   learned=[{target,kind:m.kind,channel:m.channel,number:known?.mode==='cc14'?known.number:m.number,mode,...binding,...(center===undefined?{}:{center}),...(target.endsWith('.scratch')?{feedback:false}:{})}];
  }
  const targets=new Set(learned.map(x=>x.target)),remaining=(s.midiMappings||[]).filter(x=>!targets.has(x.target));
  if(remaining.length+learned.length>MAX_MAPPINGS){this.last='割り当ては1000件以下にしてください。';this.emit('input',this.last);return false;}
  s.midiMappings=[...remaining,...learned];this.target=null;this.resetInputState();this.emit('mapped',target);return true;
 }
 receive(input,data){
  if(input.state==='disconnected')return;
  const m=decodeMIDI(data);if(!m)return;
  const key=portKey(input),flx4=isDDJFLX4(input);
  this.last=`${input.name||'MIDI'} · CH ${m.channel+1} · ${m.kind.toUpperCase()} ${m.number} = ${m.value}`;this.emit('input',this.last);
  if(this.learning&&this.target&&this.learnMIDI(input,m))return;
  let cache=this.ccCache.get(key);if(!cache)this.ccCache.set(key,cache=new Map());
  if(m.kind==='cc')cache.set(`${m.channel}:${m.number}`,m.value);
  const pairs=new Map();
  for(const map of (this.getSession().midiMappings||[]).slice(0,MAX_MAPPINGS)){
   if(!validMIDIMapping(map)||!matches(map,input)||map.channel!==m.channel||map.kind!==m.kind)continue;
   let val=m.value,max=m.max;
   if(map.mode==='cc14'){
    if(m.number!==map.number&&m.number!==map.number+32)continue;
    const msbKey=`${m.channel}:${map.number}`,lsbKey=`${m.channel}:${map.number+32}`;
    if(!pairs.has(msbKey)){
     const msb=cache.get(msbKey),lsb=cache.get(lsbKey);
     if(msb===undefined||lsb===undefined)continue;
     pairs.set(msbKey,msb*128+lsb);
     // FLX4 transmits complete pairs on every movement. Consuming both avoids
     // a transient jump from a new MSB combined with the preceding LSB. Generic
     // devices may send only the changed byte, so retain their cached partner.
     if(flx4){cache.delete(msbKey);cache.delete(lsbKey);}
    }
    val=pairs.get(msbKey);max=16383;
   }else if(map.number!==m.number)continue;
   if(map.mode?.startsWith('relative')){const delta=relative(val,map.mode);if(delta)this.dispatch(map.target,delta*(map.invert?-1:1),{relative:true,pressed:true,...jogMeta(map)});}
   else{
    let v=clamp(val/max,0,1);
    if(map.center!==undefined){const middle=Math.ceil(max/2)/max;v=v<=middle?v/middle*map.center:map.center+(v-middle)/(1-middle)*(1-map.center);}
    this.absolute(key,map,v,flx4&&isHold(map.target)&&map.kind==='note'&&[54,103].includes(map.number));
   }
  }
 }
 feedback(target,on){this.feedbackState.set(target,!!on);this.sendFeedback(target,!!on);}
 sendFeedback(target,on){
  const s=this.getSession();if(!s.midiFeedback||!this.access)return;
  const out=this.access.outputs.get(s.midiOutput);if(!out||out.state==='disconnected')return;
  for(const m of s.midiMappings||[]){
   if(m.target!==target||!validMIDIMapping(m)||m.feedback===false)continue;
   const f=m.feedback||(m.kind==='note'?{kind:'note',channel:m.channel,number:m.number,on:127,off:0}:null);if(!f)continue;
   const bytes=[(f.kind==='note'?0x90:0xb0)|f.channel,f.number,on?f.on:f.off],key=`${out.id}:${bytes[0]}:${bytes[1]}`;
   if(this.sentFeedback.get(key)===bytes[2])continue;
   try{out.send(bytes);this.sentFeedback.set(key,bytes[2]);}catch{this.sentFeedback.delete(key);}
  }
 }
 refreshFeedback(){this.sentFeedback.clear();this.syncFeedback();}
 syncFeedback(){
  const s=this.getSession();
  for(let i=0;i<(s.decks?.length||0);i++){const d=s.decks[i];for(const key of ['play','cueOn','reverse','slip','keyLock','loop','sync'])this.feedbackState.set(`deck.${i}.${key}`,!!(key==='play'?d.playing:key==='loop'?d.loop?.enabled:key==='sync'?d.syncEnabled:d[key]));}
  for(const [target,on]of this.feedbackState)this.sendFeedback(target,on);
 }
 async connectHID(){
  if(!navigator.hid)throw new Error('このブラウザはWebHIDに対応していません。');
  if(!this.hidListening){
   this.hidListening=true;
   navigator.hid.addEventListener('disconnect',e=>{if(!this.knownHID.has(e.device))return;this.releaseInput(this.hidKeys.get(e.device));this.hidDevices=this.hidDevices.filter(d=>d!==e.device);this.emit('devices');});
   navigator.hid.addEventListener('connect',e=>{if(this.knownHID.has(e.device))this.attachHID(e.device).catch(err=>{this.lastHID=err.message;this.emit('hid-input',this.lastHID);});});
  }
  for(const device of await navigator.hid.requestDevice({filters:[]}))await this.attachHID(device);
  this.emit('devices');
 }
 async attachHID(device){
  if(!device.opened)await device.open();
  if(!this.knownHID.has(device)){this.knownHID.add(device);this.hidKeys.set(device,`hid:${++this.nextHID}`);device.addEventListener('inputreport',e=>this.receiveHID(e));}
  if(!this.hidDevices.includes(device))this.hidDevices.push(device);this.emit('devices');
 }
 receiveHID(e){
  const {device,reportId,data}=e;
  if(!this.hidKeys.has(device))this.hidKeys.set(device,`hid:${++this.nextHID}`);
  const key=this.hidKeys.get(device);
  this.lastHID=`${device.productName} · ${device.vendorId}:${device.productId} · Report ${reportId} · ${Array.from(new Uint8Array(data.buffer,data.byteOffset,Math.min(data.byteLength,24))).map(x=>x.toString(16).padStart(2,'0')).join(' ')}`;this.emit('hid-input',this.lastHID);
  for(const m of (this.getSession().hidMappings||[]).slice(0,MAX_MAPPINGS)){
   if(!validHIDMapping(m)||m.vendorId!==device.vendorId||m.productId!==device.productId||m.reportId!==reportId)continue;
   const offset=m.offset;if(offset>=data.byteLength||m.encoding==='uint16le'&&offset+2>data.byteLength)continue;
   let val=m.encoding==='uint16le'?data.getUint16(offset,true):data.getUint8(offset);
   if(m.mask!==undefined)val&=m.mask;
   if(m.mode?.startsWith('relative')){const delta=relative(val,m.mode);if(delta)this.dispatch(m.target,delta*(m.invert?-1:1),{relative:true,pressed:true});}
   else this.absolute(key,m,clamp((val-(m.min??0))/((m.max??(m.encoding==='uint16le'?65535:255))-(m.min??0)),0,1));
  }
 }
}
