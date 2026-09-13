// Independent implementation of documented Serato binary metadata; see docs/interoperability.md.
const enc=new TextEncoder(),dec=new TextDecoder('utf-8',{fatal:true});
const view=b=>new DataView(b.buffer,b.byteOffset,b.byteLength);
const join=parts=>{const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let i=0;for(const p of parts){out.set(p,i);i+=p.length;}return out;};
const ascii=b=>new TextDecoder('latin1').decode(b);
const rgb=(b,i)=>'#'+Array.from(b.subarray(i,i+3),n=>n.toString(16).padStart(2,'0')).join('');
const color=s=>/^#[a-f\d]{6}$/i.test(s||'')?Uint8Array.from(s.slice(1).match(/../g),n=>parseInt(n,16)):new Uint8Array([255,128,64]);
const name=b=>dec.decode(b.subarray(0,b.indexOf(0)<0?b.length:b.indexOf(0))).slice(0,200);
const millis=v=>{const n=Math.round(v*1000);if(!Number.isFinite(n)||n<0||n>0xffffffff)throw new Error('Seratoマーカーの時刻が範囲外です。');return n;};
const label=s=>{let text=String(s||'').replace(/\0/g,'').slice(0,200);while(enc.encode(text).length>48)text=text.slice(0,-1);return join([enc.encode(text),new Uint8Array(1)]);};
export function parseMarkers2(bytes){
 if(bytes.length<3||bytes[0]!==1||bytes[1]!==1)throw new Error('未対応のSerato Markers2バージョンです。');
 let text=ascii(bytes.subarray(2,bytes.indexOf(0,2)<0?bytes.length:bytes.indexOf(0,2))).replace(/\s/g,'');if(text.length%4===1)text+='A';
 if(!/^[A-Za-z0-9+/]*={0,2}$/.test(text))throw new Error('Serato Markers2のBase64が不正です。');
 const data=Uint8Array.from(atob(text),c=>c.charCodeAt(0));if(data[0]!==1||data[1]!==1)throw new Error('Serato Markers2のヘッダーが不正です。');
 const entries=[],cues=Array(8).fill(null),cueDetails=Array(8).fill(null),memoryCues=[];let i=2;
 while(i<data.length&&data[i]){const end=data.indexOf(0,i);if(end<0||end-i>32||end+5>data.length)throw new Error('Seratoマーカーのヘッダーが途中で切れています。');const type=ascii(data.subarray(i,end)),size=view(data).getUint32(end+1);i=end+5;if(size>data.length-i)throw new Error('Seratoマーカーの長さが不正です。');const body=data.slice(i,i+size);i+=size;entries.push({type,body});if(entries.length>4096)throw new Error('Seratoマーカーが多すぎます。');
  if(type==='CUE'){if(size<13)throw new Error('Serato CUEが短すぎます。');const slot=body[1],start=view(body).getUint32(2)/1000;if(slot<8){cues[slot]=start;cueDetails[slot]={name:name(body.subarray(12)),type:'cue',start,color:rgb(body,7)};}}
  if(type==='LOOP'){if(size<21)throw new Error('Serato LOOPが短すぎます。');const start=view(body).getUint32(2)/1000,end=view(body).getUint32(6)/1000;if(end>start)memoryCues.push({name:name(body.subarray(20)),type:'loop',start,end,color:rgb(body,15),seratoSlot:body[1],locked:!!body[19]});}
 }
 if(i>=data.length)throw new Error('Seratoマーカーの終端がありません。');return {entries,cues,cueDetails,memoryCues};
}
function marker(type,body){const header=new Uint8Array(4);view(header).setUint32(0,body.length);return join([enc.encode(type),new Uint8Array(1),header,body]);}
function loopsFor(track){const all=[...(track.memoryCues||[]).filter(m=>m.type==='loop'),...(track.cues||[]).flatMap((v,i)=>track.cueDetails?.[i]?.type==='loop'?[{...track.cueDetails[i],start:v}]:[])];const unique=all.filter((m,i)=>all.findIndex(n=>n.start===m.start&&n.end===m.end)===i);if(unique.length>9)throw new Error('Seratoの保存ループは9個以下にしてください。');const used=new Set();return unique.map(m=>{let slot=m.seratoSlot;if(!Number.isInteger(slot)||slot<0||slot>8||used.has(slot)){slot=0;while(used.has(slot))slot++;}used.add(slot);return {...m,seratoSlot:slot};});}
export function writeMarkers2(track,previous=[]){
 const records=previous.filter(e=>!['CUE','LOOP'].includes(e.type)).map(e=>marker(e.type,e.body));
 for(let slot=0;slot<8;slot++){const start=track.cues?.[slot];if(!Number.isFinite(start))continue;const m=track.cueDetails?.[slot]||{},body=new Uint8Array(12);body[1]=slot;view(body).setUint32(2,millis(start));body.set(color(m.color),7);records.push(marker('CUE',join([body,label(m.name)])));}
 for(const m of loopsFor(track)){const body=new Uint8Array(20);body[1]=m.seratoSlot;view(body).setUint32(2,millis(m.start));view(body).setUint32(6,millis(m.end));body.fill(255,10,14);body.set(color(m.color),15);body[19]=m.locked?1:0;records.push(marker('LOOP',join([body,label(m.name)])));}
 const raw=join([new Uint8Array([1,1]),...records,new Uint8Array(1)]);let binary='';for(const b of raw)binary+=String.fromCharCode(b);const encoded=enc.encode(btoa(binary).replace(/=+$/,'').replace(/.{72}/g,'$&\n'));const out=new Uint8Array(Math.max(470,encoded.length+3));out.set([1,1]);out.set(encoded,2);return out;
}
function read24(b,i){return ((b[i]&7)<<21)|((b[i+1]&127)<<14)|((b[i+2]&127)<<7)|(b[i+3]&127);}
function write24(b,i,n){if(n>0xffffff)throw new Error('旧Seratoマーカーの時刻上限を超えています。');b.set([(n>>>21)&7,(n>>>14)&127,(n>>>7)&127,n&127],i);}
export function parseLegacyMarkers(bytes,modern={}){
 if(bytes.length!==318||bytes[0]!==2||bytes[1]!==5||view(bytes).getUint32(2)!==14)throw new Error('未対応のSerato Markers_形式です。');
 const cues=[...(modern.cues||Array(8).fill(null))],cueDetails=[...(modern.cueDetails||Array(8).fill(null))],memoryCues=(modern.memoryCues||[]).filter(m=>!(m.seratoSlot>=0&&m.seratoSlot<9));
 for(let i=0;i<14;i++){const p=6+i*22,start=bytes[p]===0?read24(bytes,p+1)/1000:null,end=bytes[p+5]===0?read24(bytes,p+6)/1000:null,c='#'+read24(bytes,p+16).toString(16).padStart(6,'0');if(i<5){cues[i]=start;cueDetails[i]=start==null?null:{...cueDetails[i],start,type:'cue',color:c};}else if(start!=null&&end>start){const slot=i-5,old=modern.memoryCues?.find(m=>m.seratoSlot===slot);memoryCues.push({...old,start,end,type:'loop',color:c,seratoSlot:slot,locked:!!bytes[p+21]});}}
 return {cues,cueDetails,memoryCues};
}
export function writeLegacyMarkers(track,previous){
 const out=new Uint8Array(318);out.set([2,5,0,0,0,14]);const loops=loopsFor(track);
 for(let i=0;i<14;i++){const p=6+i*22;out.fill(127,p,p+16);out[p+10]=0;out[p+20]=i<5?1:3;const m=i<5?(Number.isFinite(track.cues?.[i])?{...track.cueDetails?.[i],start:track.cues[i],end:undefined}:null):loops.find(l=>l.seratoSlot===i-5);if(!m)continue;out[p]=0;write24(out,p+1,millis(m.start));if(i>=5){out[p+5]=0;write24(out,p+6,millis(m.end));}write24(out,p+16,parseInt(rgb(color(m.color),0).slice(1),16));out[p+21]=m.locked?1:0;}
 out.set(previous?.length===318?previous.subarray(314):new Uint8Array([7,127,127,127]),314);return out;
}
export function parseSeratoBeatgrid(bytes){
 if(bytes.length<7||bytes[0]!==1||bytes[1]!==0)throw new Error('未対応のSerato BeatGrid形式です。');const count=view(bytes).getUint32(2);if(count>4096||bytes.length!==7+8*count)throw new Error('Serato BeatGridの長さが不正です。');const map=[];
 for(let i=0;i<count;i++){const p=6+i*8,time=view(bytes).getFloat32(p),next=i+1<count?view(bytes).getFloat32(p+8):null,bpm=next==null?view(bytes).getFloat32(p+4):60*view(bytes).getUint32(p+4)/(next-time);if(!Number.isFinite(time)||time<0||(i&&time<=map.at(-1).time)||!Number.isFinite(bpm)||bpm<20||bpm>400)throw new Error('Serato BeatGridの時刻またはBPMが不正です。');map.push({time,bpm,meter:4,beat:1});}return map;
}
export function writeSeratoBeatgrid(track){
 const map=track.tempoMap?.length?track.tempoMap:[{time:track.gridOffset||0,bpm:track.bpm}];if(map.length>4096)throw new Error('Serato BeatGridは4,096点以下にしてください。');const out=new Uint8Array(7+map.length*8);out.set([1,0]);view(out).setUint32(2,map.length);
 map.forEach((m,i)=>{const p=6+i*8;if(!Number.isFinite(m.time)||m.time<0||!Number.isFinite(m.bpm)||m.bpm<20||m.bpm>400)throw new Error('Serato BeatGridの時刻またはBPMが不正です。');view(out).setFloat32(p,m.time);if(i===map.length-1)view(out).setFloat32(p+4,m.bpm);else{const beats=(map[i+1].time-m.time)*m.bpm/60;if(beats<1||beats>0xffffffff||Math.abs(beats-Math.round(beats))>.001)throw new Error('Serato用グリッドはテンポ変更点を拍に合わせてください。');view(out).setUint32(p+4,Math.round(beats));}});out[out.length-1]=0x37;return out;
}
