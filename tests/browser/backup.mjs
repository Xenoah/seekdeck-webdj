import assert from 'node:assert/strict';

export async function runBackup(browser,url){
  const context=await browser.newContext(),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  try{
    await page.goto(url);await page.waitForSelector('[data-wave="0"]');
    await page.evaluate(async()=>{
      const storage=await import(new URL('storage.js',location.href));(await storage.database()).close();
      await new Promise((resolve,reject)=>{const request=indexedDB.deleteDatabase('orbit-dj-local');request.onsuccess=resolve;request.onerror=request.onblocked=()=>reject(new Error('Test database could not be reset'));});
      const legacy=await new Promise((resolve,reject)=>{
        const request=indexedDB.open('orbit-dj-local',1);
        request.onupgradeneeded=()=>{request.result.createObjectStore('tracks',{keyPath:'id'});request.result.createObjectStore('audio');request.result.createObjectStore('state');};
        request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
      });
      await new Promise((resolve,reject)=>{const tx=legacy.transaction(['tracks','audio'],'readwrite');tx.objectStore('tracks').put({id:'legacy-track',name:'既存音源',duration:1});tx.objectStore('audio').put(new Blob(['legacy audio']),'legacy-track');tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});
      legacy.close();
    });
    await page.reload();await page.waitForSelector('[data-wave="0"]');
    const migrated=await page.evaluate(async()=>{const storage=await import(new URL('storage.js',location.href));return {version:(await storage.database()).version,audio:await (await storage.getAudio('legacy-track')).text()};});
    assert.equal(migrated.version,2);assert.equal(migrated.audio,'legacy audio');
    const result=await page.evaluate(async()=>{
      const storage=await import(new URL('storage.js',location.href)),backup=await import(new URL('backup.js',location.href)),core=await import(new URL('core.js',location.href));
      const state=core.defaultSession();state.decks.forEach(d=>{d.trackId=null;});state.selectedTrack='backup-a';
      state.playlists=[{id:'backup-order',name:'復元確認',tracks:['backup-a','backup-a']}];
      const track={id:'backup-a',name:'音源付きバックアップ',duration:2,cues:[.4]},blob=new Blob(['original audio'],{type:'audio/webm'});
      const file=await backup.exportBackup({tracks:[track],session:state,resolveAudio:()=>blob});
      await storage.putState({...state,savedAt:1});await storage.storeTrack({...track,name:'before'},new Blob(['before']));
      const corrupt=new Blob([file.slice(0,-1),new Uint8Array([255])]);
      let corruptFailed=false;try{await backup.restoreBackup(corrupt);}catch{corruptFailed=true;}
      const afterCorrupt=(await storage.getTracks()).find(t=>t.id===track.id).name;
      let rollbackFailed=false;try{await storage.commitBackup([{...track,name:'must rollback'}],[{id:track.id,blob:()=>{}}],{...state,savedAt:2});}catch{rollbackFailed=true;}
      const afterRollback=(await storage.getTracks()).find(t=>t.id===track.id).name;
      const audioAfterRollback=await (await storage.getAudio(track.id)).text();
      const stateAfterRollback=(await storage.getState()).savedAt;
      await backup.restoreBackup(file);
      const restored=(await storage.getTracks()).find(t=>t.id===track.id),restoredAudio=await (await storage.getAudio(track.id)).text(),restoredState=await storage.getState();
      return {corruptFailed,afterCorrupt,rollbackFailed,afterRollback,audioAfterRollback,stateAfterRollback,restored,restoredAudio,restoredState};
    });
    assert.equal(result.corruptFailed,true);assert.equal(result.afterCorrupt,'before');
    assert.equal(result.rollbackFailed,true);assert.equal(result.afterRollback,'before');assert.equal(result.audioAfterRollback,'before');assert.equal(result.stateAfterRollback,1);
    assert.equal(result.restoredAudio,'original audio');assert.equal(result.restored.cues[0],.4);assert.equal(result.restored.name,'音源付きバックアップ');
    assert.deepEqual(result.restoredState.playlists[0].tracks,['backup-a','backup-a']);assert.ok(result.restoredState.decks.every(d=>!d.playing));
    const id=await page.evaluate(async()=>{
      const {RecordingJournal}=await import(new URL('recording.js',location.href));
      const journal=await RecordingJournal.create('audio/webm');
      await journal.append(new Blob(['saved chunk 1']));await journal.append(new Blob(['saved chunk 2']));
      return journal.meta.id;
    });
    // No finish: simulate an interrupted tab. Previously committed chunks must survive reload.
    await page.reload();await page.waitForSelector('[data-wave="0"]');
    const recovered=await page.evaluate(async id=>{
      const recording=await import(new URL('recording.js',location.href));
      const meta=(await recording.listRecordings()).find(row=>row.id===id),blob=await recording.getRecordingBlob(id);
      const writes=[];let closed=false;await recording.writeRecording(id,{async write(value){writes.push(value);},async close(){closed=true;}});
      return {meta,text:await blob.text(),streamText:await new Blob(writes).text(),closed};
    },id);
    assert.equal(recovered.meta.status,'recording');assert.equal(recovered.meta.chunks,2);assert.equal(recovered.text,'saved chunk 1saved chunk 2');assert.equal(recovered.streamText,recovered.text);assert.equal(recovered.closed,true);
    await page.locator('body').click({position:{x:2,y:2}});
    await page.evaluate(async()=>{
      const {startPersistentRecording}=await import(new URL('recording.js',location.href));
      const audio=new AudioContext();await audio.resume();const oscillator=audio.createOscillator(),destination=audio.createMediaStreamDestination();oscillator.connect(destination);oscillator.start();
      window.testRecorded={audio,oscillator,session:await startPersistentRecording(destination.stream)};
    });
    await page.waitForTimeout(1250);
    const real=await page.evaluate(async()=>{
      const recording=await import(new URL('recording.js',location.href)),{audio,oscillator,session}=window.testRecorded;
      const meta=await session.stop(),blob=await recording.getRecordingBlob(meta.id),decoded=await audio.decodeAudioData(await blob.arrayBuffer());oscillator.stop();await audio.close();
      await recording.deleteRecording(meta.id);return {meta,duration:decoded.duration,deleted:!(await recording.getRecording(meta.id))};
    });
    assert.equal(real.meta.status,'complete');assert.ok(real.meta.chunks>=1);assert.ok(real.meta.bytes>0);assert.ok(real.duration>.5);assert.equal(real.deleted,true);
    assert.deepEqual(errors,[]);
    console.log('Backup/recording: v1 database migration, binary audio roundtrip, checksum rejection, atomic rollback, interrupted-tab recovery, bounded journal writes and real MediaRecorder export passed.');
  }finally{await context.close();}
}
