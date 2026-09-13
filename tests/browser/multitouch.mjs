import assert from 'node:assert/strict';
import {waitForAsync} from './poll.mjs';
export async function runMultitouch(browser,url){
 const context=await browser.newContext({viewport:{width:844,height:390},isMobile:true,hasTouch:true}),page=await context.newPage();
 try{
  await page.goto(url);await page.waitForSelector('.landscape-deck');
  for(const i of [0,1]){await page.locator(`[data-panel=deck${i}] [data-action=loop]`).tap();await page.locator(`[data-panel=deck${i}] [data-action=play]`).tap();}
  await waitForAsync(page,async()=>{const {api}=await import('/seekdeck-webdj/app.js');return [0,1].every(i=>api.s.decks[i].playing&&api.position(i)>.1);});
  await page.evaluate(async()=>{const {api}=await import('/seekdeck-webdj/app.js');window.gestureCalls=[];const original=api.engine.scratch.bind(api.engine);api.engine.scratch=(...args)=>{window.gestureCalls.push(args);return original(...args);};});
  const points=[];for(const i of [0,1]){const b=await page.locator(`[data-jog="${i}"]`).boundingBox();points.push({id:i+1,x:b.x+b.width/2,y:b.y+b.height/2});}
  const cdp=await context.newCDPSession(page);
  for(const reverse of [false,true]){
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:points});
   await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:points.map((p,i)=>({...p,x:p.x+(i?-15:15)}))});
   await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[points[reverse?0:1]]});
   await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   const states=await page.evaluate(()=>Object.fromEntries(window.gestureCalls.map(([i,on])=>[i,on])));assert.deepEqual(states,{'0':false,'1':false});
  }
  await cdp.detach();
  const before=await page.evaluate(async()=>{const {api}=await import('/seekdeck-webdj/app.js');return api.engine.context.currentTime;});
  await waitForAsync(page,async before=>{const {api}=await import('/seekdeck-webdj/app.js');return api.engine.context.currentTime>before+.2&&[0,1].every(i=>api.s.decks[i].playing);},before);
  console.log('Multitouch: two real touch pointers on both jogs, either release order, and continuing playback passed.');
 }finally{await context.close();}
}
