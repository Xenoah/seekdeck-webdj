import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {waitForAsync} from './poll.mjs';

export async function runSamples(browser,url){
 const bytes=await fs.readFile('dist/demos/demo-0.wav'),sha256=createHash('sha256').update(bytes).digest('hex'),file='audio/browser-test.wav',id='sample-'+createHash('sha256').update(file+'\0'+sha256).digest('hex');
 const catalog={format:'seekdeck-samples',version:1,tracks:[{id,file,bytes:bytes.length,sha256,name:'Browser sample fixture',artist:'SeekDeck test'}]},context=await browser.newContext(),page=await context.newPage(),module=new URL('app.js',url).pathname,errors=[];let audioRequests=0;
 page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.route('**/samples/catalog.json',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(catalog)}));
  await page.route('**/samples/audio/browser-test.wav',route=>{audioRequests++;return route.fulfill({status:200,contentType:'audio/wav',body:bytes});});
  await page.goto(url);await page.waitForSelector('[data-panel="deck0"]');
  await waitForAsync(page,async({module,id})=>{const {api}=await import(module);return api.tracks.has(id);},{module,id});
  assert.equal(audioRequests,0,'Catalog discovery must not download sample audio');
  assert.equal(await page.evaluate(async({module,id})=>(await import(module)).api.engine.has(id),{module,id}),false,'Catalog discovery must not decode sample audio');
  await page.evaluate(async({module,id})=>{const {api}=await import(module);api.s.selectedTrack=id;api.renderRows();},{module,id});
  await page.locator('[data-action="track-edit"]').click();
  await page.locator('#track-name').fill('My sample title');await page.locator('#track-artist').fill('My artist');await page.locator('#track-bpm').fill('137');await page.locator('#track-key').fill('Dm');await page.locator('#track-comment').fill('Keep my edit before analysis');await page.locator('[data-action="save-track"]').click();
  await page.evaluate(async module=>{const {api}=await import(module);await api.refreshSamples();},module);assert.equal(audioRequests,0,'Editing and refreshing pending metadata must not download audio');
  await page.locator('#audio-start').click();
  await page.evaluate(async({module,id})=>{const {api}=await import(module);await api.loadDeck(0,id);api.loopDeck(0);await api.playDeck(0,true);},{module,id});
  await waitForAsync(page,async({module,id})=>{const {api}=await import(module),track=api.tracks.get(id);return track?.samplePending===false&&track.duration>1&&track.waveform?.version===1&&track.bpm>20&&api.engine.playing[0]&&api.position(0)>.2;},{module,id},{timeout:60000});
  assert.equal(audioRequests,1);
  assert.deepEqual(await page.evaluate(async({module,id})=>{const {api}=await import(module),t=api.tracks.get(id);return {name:t.name,artist:t.artist,bpm:t.bpm,key:t.key,comment:t.comment};},{module,id}),{name:'My sample title',artist:'My artist',bpm:137,key:'Dm',comment:'Keep my edit before analysis'});
  const stored=await page.evaluate(async({module,id})=>{const {api}=await import(module);await api.playDeck(0,false);const blob=await api.getAudio(id);return {bytes:blob?.size||0,duration:api.tracks.get(id).duration};},{module,id});assert.equal(stored.bytes,bytes.length);assert(stored.duration>1);
  await waitForAsync(page,async()=>{const registration=await navigator.serviceWorker.getRegistration();return registration?.active?.state==='activated'&&!!navigator.serviceWorker.controller;});
  await page.waitForTimeout(900);
  // Remove routes before offline mode: a route fulfillment could otherwise fake network success.
  await page.unroute('**/samples/catalog.json');await page.unroute('**/samples/audio/browser-test.wav');await context.setOffline(true);
  await page.reload();await page.waitForSelector('[data-panel="deck0"]');
  await waitForAsync(page,async({module,id})=>(await import(module)).api.tracks.has(id),{module,id});
  assert.equal(await page.evaluate(async module=>(await import(module)).api.s.decks.some(d=>d.playing),module),false);
  await page.locator('#audio-start').click();
  await page.evaluate(async({module,id})=>{const {api}=await import(module);await api.loadDeck(0,id);api.loopDeck(0);await api.playDeck(0,true);},{module,id});
  await waitForAsync(page,async module=>{const {api}=await import(module);return api.engine.playing[0]&&api.position(0)>.2;},module);
  assert.equal(audioRequests,1,'Offline playback must use the persisted local audio');assert.deepEqual(errors,[]);
  console.log('Samples: catalog-only lazy discovery, verified audio load/analysis, local persistence and offline playback passed. GitHub upload automation was not exercised by this browser test.');
 }finally{await context.close();}
}
