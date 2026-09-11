import assert from 'node:assert/strict';
import {waitForAsync} from './poll.mjs';

export async function runLandscape(browser,url){
 const context=await browser.newContext({viewport:{width:844,height:390},isMobile:true,hasTouch:true,deviceScaleFactor:1}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const app=fn=>page.evaluate(async source=>{const {api}=await import('/seekdeck-webdj/app.js');return new Function('api','return ('+source+')(api)')(api);},fn.toString());
 const tap=selector=>page.locator(selector).tap();
 const geometry=async()=>{
  const result=await page.evaluate(()=>{
   const box=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom};};
   return {w:innerWidth,h:innerHeight,scroll:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,left:box('[data-side=left]:not([hidden])'),right:box('[data-side=right]:not([hidden])'),mixer:box('[data-panel=mixer]'),controls:[...document.querySelectorAll('.panel:not([hidden]) .touch-transport button,#crossfader')].map(el=>{const r=el.getBoundingClientRect();return {label:el.getAttribute('aria-label')||el.textContent,x:r.x,y:r.y,w:r.width,h:r.height,bottom:r.bottom};})};
  });
  assert.ok(result.scroll<=result.w+1,JSON.stringify(result));assert.ok(result.scrollHeight<=result.h+1,JSON.stringify(result));
  assert.ok(result.left.right<=result.mixer.x&&result.mixer.right<=result.right.x,JSON.stringify(result));
  for(const p of [result.left,result.right,result.mixer])assert.ok(p.y>=47&&p.bottom<=result.h&&p.h>200,JSON.stringify(result));
  assert.equal(result.controls.length,7);
  for(const b of result.controls)assert.ok(b.w>=44&&b.h>=44&&b.x>=0&&b.y>=0&&b.bottom<=result.h,JSON.stringify(b));
  for(const el of await page.locator('.mobile-nav button,.mobile-decks button').all()){const b=await el.boundingBox();assert.ok(b.width>=40);assert.ok(b.height>=44);}
 };
 const slide=async(selector,from,to,vertical=false)=>{
  const el=page.locator(selector);await el.scrollIntoViewIfNeeded();const b=await el.boundingBox(),cdp=await context.newCDPSession(page);
  const point=f=>({x:b.x+b.width*(vertical?.5:f),y:b.y+b.height*(vertical?f:.5)});
  try{await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point(from)]});for(let i=1;i<=6;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[point(from+(to-from)*i/6)]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}finally{await cdp.detach();}
 };
 try{
  await page.goto(url);await page.waitForSelector('body[data-orientation=landscape] .landscape-deck');
  for(const [width,height]of [[568,320],[667,375],[740,320],[844,390],[932,430]]){
   await page.setViewportSize({width,height});await geometry();
   const circle=await page.locator('[data-jog="0"]').boundingBox();assert.ok(Math.abs(circle.width-circle.height)<2&&circle.width>=60,JSON.stringify(circle));
  }
  await page.setViewportSize({width:844,height:390});
  await page.waitForFunction(()=>document.querySelector('[data-overview="0"]').width>300);
  await page.screenshot({path:'test-results/mobile-landscape-performance.png'});
  // A compact, demo-only preview is available to text-only CI clients as well as the artifact.
  if(process.env.GITHUB_ACTIONS)console.log('SEEKDECK_LANDSCAPE_PREVIEW='+(await page.screenshot({type:'jpeg',quality:55})).toString('base64'));
  const layout=await app(a=>a.s.layout);
  for(const i of [0,1]){await tap(`[data-panel=deck${i}] [data-action=loop]`);await tap(`[data-panel=deck${i}] [data-action=play]`);}
  await waitForAsync(page,async()=>{const {api}=await import('/seekdeck-webdj/app.js');return [0,1].every(i=>api.s.decks[i].playing&&api.position(i)>.2);});
  await slide('#crossfader',.5,.8);assert.ok(await app(a=>a.s.mixer.crossfader)>.4);
  await slide('[data-channel="0"] .channel-fader',.8,.15,true);assert.ok(await app(a=>a.s.decks[0].volume)>.7);
  await tap('button[data-mobile-surface=pads][data-deck="0"]');
  await tap('[data-panel=deck0] [data-pad="7"]');
  await waitForAsync(page,async()=>{const {api}=await import('/seekdeck-webdj/app.js');return api.getTrack(0).cues[7]!=null;});
  await tap('[data-panel=deck0] .cue-delete');await tap('[data-panel=deck0] [data-pad="7"]');
  await waitForAsync(page,async()=>{const {api}=await import('/seekdeck-webdj/app.js');return api.getTrack(0).cues[7]==null;});
  await tap('button[data-mobile-surface=tools][data-deck="1"]');
  await page.locator('[data-panel=deck1] [data-param="fx.type"]').selectOption('flanger');
  assert.equal(await app(a=>a.s.decks[1].fx.type),'flanger');await geometry();
  await tap('button[data-mobile-view=mixer]');
  await page.locator('[data-channel="1"] [data-param=assign]').selectOption('THRU');assert.equal(await app(a=>a.s.decks[1].assign),'THRU');
  await page.locator('[data-channel="1"] [data-param=assign]').selectOption('B');
  const lowBefore=await app(a=>a.s.decks[0].low);await slide('[data-channel="0"] [data-param=low]',.5,.2);
  const lowAfter=await app(a=>a.s.decks[0].low);assert.ok(lowAfter<lowBefore-1,JSON.stringify({lowBefore,lowAfter}));await geometry();
  await tap('button[data-mobile-view=deck]');
  await tap('[data-panel=deck1] [data-action=play]');
  await waitForAsync(page,async()=>{const {api}=await import('/seekdeck-webdj/app.js');return !api.s.decks[1].playing;});
  await tap('[data-panel=deck1] [data-action=browse-deck]');
  assert.equal(await page.locator('button[data-mobile-deck="1"]').getAttribute('aria-pressed'),'true');
  await tap('[data-track="demo-2"] .mobile-load');await page.waitForSelector('body[data-mobile-view=deck]');
  assert.equal(await app(a=>a.s.decks[1].trackId),'demo-2');assert.equal(await app(a=>a.s.selectedDeck),0);
  await tap('button[data-mobile-deck="3"]');
  assert.equal(await page.locator('[data-panel=deck2]').isVisible(),true);assert.equal(await page.locator('[data-panel=deck3]').isVisible(),true);await geometry();
  await tap('button[data-mobile-view=sampler]');await page.screenshot({path:'test-results/mobile-landscape-sampler.png'});
  await tap('button[data-mobile-deck="0"]');await tap('button[data-mobile-view=deck]');
  await page.setViewportSize({width:390,height:844});await page.waitForSelector('body[data-orientation=portrait]');
  assert.equal(await page.locator('.rotate-hint').isVisible(),true);assert.equal(await page.locator('.panel:visible').count(),2);
  await page.setViewportSize({width:844,height:390});await page.waitForSelector('body[data-orientation=landscape]');await geometry();
  assert.equal(await app(a=>a.s.decks[0].playing),true,'Rotation or navigation stopped playback');assert.deepEqual(await app(a=>a.s.layout),layout);
  await page.waitForTimeout(900);const saved=await app(a=>({mobile:a.s.mobile,mixer:a.s.mixer,low:a.s.decks[0].low}));
  await page.reload();await page.waitForSelector('body[data-orientation=landscape]');
  assert.deepEqual(await app(a=>({mobile:a.s.mobile,mixer:a.s.mixer,low:a.s.decks[0].low})),saved);
  assert.equal(await app(a=>a.s.decks.some(d=>d.playing)),false);assert.deepEqual(await app(a=>a.s.layout),layout);
  await page.setViewportSize({width:1440,height:1000});await page.waitForSelector('body[data-ui=desktop]');assert.equal(await page.locator('.landscape-deck').count(),0);
  assert.deepEqual(errors,[]);console.log('Landscape: 568–932 px, both decks and mixer in view, real touch faders/EQ, pads, FX, targeted loading, bank switching, portrait rotation, playback continuity and restoration passed.');
 }catch(e){
  await page.screenshot({path:'test-results/mobile-landscape-failure.png'});
  if(process.env.GITHUB_ACTIONS)console.log('SEEKDECK_LANDSCAPE_FAILURE='+(await page.screenshot({type:'jpeg',quality:55})).toString('base64'));
  throw e;
 }finally{await context.close();}
}
