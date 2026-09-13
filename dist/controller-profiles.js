import {validTarget} from './core.js';

export const PROFILE_FORMAT='seekdeck-controller';
export const MAX_MAPPINGS=1000;
const MODES=['absolute','cc14','relative-twos','relative-offset','relative-sign'];
const integer=(v,min,max)=>Number.isInteger(v)&&v>=min&&v<=max;
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const text=(v,max)=>v===undefined||typeof v==='string'&&v.length<=max;
const unit=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1;

export function validMIDIMapping(m){
 if(!plain(m)||!validTarget(m.target)||!['note','cc','pitchbend'].includes(m.kind)||!integer(m.channel,0,15)||!integer(m.number,0,127))return false;
 const mode=m.mode??'absolute';
 if(!MODES.includes(mode)||mode==='cc14'&&(m.kind!=='cc'||m.number>31)||m.kind==='pitchbend'&&(m.number!==0||mode!=='absolute'))return false;
 if(!text(m.device,256)||!text(m.inputId,256)||!text(m.deviceName,128)||m.invert!==undefined&&typeof m.invert!=='boolean')return false;
 if(m.center!==undefined&&(!unit(m.center)||mode.startsWith('relative')||m.kind==='note'))return false;
 if(m.feedback!==undefined&&m.feedback!==false){const f=m.feedback;if(!plain(f)||!['note','cc'].includes(f.kind)||!integer(f.channel,0,15)||!integer(f.number,0,127)||!integer(f.on,0,127)||!integer(f.off,0,127))return false;}
 return true;
}
export function validHIDMapping(m){
 if(!plain(m)||!validTarget(m.target)||!integer(m.vendorId,0,65535)||!integer(m.productId,0,65535)||!integer(m.reportId,0,255)||!integer(m.offset,0,65535))return false;
 const encoding=m.encoding??'uint8',max=encoding==='uint16le'?65535:255;
 return ['uint8','uint16le'].includes(encoding)&&MODES.filter(x=>x!=='cc14').includes(m.mode??'absolute')&&(m.mask===undefined||integer(m.mask,0,max))&&(m.min===undefined||integer(m.min,0,max))&&(m.max===undefined||integer(m.max,0,max))&&(m.max??max)>(m.min??0)&&(m.invert===undefined||typeof m.invert==='boolean');
}
function cleanMIDI(m){
 const result={target:m.target,kind:m.kind,channel:m.channel,number:m.number,mode:m.mode??'absolute',invert:!!m.invert};
 for(const k of ['device','deviceName','inputId','center'])if(m[k]!==undefined)result[k]=m[k];
 if(m.feedback!==undefined)result.feedback=m.feedback===false?false:{kind:m.feedback.kind,channel:m.feedback.channel,number:m.feedback.number,on:m.feedback.on,off:m.feedback.off};
 return result;
}
function cleanHID(m){const result={target:m.target,vendorId:m.vendorId,productId:m.productId,reportId:m.reportId,offset:m.offset,encoding:m.encoding??'uint8',mode:m.mode??'absolute',invert:!!m.invert};for(const k of ['mask','min','max'])if(m[k]!==undefined)result[k]=m[k];return result;}
export function validateControllerProfile(raw,{kind}={}){
 if(!plain(raw)||raw.version!==undefined&&raw.version!==1||raw.format!==undefined&&raw.format!==PROFILE_FORMAT)throw new Error('コントローラープロファイルの形式またはバージョンが不正です。');
 const midi=raw.midiMappings??raw.mappings,hid=raw.hidMappings;
 if(kind==='midi'&&!Array.isArray(midi)||kind==='hid'&&!Array.isArray(hid)||midi===undefined&&hid===undefined)throw new Error('必要な割り当て配列がありません。');
 const result={format:PROFILE_FORMAT,version:1,name:typeof raw.name==='string'?raw.name.slice(0,128):'Custom controller'};
 for(const [key,list,validate,clean]of [['midiMappings',midi,validMIDIMapping,cleanMIDI],['hidMappings',hid,validHIDMapping,cleanHID]]){
  if(list===undefined||kind==='midi'&&key==='hidMappings'||kind==='hid'&&key==='midiMappings')continue;
  if(!Array.isArray(list)||list.length>MAX_MAPPINGS)throw new Error('割り当ては各1000件以下の配列にしてください。');
  const invalid=list.findIndex(m=>!validate(m));if(invalid!==-1)throw new Error(`${key} の ${invalid+1} 行目が不正です。現在の割り当ては変更していません。`);
  result[key]=list.map(clean);
 }
 return result;
}

// Independently transcribed protocol values from AlphaTheta's DDJ-400 MIDI list v1.00.
// Channel fields are zero based. No SysEx, private initialization or motor commands.
const midiMappings=[];
const add=(target,kind,channel,number,extra={})=>midiMappings.push({target,kind,channel,number,mode:'absolute',deviceName:'DDJ-400',...extra});
for(let d=0;d<2;d++){
 for(const [key,n]of [['play',11],['cue',12],['sync',88],['loop',77],['cueOn',84]])add(`deck.${d}.${key}`,'note',d,n);
 add(`deck.${d}.scratch`,'note',d,54,{feedback:false});
 for(const n of [33,34,35])add(`deck.${d}.jog`,'cc',d,n,{mode:'relative-offset'});
 for(const [key,n,center]of [['rate',0,.5],['volume',19,undefined],['gain',4,2/3],['high',7,5/7],['mid',11,5/7],['low',15,5/7]])add(`deck.${d}.${key}`,'cc',d,n,{mode:'cc14',...(center===undefined?{}:{center})});
 add(`deck.${d}.filter`,'cc',6,23+d,{mode:'cc14',center:.5});
 for(let pad=0;pad<8;pad++)add(`deck.${d}.hotcue${pad}`,'note',7+d*2,pad);
}
for(const [key,n]of [['crossfader',31],['master',8],['cueMix',12],['headphone',13]])add(`mixer.${key}`,'cc',6,n,{mode:'cc14',...(key==='crossfader'?{center:.5}:{})});
export const DDJ400_PROFILE={format:PROFILE_FORMAT,version:1,name:'Pioneer DJ DDJ-400 · Basic',midiMappings};
export const CONTROLLER_PRESETS=[{id:'ddj-400-basic',name:DDJ400_PROFILE.name,profile:DDJ400_PROFILE}];
