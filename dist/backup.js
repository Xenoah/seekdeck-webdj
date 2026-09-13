import {normalizeSession,normalizeTrack} from './core.js';
import {commitBackup,getAudio} from './storage.js';

export const BACKUP_CHUNK_BYTES=4*1024*1024;
export const BACKUP_MANIFEST_LIMIT=64*1024*1024;
const MAGIC=new TextEncoder().encode('SEEKDECK-BACKUP1\n');
const HEADER_BYTES=MAGIC.length+4+32;
const MAX_TRACKS=20000,MAX_AUDIO_BYTES=128*1024*1024*1024;
const encode=value=>new TextEncoder().encode(JSON.stringify(value));
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const digest=async bytes=>new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
const checkSignal=signal=>{if(signal?.aborted)throw signal.reason||new DOMException('中止しました。','AbortError');};
const invalid=()=>new Error('バックアップが破損しているか、対応していない形式です。');
const validId=id=>typeof id==='string'&&id.length>0&&id.length<=200&&!/[\u0000-\u001f]/.test(id);

function cleanTrack(track){
  if(!validId(track?.id))throw invalid();
  // Waveforms are derived data and regenerated locally. Never restore executable/remote demo URLs.
  const {waveform,peaks,source,demo,missing,...metadata}=track;
  return normalizeTrack({...metadata,peaks:[],demo:false,missing:false});
}
function checkedSession(raw,ids){
  const session=normalizeSession(raw);
  if(session.decks.some(d=>d.trackId&&!ids.has(d.trackId))||session.sampler.some(p=>p&&!ids.has(p.trackId))||session.playlists.some(p=>p.tracks.some(id=>!ids.has(id))))throw new Error('バックアップ内の曲とセッションの参照が一致しません。');
  session.history=session.history.filter(h=>ids.has(h.trackId));
  if(!ids.has(session.selectedTrack))session.selectedTrack=null;
  return session;
}
async function hashBlob(blob,signal,onChunk){
  const hashes=[];
  for(let offset=0;offset<blob.size;offset+=BACKUP_CHUNK_BYTES){
    checkSignal(signal);const part=blob.slice(offset,offset+BACKUP_CHUNK_BYTES);
    hashes.push(hex(await digest(await part.arrayBuffer())));onChunk?.(part.size);
  }
  return hashes;
}
async function writeParts(parts,writable,signal){
  try{
    for(const part of parts){
      const blob=part instanceof Blob?part:new Blob([part]),reader=blob.stream().getReader();
      try{while(true){checkSignal(signal);const {done,value}=await reader.read();if(done)break;await writable.write(value);}}finally{reader.releaseLock();}
    }
    await writable.close();
  }catch(error){try{await writable.abort?.(error);}catch{}throw error;}
}

// resolveAudio must return local Blob objects. The caller may resolve its own bundled demo files.
// With a FileSystemWritableFileStream, export memory stays bounded by one 4 MiB hash chunk.
export async function exportBackup({tracks,session,resolveAudio=track=>getAudio(track.id),writable,signal,onProgress=()=>{}}){
  try{
  const rows=Array.from(tracks instanceof Map?tracks.values():tracks);
  if(rows.length>MAX_TRACKS)throw new Error('バックアップは20,000曲までです。');
  const ids=new Set(rows.map(t=>t?.id));if(ids.size!==rows.length)throw new Error('曲IDが重複しています。');
  const clean=rows.map(cleanTrack),state=checkedSession(session,ids),parts=[],audio=[];let bytes=0,processed=0;
  for(let index=0;index<rows.length;index++){
    checkSignal(signal);const blob=await resolveAudio(rows[index]);
    if(!(blob instanceof Blob)||blob.size===0)throw new Error(`音源が見つかりません：${rows[index].name}`);
    bytes+=blob.size;if(!Number.isSafeInteger(bytes)||bytes>MAX_AUDIO_BYTES)throw new Error('バックアップは音源合計128 GiBまでです。');
    const chunks=await hashBlob(blob,signal,size=>{processed+=size;onProgress({phase:'hash',track:index+1,tracks:rows.length,bytes:processed});});
    audio.push({id:rows[index].id,size:blob.size,type:blob.type,chunks});parts.push(blob);
    clean[index].size=blob.size;
  }
  const manifest=encode({format:'seekdeck-backup',version:1,chunkBytes:BACKUP_CHUNK_BYTES,createdAt:new Date().toISOString(),tracks:clean,session:state,audio});
  if(manifest.length>BACKUP_MANIFEST_LIMIT)throw new Error('バックアップの曲情報が64 MiBを超えています。');
  const header=new Uint8Array(HEADER_BYTES);header.set(MAGIC);new DataView(header.buffer).setUint32(MAGIC.length,manifest.length,true);header.set(await digest(manifest),MAGIC.length+4);
  checkSignal(signal);const all=[header,manifest,...parts];
  if(writable){await writeParts(all,writable,signal);return {tracks:rows.length,bytes:header.length+manifest.length+bytes};}
  return new Blob(all,{type:'application/x-seekdeck-backup'});
  }catch(error){try{await writable?.abort?.(error);}catch{}throw error;}
}

