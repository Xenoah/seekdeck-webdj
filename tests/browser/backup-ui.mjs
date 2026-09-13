import assert from 'node:assert/strict';
import fs from 'node:fs';
import {waitForAsync} from './poll.mjs';

export async function runBackupUI(browser,url){
  const context=await browser.newContext({acceptDownloads:true,viewport:{width:844,height:390},isMobile:true,hasTouch:true}),page=await context.newPage(),errors=[];
  // Exercise the portable Blob download path; the low-level suite exercises writable streaming.
  await context.addInitScript(()=>{Object.defineProperty(window,'showSaveFilePicker',{value:undefined,configurable:true});});
  page.on('pageerror',error=>errors.push(error.message));
  try{
    await page.goto(url);await page.waitForSelector('[data-panel="deck0"]');
    await waitForAsync(page,async()=>{const {api}=await import(new URL('app.js',location.href));return Boolean(api.backupUI);});
    await page.touchscreen.tap(2,2);
    const started=await page.evaluate(async()=>{
      const {api}=await import(new URL('app.js',location.href));
      await api.startAudio();if(!api.s.decks[0].loop.enabled)api.loopDeck(0);await api.playDeck(0,true);
      const trackCount=api.tracks.size;await api.record();await api.backupUI.showRecordings();
      return {id:api.engine.recordingSession.id,trackCount,recording:api.engine.recording};
    });
    const id=started.id;assert.equal(started.recording,true);
    // Real active app recording: deletion and unfinished export must both be blocked.
    assert.equal(await page.locator(`[data-backup-action="record-delete-confirm"][data-recording-id="${id}"]`).isDisabled(),true);
    assert.equal(await page.locator(`[data-backup-action="record-download"][data-recording-id="${id}"]`).isDisabled(),true);
    await page.waitForTimeout(1250);
    const stopped=await page.evaluate(async()=>{
      const {api}=await import(new URL('app.js',location.href));await api.record();await api.playDeck(0,false);await api.backupUI.showRecordings();
      return {recording:api.engine.recording,trackCount:api.tracks.size};
    });
    assert.equal(stopped.recording,false);assert.equal(stopped.trackCount,started.trackCount,'Stopping must not decode and import the entire recording automatically');
    const savedRecording=page.waitForEvent('download');
    await page.locator(`[data-backup-action="record-download"][data-recording-id="${id}"]`).click();
    const recorded=await savedRecording;assert.match(recorded.suggestedFilename(),/\.webm$/);assert.ok(fs.statSync(await recorded.path()).size>0);
    await waitForAsync(page,async()=>{const {api}=await import(new URL('app.js',location.href));return !api.backupUI.busy;});
    const audio=await page.evaluate(async id=>{
      const {api}=await import(new URL('app.js',location.href)),{getRecordingBlob}=await import(new URL('recording.js',location.href));
      const decoded=await api.engine.context.decodeAudioData(await (await getRecordingBlob(id)).arrayBuffer()),pcm=decoded.getChannelData(0);let energy=0;for(const sample of pcm)energy+=sample*sample;
      return {duration:decoded.duration,rms:Math.sqrt(energy/pcm.length)};
    },id);
    assert.ok(audio.duration>.5);assert.ok(audio.rms>.001,'Recorded app master must contain audible demo signal');
    await page.locator(`[data-backup-action="record-delete-confirm"][data-recording-id="${id}"]`).click();
    await page.locator('[data-backup-action="record-delete"]').click();
    await waitForAsync(page,async id=>{const {getRecording}=await import(new URL('recording.js',location.href));return !(await getRecording(id));},id);
    await page.evaluate(async()=>{
      const {api}=await import(new URL('app.js',location.href)),{storeTrack}=await import(new URL('storage.js',location.href)),{normalizeTrack}=await import(new URL('core.js',location.href));
      const track=normalizeTrack({id:'backup-ui-track',name:'Backup UI original',duration:3,cues:[.5],filename:'test.webm',size:10});
      await storeTrack(track,new Blob(['test audio'],{type:'audio/webm'}));api.tracks.set(track.id,track);
      api.modal('バックアップのテスト',api.backupUI.settingsMarkup());
    });
    const downloadedBackup=page.waitForEvent('download');
    await page.locator('[data-backup-action="export"]').click();
    const download=await downloadedBackup;assert.match(download.suggestedFilename(),/\.seekdeck$/);const backupPath=await download.path();
    await waitForAsync(page,async()=>{const {api}=await import(new URL('app.js',location.href));return !api.backupUI.busy;});
    await page.evaluate(async()=>{const {api}=await import(new URL('app.js',location.href));await api.updateTrack({...api.tracks.get('backup-ui-track'),name:'Keep until confirmed'});});
    await page.locator('[data-backup-input]').setInputFiles(backupPath);
    await page.locator('[data-backup-action="restore"]').waitFor();
    await page.locator('[data-backup-action="cancel-preview"]').click();
    assert.equal(await page.evaluate(async()=>{const {api}=await import(new URL('app.js',location.href));return api.tracks.get('backup-ui-track').name;}),'Keep until confirmed');
    await page.locator('[data-backup-input]').setInputFiles(backupPath);
    await page.locator('[data-backup-action="restore"]').click();
    await waitForAsync(page,async()=>{const {api}=await import(new URL('app.js',location.href));return !api.backupUI.busy&&api.tracks.get('backup-ui-track')?.name==='Backup UI original';},{},{timeout:60000});
    assert.equal(await page.evaluate(async()=>{const {getAudio}=await import(new URL('storage.js',location.href));return (await getAudio('backup-ui-track')).text();}),'test audio');
    const corrupt=fs.readFileSync(backupPath);corrupt[corrupt.length-1]^=255;
    await page.locator('[data-backup-input]').setInputFiles({name:'corrupt.seekdeck',mimeType:'application/x-seekdeck-backup',buffer:corrupt});
    await page.locator('#backup-error').filter({hasText:'検証に失敗'}).waitFor();
    assert.equal(await page.evaluate(async()=>{const {api}=await import(new URL('app.js',location.href));return api.tracks.get('backup-ui-track').name;}),'Backup UI original');
    assert.deepEqual(errors,[]);
    console.log('Backup UI: recording download/delete protection, audio archive download, cancelled preview, confirmed restore and corrupt-file refusal passed.');
  }finally{await context.close();}
}
