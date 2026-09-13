import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultSession} from '../dist/core.js';
import {exportBackup,inspectBackup,BACKUP_CHUNK_BYTES} from '../dist/backup.js';
import {RecordingJournal} from '../dist/recording.js';

function fixture(){
  const session=defaultSession();session.decks.forEach(d=>{d.trackId=null;});
  session.decks[0].trackId='track-a';session.decks[0].playing=true;
  session.playlists=[{id:'ordered',name:'夜のミックス',tracks:['track-a','track-b','track-a']}];
  session.sampler[0]={trackId:'track-b',label:'loop',start:.1,duration:1,gain:.8,loop:true};
  const tracks=[{id:'track-a',name:'音源 A 🎶',duration:10,cues:[1],demo:true,source:'https://must-never-be-restored.invalid/audio.wav',waveform:{version:1},peaks:[255]},{id:'track-b',name:'B',duration:20,cues:[2]}];
  const audio=new Map([['track-a',new Blob(['first audio'],{type:'audio/webm'})],['track-b',new Blob(['second audio'],{type:'audio/ogg'})]]);
  return {session,tracks,audio};
}
test('binary archive retains audio bytes, cues and repeated playlist order, and restores stopped',async()=>{
  const f=fixture(),file=await exportBackup({...f,resolveAudio:track=>f.audio.get(track.id)}),result=await inspectBackup(file);
  assert.equal(await result.audio[0].blob.text(),'first audio');assert.equal(await result.audio[1].blob.text(),'second audio');
  assert.equal(result.tracks[0].name,'音源 A 🎶');assert.equal(result.tracks[0].cues[0],1);
  assert.deepEqual(result.session.playlists[0].tracks,['track-a','track-b','track-a']);
  assert.equal(result.session.sampler[0].trackId,'track-b');assert.equal(result.session.decks[0].playing,false);
  assert.equal(result.tracks[0].demo,false);assert.equal(result.tracks[0].source,undefined);assert.deepEqual(result.tracks[0].peaks,[]);
});
test('archive rejects corrupt payload/metadata, truncation, trailing bytes and missing audio',async()=>{
  const f=fixture(),file=await exportBackup({...f,resolveAudio:track=>f.audio.get(track.id)});
  await assert.rejects(inspectBackup(new Blob([file.slice(0,-1),new Uint8Array([255])])),/音源データ/);
  await assert.rejects(inspectBackup(file.slice(0,-1)),/破損/);
  await assert.rejects(inspectBackup(new Blob([file,'extra'])),/破損/);
  await assert.rejects(inspectBackup(new Blob([file.slice(0,52),new Uint8Array([255]),file.slice(53)])),/曲情報/);
  await assert.rejects(exportBackup({...f,resolveAudio:()=>undefined}),/見つかりません/);
  await assert.rejects(exportBackup({...f,tracks:[f.tracks[0],f.tracks[0]]}),/重複/);
});
test('large audio is hashed in bounded chunks and streaming output is the same archive format',async()=>{
  const f=fixture();f.audio.set('track-a',new Blob([new Uint8Array(BACKUP_CHUNK_BYTES*2+91)]));
  let largest=0;const original=Blob.prototype.arrayBuffer;
  Blob.prototype.arrayBuffer=function(){largest=Math.max(largest,this.size);return original.call(this);};
  try{
    const writes=[];let closed=false;
    const result=await exportBackup({...f,resolveAudio:track=>f.audio.get(track.id),writable:{async write(value){writes.push(value);},async close(){closed=true;}}});
    assert.equal(closed,true);assert.equal(result.tracks,2);
    const parsed=await inspectBackup(new Blob(writes));assert.equal(parsed.audio[0].blob.size,BACKUP_CHUNK_BYTES*2+91);
    assert.ok(largest<=BACKUP_CHUNK_BYTES,`Unexpected unbounded read: ${largest}`);
  }finally{Blob.prototype.arrayBuffer=original;}
});
test('cancelled backup makes no writes and invalid session references are refused',async()=>{
  const f=fixture(),controller=new AbortController();controller.abort();let writes=0;
  await assert.rejects(exportBackup({...f,signal:controller.signal,resolveAudio:track=>f.audio.get(track.id),writable:{write(){writes++;}}}),/abort/i);
  assert.equal(writes,0);f.session.decks[1].trackId='not-present';
  await assert.rejects(exportBackup({...f,resolveAudio:track=>f.audio.get(track.id)}),/参照/);
});

function memoryStore(){
  const chunks=[],metas=[];
  return {chunks,metas,async create(meta){metas.push(structuredClone(meta));},async append(meta,index,blob){chunks.push({index,blob});metas.push(structuredClone(meta));},async update(meta){metas.push(structuredClone(meta));}};
}
test('recording journal persists chunks in order and releases the pending-memory count',async()=>{
  const store=memoryStore(),journal=await RecordingJournal.create('audio/webm',{store,maxPendingBytes:100});
  const writes=[journal.append(new Blob(['one'])),journal.append(new Blob(['two']))];
  assert.equal(journal.pendingBytes,6);await Promise.all(writes);
  assert.equal(journal.pendingBytes,0);const meta=await journal.finish();
  assert.equal(meta.chunks,2);assert.equal(meta.bytes,6);assert.equal(meta.status,'complete');
  assert.deepEqual(store.chunks.map(c=>c.index),[0,1]);
  assert.deepEqual(await Promise.all(store.chunks.map(c=>c.blob.text())),['one','two']);
  assert.deepEqual(await journal.finish(),meta);
});
test('slow storage stops at the queue limit while retaining every already accepted chunk',async()=>{
  const store=memoryStore();let release;const gate=new Promise(resolve=>{release=resolve;}),append=store.append;
  store.append=async(...args)=>{await gate;return append(...args);};let errors=0;
  const journal=await RecordingJournal.create('audio/webm',{store,maxPendingBytes:6,onError(){errors++;}});
  const first=journal.append(new Blob(['1234']));
  await assert.rejects(journal.append(new Blob(['567'])),/追いつかない/);
  assert.equal(journal.pendingBytes,4);assert.equal(errors,1);release();await first;
  const meta=await journal.finish();assert.equal(meta.status,'interrupted');assert.equal(meta.bytes,4);assert.equal(store.chunks.length,1);
});
test('quota failure preserves only atomically committed recording chunks and stops later writes',async()=>{
  const store=memoryStore(),append=store.append;
  store.append=async(meta,index,blob)=>{if(index===1)throw new DOMException('full','QuotaExceededError');return append(meta,index,blob);};
  const journal=await RecordingJournal.create('audio/ogg',{store});
  await journal.append(new Blob(['committed']));
  await assert.rejects(journal.append(new Blob(['failed'])),/full/);
  await assert.rejects(journal.append(new Blob(['later'])),/full/);
  const meta=await journal.finish();assert.equal(meta.status,'interrupted');assert.equal(meta.bytes,9);assert.equal(meta.chunks,1);assert.equal(journal.pendingBytes,0);
});