// Hash the full archive before opening any write transaction. Blob slices avoid audio decoding,
// base64 expansion, and one arrayBuffer of the full library.
export async function inspectBackup(file,{signal,onProgress=()=>{}}={}){
  checkSignal(signal);if(!(file instanceof Blob)||file.size<HEADER_BYTES)throw invalid();
  const header=new Uint8Array(await file.slice(0,HEADER_BYTES).arrayBuffer());
  if(!MAGIC.every((byte,index)=>header[index]===byte))throw invalid();
  const manifestBytes=new DataView(header.buffer).getUint32(MAGIC.length,true);
  if(manifestBytes>BACKUP_MANIFEST_LIMIT||manifestBytes<2||HEADER_BYTES+manifestBytes>file.size)throw invalid();
  const encoded=new Uint8Array(await file.slice(HEADER_BYTES,HEADER_BYTES+manifestBytes).arrayBuffer());
  if(hex(await digest(encoded))!==hex(header.subarray(MAGIC.length+4)))throw new Error('バックアップの曲情報の検証に失敗しました。');
  let raw;try{raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(encoded));}catch{throw invalid();}
  if(raw?.format!=='seekdeck-backup'||raw.version!==1||raw.chunkBytes!==BACKUP_CHUNK_BYTES||!Array.isArray(raw.tracks)||!Array.isArray(raw.audio)||raw.tracks.length>MAX_TRACKS||raw.tracks.length!==raw.audio.length)throw invalid();
  const tracks=raw.tracks.map(cleanTrack),ids=new Set(tracks.map(t=>t.id));if(ids.size!==tracks.length)throw invalid();
  const session=checkedSession(raw.session,ids),seen=new Set(),audio=[];let offset=HEADER_BYTES+manifestBytes,processed=0;
  // Validate all descriptors and exact file length before spending time hashing audio.
  for(const item of raw.audio){
    if(!validId(item?.id)||!ids.has(item.id)||seen.has(item.id)||!Number.isSafeInteger(item.size)||item.size<=0||typeof item.type!=='string'||item.type.length>200||!Array.isArray(item.chunks)||item.chunks.length!==Math.ceil(item.size/BACKUP_CHUNK_BYTES)||item.chunks.some(hash=>typeof hash!=='string'||!/^([a-f\d]{64})$/.test(hash)))throw invalid();
    seen.add(item.id);const end=offset+item.size;
    if(!Number.isSafeInteger(end)||end>file.size||end-(HEADER_BYTES+manifestBytes)>MAX_AUDIO_BYTES)throw invalid();
    audio.push({id:item.id,blob:file.slice(offset,end,item.type),hashes:item.chunks});offset=end;
  }
  if(offset!==file.size)throw invalid();
  for(let index=0;index<audio.length;index++){
    const item=audio[index],hashes=await hashBlob(item.blob,signal,size=>{processed+=size;onProgress({phase:'verify',track:index+1,tracks:tracks.length,bytes:processed});});
    if(hashes.some((hash,i)=>hash!==item.hashes[i]))throw new Error(`音源データの検証に失敗しました：${tracks.find(t=>t.id===item.id)?.name||item.id}`);
    delete item.hashes;
  }
  const sizes=new Map(audio.map(item=>[item.id,item.blob.size]));for(const track of tracks)track.size=sizes.get(track.id);
  checkSignal(signal);return {tracks,session,audio,createdAt:raw.createdAt,bytes:file.size};
}
export async function restoreBackup(file,options={}){
  const archive=await inspectBackup(file,options);checkSignal(options.signal);
  archive.session.savedAt=Date.now();
  await commitBackup(archive.tracks,archive.audio,archive.session);
  return archive;
}
