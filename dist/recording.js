import {database} from './storage.js';

export const RECORDING_PENDING_LIMIT=8*1024*1024;
const failure=()=>new Error('録音の端末保存に失敗しました。保存済みの部分は録音一覧から取り出せます。');

async function transaction(stores,mode,run){
  const db=await database();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(stores,mode);let result;
    tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(tx.error||failure());
    try{run(tx,value=>{result=value;});}catch(error){tx.abort();reject(error);}
  });
}
const repository={
  create:meta=>transaction(['recordings'],'readwrite',tx=>tx.objectStore('recordings').add(meta)),
  append:(meta,index,blob)=>transaction(['recordings','recordingChunks'],'readwrite',tx=>{
    tx.objectStore('recordingChunks').add({recordingId:meta.id,index,blob});
    tx.objectStore('recordings').put(meta);
  }),
  update:meta=>transaction(['recordings'],'readwrite',tx=>tx.objectStore('recordings').put(meta))
};

// Only encoded chunks waiting for IndexedDB count toward this limit. Never accumulate PCM.
// The repository adapter also lets tests model slow writes and quota failure deterministically.
export class RecordingJournal{
  constructor(meta,{store=repository,maxPendingBytes=RECORDING_PENDING_LIMIT,onError=()=>{}}={}){
    if(!Number.isSafeInteger(maxPendingBytes)||maxPendingBytes<1)throw new Error('Invalid recording queue limit');
    this.meta=meta;this.store=store;this.maxPendingBytes=maxPendingBytes;this.onError=onError;
    this.pendingBytes=0;this.nextIndex=0;this.tail=Promise.resolve();this.error=null;this.closed=false;
  }
  static async create(mimeType,options={}){
    const meta={id:crypto.randomUUID(),mimeType,startedAt:Date.now(),updatedAt:Date.now(),status:'recording',chunks:0,bytes:0};
    const journal=new RecordingJournal(meta,options);await journal.store.create(meta);return journal;
  }
  fail(error){
    if(!this.error){this.error=error instanceof Error?error:failure();try{this.onError(this.error);}catch{}}
    return this.error;
  }
  append(blob){
    if(this.closed)return Promise.reject(new Error('録音は終了しています。'));
    if(this.error)return Promise.reject(this.error);
    if(!(blob instanceof Blob))return Promise.reject(this.fail(new Error('不正な録音データです。')));
    if(!blob.size)return Promise.resolve();
    if(this.pendingBytes+blob.size>this.maxPendingBytes)return Promise.reject(this.fail(new Error('録音の保存が追いつかないため停止しました。保存済みの部分を録音一覧から取り出してください。')));
    const index=this.nextIndex++;this.pendingBytes+=blob.size;
    const write=this.tail.then(async()=>{
      const next={...this.meta,chunks:index+1,bytes:this.meta.bytes+blob.size,updatedAt:Date.now()};
      await this.store.append(next,index,blob);this.meta=next;
    }).catch(error=>{throw this.fail(error);}).finally(()=>{this.pendingBytes-=blob.size;});
    this.tail=write;
    // Prevent an unhandled rejection even when MediaRecorder cannot await its event handler.
    write.catch(()=>{});return write;
  }
  async finish(){
    if(this.finished)return this.finished;
    this.closed=true;
    this.finished=(async()=>{
      await this.tail.catch(()=>{});
      const next={...this.meta,status:this.error?'interrupted':'complete',endedAt:Date.now(),updatedAt:Date.now(),error:this.error?.message||''};
      try{await this.store.update(next);this.meta=next;}catch(error){this.fail(error);this.meta={...next,status:'interrupted',error:this.error.message};}
      return {...this.meta};
    })();return this.finished;
  }
}

