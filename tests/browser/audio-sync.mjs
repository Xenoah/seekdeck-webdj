import assert from 'node:assert/strict';
import {waitForAsync} from './poll.mjs';

export async function runAudioSync(browser,url){
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const button=(deck,action)=>page.locator(`[data-panel=deck${deck}] [data-action="${action}"]:visible`);
 const setGrid=async(deck,bpm,map)=>{await button(deck,'grid').click();await page.locator('#grid-bpm').fill(String(bpm));await page.locator('#grid-offset').fill('0');await page.locator('#grid-tempo-map').fill(JSON.stringify(map));await page.locator('[data-action=grid-save]').click();await page.waitForFunction(()=>!document.querySelector('#dialog').open);};
 const setRate=async(deck,value)=>{await page.locator(`[data-panel=deck${deck}] input[data-param=rate]:visible`).evaluate((input,value)=>{input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}));},value);};
 try{
  await page.goto(url);await page.waitForSelector('[data-panel=deck0]');
  await setGrid(0,120,[{time:2,bpm:132}]);await setGrid(1,100,[]);
  await button(0,'loop').click();await button(1,'loop').click();
  await button(0,'play').click();await button(1,'play').click();await button(1,'sync').click();
  assert.equal(await button(1,'sync').getAttribute('aria-pressed'),'true');
  await waitForAsync(page,async()=>{const {api}=await import('/seekdeck-webdj/app.js');return api.s.decks[1].syncEnabled&&api.engine.syncMasters[1]===0&&api.engine.positions[0]>2.1&&Math.abs(api.engine.rates[1]-1.32)<.01;},undefined,{timeout:12000});
  // Later master changes must propagate while SYNC stays pressed.
  await setRate(0,.9);
  await waitForAsync(page,async()=>{const {api}=await import('/seekdeck-webdj/app.js');return api.engine.positions[0]>2.1&&Math.abs(api.engine.rates[1]-1.188)<.015;},undefined,{timeout:12000});
  assert.equal(await button(1,'sync').getAttribute('aria-pressed'),'true');
  await setRate(1,1);
  assert.equal(await button(1,'sync').getAttribute('aria-pressed'),'false');
  await waitForAsync(page,async()=>{const {api}=await import('/seekdeck-webdj/app.js');return !api.s.decks[1].syncEnabled&&api.engine.syncMasters[1]===-1&&api.engine.rates[1]===1;});
  await button(1,'sync').click();await button(1,'select-deck').click();
  await waitForAsync(page,async()=>{const {api}=await import('/seekdeck-webdj/app.js');return api.s.selectedDeck===1&&!api.s.decks[1].syncEnabled;});
  await button(0,'sync').click();
  await waitForAsync(page,async()=>{const {api}=await import('/seekdeck-webdj/app.js');return api.engine.syncMasters[0]===1;});
  await page.evaluate(async()=>{const {api}=await import('/seekdeck-webdj/app.js');await api.playDeck(0,false);await api.playDeck(1,false);api.s.decks[1].loop.enabled=false;api.engine.applyDeck(1,api.s.decks[1],api.getTrack(1).bpm);});
  // Invalid editor content must leave saved metadata and the dialog intact.
  await button(1,'grid').click();await page.locator('#grid-tempo-map').fill('[{"time":-2,"bpm":0}]');await page.locator('[data-action=grid-save]').click();
  assert.equal(await page.locator('#dialog').evaluate(el=>el.open),true);
  assert.equal(await page.evaluate(async()=>{const {api}=await import('/seekdeck-webdj/app.js');return api.getTrack(1).tempoMap.length;}),0);
  await page.locator('#grid-bpm').fill('120');await page.locator('#grid-tempo-map').fill('[{"time":2,"bpm":90,"meter":3,"denominator":8}]');await page.locator('[data-action=grid-save]').click();
  await page.waitForFunction(()=>!document.querySelector('#dialog').open);
  await page.evaluate(async()=>{const {api}=await import('/seekdeck-webdj/app.js');api.seekDeck(1,1);api.s.decks[1].loopBeats=4;api.renderDeck(1);});
  await button(1,'loop').click();
  assert.ok(await page.evaluate(async()=>{const {api}=await import('/seekdeck-webdj/app.js');return Math.abs(api.s.decks[1].loop.end-(2+4/3))<1e-9;}));
  await button(1,'loop-half').click();
  assert.equal(await page.evaluate(async()=>{const {api}=await import('/seekdeck-webdj/app.js');return api.s.decks[1].loop.end;}),2);
  await page.waitForTimeout(950);await page.reload();await page.waitForSelector('[data-panel=deck0]');
  const restored=await page.evaluate(async()=>{const {api}=await import('/seekdeck-webdj/app.js');return {map:api.getTrack(1).tempoMap,loop:api.s.decks[1].loop,sync:api.s.decks[0].syncEnabled,master:api.s.selectedDeck,playing:api.s.decks.some(d=>d.playing)};});
  assert.equal(restored.map[1].bpm,90);assert.equal(restored.map[1].denominator,8);assert.equal(restored.loop.end,2);assert.equal(restored.sync,true);assert.equal(restored.master,1);assert.equal(restored.playing,false);
  assert.deepEqual(errors,[]);
  console.log('Audio sync: held SYNC follows variable BPM and later master rate, manual release, master switch, grid validation, variable-beat loop resize, and paused restoration passed.');
 }finally{await context.close();}
}
