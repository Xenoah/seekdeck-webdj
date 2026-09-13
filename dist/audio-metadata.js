import {parseMarkers2,writeMarkers2,parseLegacyMarkers,writeLegacyMarkers,parseSeratoBeatgrid,writeSeratoBeatgrid} from './serato-tags.js';
const MAX_TAG_BYTES=16*1024*1024,encoder=new TextEncoder();
const view=b=>new DataView(b.buffer,b.byteOffset,b.byteLength);
const join=parts=>{const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let i=0;for(const p of parts){out.set(p,i);i+=p.length;}return out;};
const ascii=b=>Array.from(b,n=>String.fromCharCode(n)).join('');
function syncsafe(b,i=0){if(i+4>b.length||b.subarray(i,i+4).some(v=>v&128))throw new Error('ID3のサイズが不正です。');return b[i]*2097152+b[i+1]*16384+b[i+2]*128+b[i+3];}
function putSyncsafe(b,i,n){b.set([(n>>>21)&127,(n>>>14)&127,(n>>>7)&127,n&127],i);}
function unsync(b){const out=[];for(let i=0;i<b.length;i++){out.push(b[i]);if(b[i]===255&&b[i+1]===0)i++;}return new Uint8Array(out);}
function text(b,encoding){const codecs=['iso-8859-1','utf-16','utf-16be','utf-8'];if(!codecs[encoding])throw new Error('ID3の文字コードが未対応です。');return new TextDecoder(codecs[encoding],{fatal:true}).decode(b).replace(/^\uFEFF/,'').replace(/\0+$/,'').slice(0,2000);}
function field(b,start,encoding=0){const step=encoding===1||encoding===2?2:1;let end=start;while(end+step<=b.length){if(b[end]===0&&(step===1||b[end+1]===0))return {value:text(b.subarray(start,end),encoding),next:end+step};end+=step;}throw new Error('ID3の文字列終端がありません。');}
export function readID3(bytes,{writing=false}={}){
 if(bytes.length<10||ascii(bytes.subarray(0,3))!=='ID3')return {version:4,end:0,flags:0,frames:[]};
 const version=bytes[3],flags=bytes[5],size=syncsafe(bytes,6);if(![3,4].includes(version))throw new Error('ID3v2.3 / v2.4のMP3のみ対応しています。');if(size>MAX_TAG_BYTES||bytes.length<10+size)throw new Error('ID3タグが大きすぎるか途中で切れています。');if(flags&(version===3?31:15))throw new Error('ID3ヘッダーに未対応のフラグがあります。');
 if(writing&&flags)throw new Error('特殊なID3ヘッダーを持つMP3は書き出せません。元ソフトで標準ID3に保存してください。');
 let body=bytes.subarray(10,10+size),i=0;if(version===3&&(flags&128))body=unsync(body);
 if(flags&64){if(body.length<4)throw new Error('ID3拡張ヘッダーが短すぎます。');i=version===3?4+view(body).getUint32(0):syncsafe(body);if(i>body.length||i<6)throw new Error('ID3拡張ヘッダーのサイズが不正です。');}
 const frames=[];
 while(i<body.length&&body[i]){if(i+10>body.length)throw new Error('ID3フレームのヘッダーが途中で切れています。');const id=ascii(body.subarray(i,i+4)),length=version===3?view(body).getUint32(i+4):syncsafe(body,i+4),frameFlags=view(body).getUint16(i+8);if(!/^[A-Z0-9]{4}$/.test(id)||!length||length>body.length-i-10)throw new Error('ID3フレームが不正です。');if(writing&&frameFlags)throw new Error('保護・圧縮などの特殊ID3フレームがあるため書き出しを中止しました。');let payload=body.subarray(i+10,i+10+length);const supported=version===3?!(frameFlags&255):!(frameFlags&252);if(version===4&&((frameFlags&2)||(flags&128)))payload=unsync(payload);if(version===4&&(frameFlags&1)){if(payload.length<4)throw new Error('ID3データ長がありません。');payload=payload.subarray(4);}frames.push({id,flags:frameFlags,body:payload,raw:body.slice(i,i+10+length),supported});i+=10+length;if(frames.length>4096)throw new Error('ID3フレーム数が上限を超えています。');}
 if(writing&&body.subarray(i).some(value=>value!==0))throw new Error('ID3の末尾に不明なデータがあるため書き出しを中止しました。');
 return {version,flags,end:10+size+((version===4&&flags&16)?10:0),frames};
}
function geob(frame){if(frame.id!=='GEOB'||!frame.supported)return null;const b=frame.body;if(b.length<4)return null;const mime=field(b,1),filename=field(b,mime.next,b[0]),description=field(b,filename.next,b[0]);return {description:description.value,data:b.subarray(description.next)};}
export function parseAudioMetadata(bytes){
 const tag=readID3(bytes),metadata={},warnings=[],objects=new Map();const textFields={TIT2:'name',TPE1:'artist',TALB:'album',TCON:'genre',TKEY:'key'};
 for(const frame of tag.frames){if(!frame.supported){warnings.push(`${frame.id}の圧縮・暗号化タグは読み込みません。`);continue;}try{if(textFields[frame.id]){const value=text(frame.body.subarray(1),frame.body[0]);if(value)metadata[textFields[frame.id]]=value;}else if(frame.id==='TBPM'){const bpm=Number(text(frame.body.subarray(1),frame.body[0]));if(bpm>=20&&bpm<=400){metadata.bpm=bpm;metadata.bpmConfidence=100;}}else if(frame.id==='COMM'&&frame.body.length>4){const f=field(frame.body,4,frame.body[0]);if(!f.value)metadata.comment=text(frame.body.subarray(f.next),frame.body[0]);}else if(frame.id==='GEOB'){const obj=geob(frame);if(obj)objects.set(obj.description,obj.data);}}catch(error){warnings.push(`${frame.id}: ${error.message}`);}}
 let modern;
 if(objects.has('Serato Markers2'))try{modern=parseMarkers2(objects.get('Serato Markers2'));Object.assign(metadata,{cues:modern.cues,cueDetails:modern.cueDetails,memoryCues:modern.memoryCues});}catch(error){warnings.push(error.message);}
 if(objects.has('Serato Markers_'))try{Object.assign(metadata,parseLegacyMarkers(objects.get('Serato Markers_'),modern));}catch(error){warnings.push(error.message);}
 if(objects.has('Serato BeatGrid'))try{const map=parseSeratoBeatgrid(objects.get('Serato BeatGrid'));if(map.length)Object.assign(metadata,{tempoMap:map,gridOffset:map[0].time,bpm:map[0].bpm,bpmConfidence:100});}catch(error){warnings.push(error.message);}
 return {metadata,warnings};
}
export async function readAudioMetadata(file){
 if(!/\.mp3$/i.test(file.name||''))return {metadata:{},warnings:[]};
 try{const header=new Uint8Array(await file.slice(0,10).arrayBuffer());if(header.length<10||ascii(header.subarray(0,3))!=='ID3')return {metadata:{},warnings:[]};const size=syncsafe(header,6);if(size>MAX_TAG_BYTES)throw new Error('ID3タグが16 MBを超えています。');return parseAudioMetadata(new Uint8Array(await file.slice(0,10+size).arrayBuffer()));}catch(error){return {metadata:{},warnings:[error.message]};}
}
function frame(id,body,version){const header=new Uint8Array(10);header.set(encoder.encode(id));if(version===4)putSyncsafe(header,4,body.length);else view(header).setUint32(4,body.length);return join([header,body]);}
function encodedText(value,version){const str=String(value??'').replace(/\0/g,'').slice(0,2000);if(version===4)return join([new Uint8Array([3]),encoder.encode(str)]);const out=new Uint8Array(3+str.length*2);out.set([1,255,254]);for(let i=0;i<str.length;i++)view(out).setUint16(3+i*2,str.charCodeAt(i),true);return out;}
function objectFrame(description,data,version){return frame('GEOB',join([new Uint8Array(1),encoder.encode('application/octet-stream\0\0'+description+'\0'),data]),version);}
export async function writeTaggedMP3(file,track){
 if(!/\.mp3$/i.test(track.filename||file.name||''))throw new Error('タグ付きコピーはMP3のみ対応しています。');
 const header=new Uint8Array(await file.slice(0,10).arrayBuffer()),size=header.length===10&&ascii(header.subarray(0,3))==='ID3'?syncsafe(header,6):0;if(size>MAX_TAG_BYTES)throw new Error('ID3タグが16 MBを超えています。');const tag=readID3(new Uint8Array(await file.slice(0,10+size).arrayBuffer()),{writing:true});
 if(file.size<=tag.end)throw new Error('MP3の音声データがありません。');const start=new Uint8Array(await file.slice(tag.end,tag.end+4).arrayBuffer());if(start[0]!==255||(start[1]&224)!==224)throw new Error('MP3音声の先頭を確認できません。書き出しを中止しました。');
 const replace=new Set(['TIT2','TPE1','TALB','TCON','TKEY','TBPM']),retained=[],objects=new Map();
 for(const f of tag.frames){const obj=geob(f);if(obj)objects.set(obj.description,obj.data);const emptyComment=f.id==='COMM'&&f.body.length>4&&!field(f.body,4,f.body[0]).value;if(replace.has(f.id)||emptyComment||obj&&['Serato Markers2','Serato Markers_','Serato BeatGrid'].includes(obj.description))continue;retained.push(f.raw);}
 const previous=objects.has('Serato Markers2')?parseMarkers2(objects.get('Serato Markers2')).entries:[];
 // Unknown Serato entries, artwork and all unrelated ID3 frames remain byte-identical.
 for(const [id,key]of Object.entries({TIT2:'name',TPE1:'artist',TALB:'album',TCON:'genre',TKEY:'key'}))if(track[key])retained.push(frame(id,encodedText(track[key],tag.version),tag.version));
 if(track.comment){const comment=encodedText(track.comment,tag.version),empty=tag.version===4?new Uint8Array(1):new Uint8Array([255,254,0,0]);retained.push(frame('COMM',join([comment.subarray(0,1),encoder.encode('eng'),empty,comment.subarray(1)]),tag.version));}
 retained.push(frame('TBPM',encodedText(Math.round(track.bpm||120),tag.version),tag.version));
 retained.push(objectFrame('Serato Markers2',writeMarkers2(track,previous),tag.version));
 retained.push(objectFrame('Serato Markers_',writeLegacyMarkers(track,objects.get('Serato Markers_')),tag.version));
 retained.push(objectFrame('Serato BeatGrid',writeSeratoBeatgrid(track),tag.version));
 const body=join([...retained,new Uint8Array(256)]);if(body.length>MAX_TAG_BYTES)throw new Error('書き出すID3タグが16 MBを超えています。');const out=new Uint8Array(10);out.set([73,68,51,tag.version,0,0]);putSyncsafe(out,6,body.length);return new Blob([out,body,file.slice(tag.end)],{type:'audio/mpeg'});
}