export async function startPersistentRecording(stream,{onError=()=>{},...options}={}){
  if(!globalThis.MediaRecorder)throw new Error('このブラウザはミックス録音に対応していません。');
  const mimeType=['audio/webm;codecs=opus','audio/ogg;codecs=opus','audio/mp4'].find(type=>MediaRecorder.isTypeSupported(type));
  const recorder=new MediaRecorder(stream,mimeType?{mimeType,audioBitsPerSecond:256000}:undefined);
  let settled=false,stopping=false,resolveStop;
  const stopped=new Promise(resolve=>{resolveStop=resolve;});
  const journal=await RecordingJournal.create(recorder.mimeType,{...options,onError:error=>{
    try{onError(error);}finally{if(recorder.state!=='inactive'&&!stopping){stopping=true;recorder.stop();}}
  }});
  const complete=async()=>{if(settled)return;settled=true;resolveStop(await journal.finish());};
  recorder.ondataavailable=event=>{if(event.data.size)journal.append(event.data).catch(()=>{});};
  recorder.onerror=event=>journal.fail(event.error||failure());
  recorder.onstop=complete;
  try{recorder.start(1000);}catch(error){journal.fail(error);await complete();throw error;}
  return {
    id:journal.meta.id,startedAt:journal.meta.startedAt,mimeType:recorder.mimeType,
    get recording(){return recorder.state!=='inactive';},get pendingBytes(){return journal.pendingBytes;},
    get error(){return journal.error;},get stopped(){return stopped;},
    async stop(){if(recorder.state!=='inactive'&&!stopping){stopping=true;recorder.stop();}return stopped;}
  };
}

export const listRecordings=async()=>{
  const rows=await transaction(['recordings'],'readonly',(tx,done)=>{tx.objectStore('recordings').getAll().onsuccess=e=>done(e.target.result);});
  return rows.sort((a,b)=>b.startedAt-a.startedAt);
};
export const getRecording=id=>transaction(['recordings'],'readonly',(tx,done)=>{tx.objectStore('recordings').get(id).onsuccess=e=>done(e.target.result);});
const getChunk=(id,index)=>transaction(['recordingChunks'],'readonly',(tx,done)=>{tx.objectStore('recordingChunks').get([id,index]).onsuccess=e=>done(e.target.result?.blob);});
export async function* recordingChunks(id){
  const meta=await getRecording(id);if(!meta)throw new Error('録音が見つかりません。');let size=0;
  for(let index=0;index<meta.chunks;index++){
    const blob=await getChunk(id,index);if(!(blob instanceof Blob))throw new Error('録音の一部が見つかりません。');
    size+=blob.size;yield blob;
  }
  if(size!==meta.bytes)throw new Error('録音のサイズが一致しません。');
}
export async function getRecordingBlob(id){
  const meta=await getRecording(id);if(!meta)throw new Error('録音が見つかりません。');
  const parts=[];for await(const chunk of recordingChunks(id))parts.push(chunk);
  return new Blob(parts,{type:meta.mimeType});
}
export async function writeRecording(id,writable){
  let bytes=0;
  try{
    for await(const blob of recordingChunks(id)){
      const reader=blob.stream().getReader();
      try{while(true){const {done,value}=await reader.read();if(done)break;await writable.write(value);bytes+=value.byteLength;}}finally{reader.releaseLock();}
    }
    await writable.close();return {bytes};
  }catch(error){try{await writable.abort?.(error);}catch{}throw error;}
}
export const deleteRecording=id=>transaction(['recordings','recordingChunks'],'readwrite',tx=>{
  tx.objectStore('recordings').delete(id);
  tx.objectStore('recordingChunks').delete(IDBKeyRange.bound([id,0],[id,Number.MAX_SAFE_INTEGER]));
});
export function recordingFilename(meta){
  const ext=meta.mimeType?.includes('mp4')?'m4a':meta.mimeType?.includes('ogg')?'ogg':'webm';
  return `SeekDeck-Mix-${new Date(meta.startedAt).toISOString().replace(/[:.]/g,'-')}.${ext}`;
}
