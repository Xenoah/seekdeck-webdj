import {validTarget,clamp} from './core.js';
export function decodeMIDI(data){if(!data||data.length<2)return null;const kind=data[0]&0xf0,channel=data[0]&15;if(kind===0x90||kind===0x80)return {kind:'note',channel,number:data[1],value:kind===0x80?0:(data[2]||0),max:127};if(kind===0xb0)return {kind:'cc',channel,number:data[1],value:data[2]||0,max:127};if(kind===0xe0)return {kind:'pitchbend',channel,number:0,value:((data[2]||0)<<7)|data[1],max:16383};return null;}
export function relative(value,mode){if(mode==='relative-offset')return value-64;if(mode==='relative-sign')return value>64?-(value-64):value;return value>63?value-128:value;}
export class Controllers extends EventTarget{
 constructor(getSession,dispatch){super();this.getSession=getSession;this.dispatch=dispatch;this.access=null;this.learning=false;this.target=null;this.last='入力待機';this.ccCache=new Map();this.hidDevices=[];this.lastHID='入力待機';this.lastActions=new Map();}
 emit(type,detail){this.dispatchEvent(new CustomEvent(type,{detail}));}
 async connectMIDI(){if(!navigator.requestMIDIAccess)throw new Error('このブラウザはWeb MIDIに対応していません。デスクトップ版Chrome / Edge等でお試しください。');this.access=await navigator.requestMIDIAccess({sysex:false});this.attach();this.access.onstatechange=()=>{this.attach();this.emit('devices');};this.emit('devices');}
 attach(){for(const input of this.access.inputs.values())input.onmidimessage=e=>this.receive(input,e.data);}
 arm(target){if(!validTarget(target))return;this.target=target;this.emit('learn',target);}
 receive(input,data){const m=decodeMIDI(data);if(!m)return;const device=`${input.manufacturer||''}::${input.name||input.id}`;this.last=`${input.name||'MIDI'} · CH ${m.channel+1} · ${m.kind.toUpperCase()} ${m.number} = ${m.value}`;this.emit('input',this.last);
  if(this.learning&&this.target&&m.value>0){const s=this.getSession();s.midiMappings=s.midiMappings.filter(x=>x.target!==this.target);s.midiMappings.push({target:this.target,device,kind:m.kind,channel:m.channel,number:m.number,mode:this.target.endsWith('.jog')?'relative-twos':'absolute',invert:false});const target=this.target;this.target=null;this.emit('mapped',target);return;}
  const cacheKey=`${device}:${m.channel}:${m.number}`;this.ccCache.set(cacheKey,m.value);
  for(const map of this.getSession().midiMappings){if(map.device&&map.device!==device)continue;if(map.channel!==m.channel||map.kind!==m.kind)continue;let val=m.value,max=m.max;if(map.mode==='cc14'&&m.kind==='cc'){if(m.number!==map.number&&m.number!==map.number+32)continue;val=(this.ccCache.get(`${device}:${m.channel}:${map.number}`)||0)*128+(this.ccCache.get(`${device}:${m.channel}:${map.number+32}`)||0);max=16383;}else if(map.number!==m.number)continue;
   if(map.mode?.startsWith('relative')){const delta=relative(val,map.mode);if(delta)this.dispatch(map.target,delta*(map.invert?-1:1),{relative:true,pressed:true});}
   else{const v=clamp(val/max,0,1);const previous=this.lastActions.get(map)||0;this.lastActions.set(map,v);this.dispatch(map.target,map.invert?1-v:v,{relative:false,pressed:v>0&&previous===0,released:v===0&&previous>0});}
  }
 }
 feedback(target,on){const s=this.getSession();if(!s.midiFeedback||!this.access)return;const out=this.access.outputs.get(s.midiOutput);if(!out)return;for(const m of s.midiMappings.filter(x=>x.target===target&&x.kind==='note'))try{out.send([0x90|m.channel,m.number,on?127:0]);}catch{};}
 async connectHID(){if(!navigator.hid)throw new Error('このブラウザはWebHIDに対応していません。');const devices=await navigator.hid.requestDevice({filters:[]});for(const device of devices){if(!device.opened)await device.open();if(!this.hidDevices.includes(device)){this.hidDevices.push(device);device.addEventListener('inputreport',e=>this.receiveHID(e));}}this.emit('devices');}
 receiveHID(e){const {device,reportId,data}=e;this.lastHID=`${device.productName} · ${device.vendorId}:${device.productId} · Report ${reportId} · ${Array.from(new Uint8Array(data.buffer,data.byteOffset,Math.min(data.byteLength,24))).map(x=>x.toString(16).padStart(2,'0')).join(' ')}`;this.emit('hid-input',this.lastHID);
  for(const m of this.getSession().hidMappings){if(m.vendorId!==device.vendorId||m.productId!==device.productId||m.reportId!==reportId)continue;const offset=Number(m.offset);if(!Number.isInteger(offset)||offset<0||offset>=data.byteLength)continue;let val;if(m.encoding==='uint16le'){if(offset+2>data.byteLength)continue;val=data.getUint16(offset,true);}else val=data.getUint8(offset);if(Number.isInteger(m.mask))val=val&m.mask;
   if(m.mode?.startsWith('relative')){const delta=relative(val,m.mode);if(delta)this.dispatch(m.target,delta,{relative:true,pressed:true});}else{const v=clamp((val-(m.min||0))/((m.max??255)-(m.min||0)||1),0,1),previous=this.lastActions.get(m)||0;this.lastActions.set(m,v);this.dispatch(m.target,m.invert?1-v:v,{pressed:v>0&&previous===0,released:v===0&&previous>0});}
  }
 }
}
