import assert from 'node:assert/strict';
import {waitForAsync} from './poll.mjs';

// Bounded browser integration, not an actual Android/iPhone device qualification.
export async function runStability(browser,url){
 const context=await browser.newContext({viewport:{width:844,height:390},isMobile:true,hasTouch:true}),page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.goto(url);await page.waitForSelector('[data-panel="deck0"]');
  const module=new URL('app.js',url).pathname;
  await waitForAsync(page,async module=>!!(await import(module)).api.runtime,module);
  await page.locator('#audio-start').click();
  await page.evaluate(async module=>{const {api}=await import(module);api.loopDeck(0);api.loopDeck(1);await api.playDeck(0,true);await api.playDeck(1,true);},module);
  await waitForAsync(page,async module=>{const {api}=await import(module);return api.engine.playing[0]&&api.engine.playing[1]&&api.position(0)>.2&&api.position(1)>.2;},module);
  // Repeated suspend/resume and rotations exercise real AudioWorklet message ordering.
  for(let cycle=0;cycle<4;cycle++){
   await page.evaluate(async module=>{const {api}=await import(module);await api.engine.context.suspend();},module);
   await waitForAsync(page,async module=>{const {api}=await import(module);return api.runtime.needsResume&&!api.s.decks.some(d=>d.playing);},module);
   const held=await page.evaluate(async module=>{const {api}=await import(module);return api.s.decks.map(d=>d.position);},module);
   // The OS can resume the context; that must not restart held decks by itself.
   await page.evaluate(async module=>{const {api}=await import(module);await api.engine.context.resume();},module);
   await page.waitForTimeout(100);
   assert.equal(await page.evaluate(async module=>(await import(module)).api.s.decks.some(d=>d.playing),module),false);
   await page.setViewportSize(cycle%2?{width:844,height:390}:{width:390,height:844});
   await page.locator('#audio-start').click();
   await waitForAsync(page,async module=>{const {api}=await import(module);return !api.runtime.needsResume&&api.engine.playing[0]&&api.engine.playing[1]&&api.engine.context.state==='running';},module);
   assert(held[0]>=0&&held[1]>=0);
  }
  // Stopping an interrupted deck explicitly must not be undone by Resume All.
  await page.evaluate(async module=>{const {api}=await import(module);await api.engine.context.suspend();},module);
  await waitForAsync(page,async module=>(await import(module)).api.runtime.needsResume,module);
  await page.evaluate(async module=>{const {api}=await import(module);await api.playDeck(0,false);},module);
  await page.locator('#audio-start').click();
  await waitForAsync(page,async module=>{const {api}=await import(module);return !api.runtime.needsResume&&api.engine.playing[1];},module);
  assert.equal(await page.evaluate(async module=>(await import(module)).api.s.decks[0].playing,module),false);
  await page.evaluate(async module=>{const {api}=await import(module);await api.playDeck(1,false);},module);
  await page.locator('[data-action="settings"]').first().click();
  await page.locator('[data-runtime-awake]').check();
  const downloadEvent=page.waitForEvent('download');
  await page.locator('[data-runtime-action="diagnostics"]').click();
  const download=await downloadEvent,stream=await download.createReadStream(),chunks=[];for await(const chunk of stream)chunks.push(chunk);
  const report=JSON.parse(Buffer.concat(chunks).toString());assert.equal(report.format,'seekdeck-runtime-diagnostics');assert.equal(report.audio.physicalLatencyMeasured,false);assert.equal(report.audio.physicalInputToSoundLatencyMs,null);assert.equal(report.screenWakeLock.requested,true);assert(report.recentEvents.length<=100);
  await page.waitForTimeout(900);await page.reload();await page.waitForSelector('[data-panel="deck0"]');
  await waitForAsync(page,async module=>!!(await import(module)).api.runtime,module);
  const restored=await page.evaluate(async module=>{const {api}=await import(module);return {awake:api.s.runtime.keepAwake,playing:api.s.decks.some(d=>d.playing),pending:api.runtime.needsResume};},module);
  assert.deepEqual(restored,{awake:true,playing:false,pending:false});assert.deepEqual(errors,[]);
  console.log('Stability: repeated real AudioContext interruption/resume, rotations, explicit stop, diagnostics export, and stopped reload passed. Physical device latency is not measured.');
 }finally{await context.close();}
}
