import {waitForAsync} from './poll.mjs';
import assert from 'node:assert/strict';
export async function runMobile(browser,url){
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(url);await page.waitForSelector('body[data-ui=mobile]');
  const overflow=async()=>assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Mobile viewport overflows horizontally');
  await overflow();
  assert.equal(await page.locator('.panel:visible').count(),2);
  for(const el of await page.locator('.mobile-nav button,.mobile-decks button').all()){const box=await el.boundingBox();assert.ok(box.height>=44&&box.width>=44);}
  await page.locator('[data-mobile-deck="3"]').tap();
  assert.equal(await page.locator('[data-panel=deck3]').isVisible(),true);
  await page.locator('[data-mobile-view=library]').tap();
  await overflow();
  await page.locator('[data-track="demo-1"] .mobile-load').tap();
  await page.waitForSelector('body[data-mobile-view=deck]');
  assert.equal(await page.evaluate(async()=>{const {api}=await import('/seekdeck-webdj/app.js');return api.s.decks[3].trackId;}),'demo-1');
  await page.locator('[data-panel=deck3] [data-action=loop]').tap();
  await page.locator('[data-panel=deck3] [data-action=play]').tap();
  await page.locator('[data-mobile-view=mixer]').tap();
  assert.equal(await page.locator('[data-channel="3"]').isVisible(),true);
  await page.locator('#crossfader').evaluate(el=>{el.value='.4';el.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.locator('[data-mobile-view=sampler]').tap();
  await overflow();
  await page.locator('[data-action=sample-edit]').tap();await page.locator('[data-sample="0"]').tap();
  assert.equal(await page.locator('#dialog').isVisible(),true);
  await page.locator('[data-action=close-dialog]').tap();
  assert.equal(await page.evaluate(async()=>{const {api}=await import('/seekdeck-webdj/app.js');return api.s.decks[3].playing;}),true,'Tab navigation stopped audio');
  await page.locator('[data-mobile-view=deck]').tap();
  await page.locator('[data-panel=deck3] [data-action=play]').tap();
  await page.locator('[data-panel=deck3] [data-action=cue-delete]').tap();
  await page.locator('[data-panel=deck3] [data-pad="0"]').tap();
  await waitForAsync(page,async()=>{const {api}=await import('/seekdeck-webdj/app.js');return api.getTrack(3).cues[0]===null;});
  await page.setViewportSize({width:360,height:780});await overflow();
  await page.screenshot({path:'test-results/mobile-deck.png',fullPage:true});
  await page.setViewportSize({width:844,height:390});await overflow();
  assert.equal(await page.locator('body').getAttribute('data-ui'),'mobile');
  await page.locator('[data-mobile-view=library]').tap();await overflow();
  await page.screenshot({path:'test-results/mobile-library-landscape.png',fullPage:true});
  await page.waitForTimeout(950);await page.reload();await page.waitForSelector('body[data-mobile-view=library]');
  const restored=await page.evaluate(async()=>{const {api}=await import('/seekdeck-webdj/app.js');return {deck:api.s.mobile.deck,crossfader:api.s.mixer.crossfader,playing:api.s.decks.some(d=>d.playing),master:api.s.selectedDeck};});
  assert.deepEqual(restored,{deck:3,crossfader:.4,playing:false,master:0});
  await page.setViewportSize({width:1440,height:1000});await page.waitForSelector('body[data-ui=desktop]');
  assert.equal(await page.locator('[data-panel=deck0]').isVisible(),true);assert.equal(await page.locator('[data-panel=deck3]').isVisible(),false);
  assert.deepEqual(errors,[]);console.log('Mobile: 360/390 px, landscape, touch loading, transport continuity, C/D mixing, cue deletion, state, desktop layout passed.');
 }finally{await context.close();}
}
