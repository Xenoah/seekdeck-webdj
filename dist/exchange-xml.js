import {normalizePath,exportPath,fileURL,MAX_EXCHANGE_TRACKS} from './exchange-core.js';
const children=(node,tag)=>Array.from(node?.children||[]).filter(n=>n.tagName===tag);
const child=(node,tag)=>children(node,tag)[0];
const attr=(n,key)=>n?.getAttribute(key)??undefined;
const num=(n,key)=>n?.hasAttribute(key)?Number(n.getAttribute(key)):undefined;
function parseDocument(text,root){if(/<!DOCTYPE|<!ENTITY/i.test(text))throw new Error('DOCTYPE・ENTITYを含むXMLには対応していません。');const doc=new DOMParser().parseFromString(text,'application/xml');if(doc.querySelector('parsererror')||doc.documentElement.tagName!==root)throw new Error(`${root}形式のXMLではありません。`);return doc;}
function bounded(tracks){if(tracks.length>MAX_EXCHANGE_TRACKS)throw new Error('XML/NMLは20,000曲以下にしてください。');const ids=new Set();for(const t of tracks){if(!t.id||ids.has(t.id))throw new Error('XML/NMLの曲IDが空または重複しています。');ids.add(t.id);}}
function color(n){const values=['Red','Green','Blue'].map(k=>num(n,k));return values.every(v=>Number.isInteger(v)&&v>=0&&v<=255)?'#'+values.map(v=>v.toString(16).padStart(2,'0')).join(''):undefined;}
export function parseRekordbox(text){
 const doc=parseDocument(text,'DJ_PLAYLISTS'),warnings=[],tracks=children(child(doc.documentElement,'COLLECTION'),'TRACK').map(n=>{
  const tempos=children(n,'TEMPO'),cues=Array(8).fill(null),cueDetails=Array(8).fill(null),memoryCues=[];
  if(tempos.length>1)warnings.push(`${attr(n,'Name')||'曲'}：複数テンポの最初の位置だけ使用します。`);
  for(const mark of children(n,'POSITION_MARK')){const type=num(mark,'Type'),slot=num(mark,'Num'),start=num(mark,'Start');if(![0,4].includes(type)||!Number.isFinite(start)||start<0)continue;const detail={name:attr(mark,'Name')||'',type:type===4?'loop':'cue',start,end:type===4?num(mark,'End'):undefined,color:color(mark)};if(slot===-1)memoryCues.push(detail);else if(Number.isInteger(slot)&&slot>=0&&slot<8){cues[slot]=start;cueDetails[slot]=detail;}}
  return {id:attr(n,'TrackID'),path:attr(n,'Location')||'',name:attr(n,'Name'),artist:attr(n,'Artist'),album:attr(n,'Album'),genre:attr(n,'Genre'),comment:attr(n,'Comments'),key:attr(n,'Tonality'),bpm:num(n,'AverageBpm'),duration:num(n,'TotalTime'),rating:num(n,'Rating'),gridOffset:num(tempos[0],'Inizio'),cues,cueDetails,memoryCues};
 });bounded(tracks);
 const playlists=Array.from(doc.querySelectorAll('PLAYLISTS NODE[Type="1"]')).map(n=>({name:attr(n,'Name')||'Imported crate',tracks:children(n,'TRACK').map(t=>attr(t,'Key'))}));
 return {tracks,playlists,metadata:true,warnings};
}
const traktorDecode=p=>String(p||'').replace(/\/:/g,'/');
function nmlLocation(n){const volume=attr(n,'VOLUME')||'',dir=traktorDecode(attr(n,'DIR')),file=attr(n,'FILE')||'';return {path:normalizePath((volume&&!/^[a-z]:$/i.test(volume)?'/Volumes/':'')+volume+dir+file),key:volume+(attr(n,'DIR')||'')+file};}
export function parseNML(text){
 const doc=parseDocument(text,'NML'),warnings=[],keys=new Map(),tracks=children(child(doc.documentElement,'COLLECTION'),'ENTRY').map((n,i)=>{
  const loc=nmlLocation(child(n,'LOCATION')),info=child(n,'INFO'),tempo=child(n,'TEMPO'),album=child(n,'ALBUM'),cues=Array(8).fill(null),cueDetails=Array(8).fill(null),memoryCues=[];let gridOffset,gridCount=0;
  for(const mark of children(n,'CUE_V2')){const type=num(mark,'TYPE'),slot=num(mark,'HOTCUE'),start=num(mark,'START')/1000;if(!Number.isFinite(start)||start<0)continue;if(type===4){gridCount++;gridOffset??=start;}if(![0,4,5].includes(type))continue;const detail={name:attr(mark,'NAME')||'',type:type===5?'loop':'cue',start,end:type===5?start+num(mark,'LEN')/1000:undefined};if(Number.isInteger(slot)&&slot>=0&&slot<8){cues[slot]=start;cueDetails[slot]=detail;}else if(type!==4)memoryCues.push(detail);}
  if(gridCount>1)warnings.push(`${attr(n,'TITLE')||'曲'}：最初のビートグリッド位置だけ使用します。`);
  const id=String(i);keys.set(traktorDecode(loc.key),id);keys.set(loc.path,id);
  return {id,path:loc.path,name:attr(n,'TITLE'),artist:attr(n,'ARTIST'),album:attr(album,'TITLE'),genre:attr(info,'GENRE'),comment:attr(info,'COMMENT'),key:attr(info,'KEY'),bpm:num(tempo,'BPM'),duration:num(info,'PLAYTIME'),rating:info?.hasAttribute('RANKING')?num(info,'RANKING')/51:undefined,gridOffset,cues,cueDetails,memoryCues};
 });bounded(tracks);
 const playlists=Array.from(doc.querySelectorAll('PLAYLISTS NODE[TYPE="PLAYLIST"]')).map(n=>({name:attr(n,'NAME')||'Imported crate',tracks:children(child(n,'PLAYLIST'),'ENTRY').map(e=>{const key=child(e,'PRIMARYKEY');return keys.get(traktorDecode(attr(key,'KEY')));}).filter(v=>v!==undefined)}));
 return {tracks,playlists,metadata:true,warnings};
}
function documentBuilder(rootName,attrs){const doc=document.implementation.createDocument(null,rootName),root=doc.documentElement;const make=(parent,tag,values)=>{const el=doc.createElement(tag);for(const[k,v]of Object.entries(values))if(v!==undefined)el.setAttribute(k,String(v));parent.append(el);return el;};for(const[k,v]of Object.entries(attrs))root.setAttribute(k,v);return {doc,root,make,finish:()=>'<?xml version="1.0" encoding="UTF-8"?>\n'+new XMLSerializer().serializeToString(doc)};}
function cueList(t){return [...(t.cues||[]).flatMap((v,i)=>v==null?[]:[{...t.cueDetails?.[i],start:v,slot:i}]),...(t.memoryCues||[]).map(m=>({...m,slot:-1}))];}
export function writeRekordbox(tracks,playlists,options={}){
 const {root,make,finish}=documentBuilder('DJ_PLAYLISTS',{Version:'1.0.0'}),ids=new Map();make(root,'PRODUCT',{Name:'SeekDeck',Version:'0.5.0',Company:'SeekDeck'});const col=make(root,'COLLECTION',{Entries:tracks.length});
 tracks.forEach((t,i)=>{const path=exportPath(t,options);if(!/^(\/|[a-z]:\/)/i.test(path))throw new Error('XML/NMLには絶対パスが必要です。音源フォルダーを指定してください。');ids.set(t.id,i+1);const row=make(col,'TRACK',{TrackID:i+1,Name:t.name,Artist:t.artist||'',Album:t.album||'',Genre:t.genre||'',Comments:t.comment||'',AverageBpm:t.bpm,TotalTime:Math.ceil(t.duration),Tonality:t.key||'',Rating:t.rating||0,Location:fileURL(path)});make(row,'TEMPO',{Inizio:t.gridOffset||0,Bpm:t.bpm,Metro:'4/4',Battito:1});for(const m of cueList(t)){const loop=m.type==='loop'&&m.end>m.start,c=/^#[a-f\d]{6}$/i.test(m.color||'')?m.color.slice(1).match(/../g).map(v=>parseInt(v,16)):null;make(row,'POSITION_MARK',{Name:m.name|| (m.slot>=0?String.fromCharCode(65+m.slot):''),Type:loop?4:0,Start:m.start,End:loop?m.end:undefined,Num:m.slot,...(c?{Red:c[0],Green:c[1],Blue:c[2]}:{})});}});
 const ps=make(root,'PLAYLISTS',{}),folder=make(ps,'NODE',{Name:'ROOT',Type:0,Count:playlists.length});for(const p of playlists){const entries=p.tracks.map(id=>ids.get(id)).filter(Boolean),n=make(folder,'NODE',{Name:p.name,Type:1,KeyType:0,Entries:entries.length});entries.forEach(id=>make(n,'TRACK',{Key:id}));}return finish();
}
function encodeNMLPath(path,options){const p=normalizePath(path),parts=p.split('/'),file=parts.pop();let volume='',dir=parts.join('/')+'/';if(/^[a-z]:$/i.test(parts[0])){volume=parts.shift();dir=parts.join('/')+'/';}else if(p.startsWith('/Volumes/')){volume=parts[2];dir='/'+parts.slice(3).join('/')+'/';}else volume=options.volume||'Macintosh HD';dir=('/'+dir.replace(/^\/+/, '')).replace(/\/{2,}/g,'/').replace(/\//g,'/:');return {FILE:file,DIR:dir,VOLUME:volume,VOLUMEID:volume};}
export function writeNML(tracks,playlists,options={}){
 const {root,make,finish}=documentBuilder('NML',{VERSION:'19'}),keys=new Map();make(root,'HEAD',{COMPANY:'Native Instruments',PROGRAM:'Traktor'});const col=make(root,'COLLECTION',{ENTRIES:tracks.length});
 for(const t of tracks){const path=exportPath(t,options);if(!/^(\/|[a-z]:\/)/i.test(path))throw new Error('XML/NMLには絶対パスが必要です。音源フォルダーを指定してください。');const row=make(col,'ENTRY',{TITLE:t.name,ARTIST:t.artist||''}),loc=encodeNMLPath(path,options);make(row,'LOCATION',loc);keys.set(t.id,loc.VOLUME+loc.DIR+loc.FILE);make(row,'ALBUM',{TITLE:t.album||''});make(row,'INFO',{GENRE:t.genre||'',COMMENT:t.comment||'',KEY:t.key||'',PLAYTIME:Math.ceil(t.duration),RANKING:Math.round((t.rating||0)*51)});make(row,'TEMPO',{BPM:t.bpm,BPM_QUALITY:100});make(row,'CUE_V2',{NAME:'Grid',DISPL_ORDER:0,TYPE:4,START:(t.gridOffset||0)*1000,LEN:0,REPEATS:-1,HOTCUE:-1});for(const m of cueList(t)){const loop=m.type==='loop'&&m.end>m.start;make(row,'CUE_V2',{NAME:m.name||'',DISPL_ORDER:0,TYPE:loop?5:0,START:m.start*1000,LEN:loop?(m.end-m.start)*1000:0,REPEATS:-1,HOTCUE:m.slot});}}
 const ps=make(root,'PLAYLISTS',{}),folder=make(ps,'NODE',{TYPE:'FOLDER',NAME:'$ROOT'}),sub=make(folder,'SUBNODES',{COUNT:playlists.length});for(const p of playlists){const entries=p.tracks.map(id=>keys.get(id)).filter(Boolean),node=make(sub,'NODE',{TYPE:'PLAYLIST',NAME:p.name}),pl=make(node,'PLAYLIST',{ENTRIES:entries.length,TYPE:'LIST',UUID:crypto.randomUUID().replace(/-/g,'').toUpperCase()});for(const key of entries)make(make(pl,'ENTRY',{}),'PRIMARYKEY',{TYPE:'TRACK',KEY:key});}return finish();
}
