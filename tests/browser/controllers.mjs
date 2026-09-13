import assert from 'node:assert/strict';
import {waitForAsync} from './poll.mjs';

export async function runControllers(browser,url){
 const context=await browser.newContext({viewport:{width:1280,height:800}}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const app=fn=>page.evaluate(async source=>{const {api}=await import('/seekdeck-webdj/app.js');return new Function('api','return ('+source+')(api)')(api);},fn.toString());
 const open=()=>page.locator('[data-action=midi]').first().click();
 try{
  await page.goto(url);await page.waitForSelector('[data-panel=deck0]');
  await app(a=>{a.s.midiMappings=[{target:'deck.0.play',kind:'note',channel:0,number:99}];a.s.hidMappings=[{target:'deck.1.scratch',vendorId:1,productId:2,reportId:0,offset:0,min:0,max:1}];});
  await page.locator('[data-panel=deck0] [data-action=loop]').click();
  await page.locator('[data-panel=deck0] [data-action=play]').click();
  await waitForAsync(page,async()=>{const {api}=await import('/seekdeck-webdj/app.js');return api.s.decks[0].playing&&api.position(0)>.2;});
  const before=await app(a=>({hid:a.s.hidMappings,mixer:a.s.mixer,layout:a.s.layout,tracks:a.s.decks.map(d=>d.trackId)}));
  await open();assert.equal(await page.locator('[data-controller-apply]').isDisabled(),true);
  await page.locator('[data-controller-preset]').selectOption('ddj-400-basic');
  assert.match(await page.locator('[data-controller-summary]').textContent(),/1件を、52件/);
  await page.locator('[data-controller-apply]').click();
  assert.equal(await app(a=>a.s.midiMappings.length),52);
  assert.deepEqual(await app(a=>({hid:a.s.hidMappings,mixer:a.s.mixer,layout:a.s.layout,tracks:a.s.decks.map(d=>d.trackId)})),before);
  assert.equal(await app(a=>a.s.decks[0].playing),true);
  assert.match(await page.locator('[data-controller-result]').textContent(),/適用しました/);
  await page.locator('[data-action=close-dialog]').click();await open();
  assert.equal(await page.locator('[data-controller-preset]').inputValue(),'ddj-400-basic');
  // Simulated Web MIDI ports test UI binding and escaping; this is not hardware verification.
  await app(a=>{a.controllers.access={inputs:new Map([['fixture-port',{id:'fixture-port',name:'<img src=x onerror=alert(1)>',manufacturer:'Test',state:'connected'}]]),outputs:new Map()};a.controllers.emit('devices');});
  assert.equal(await page.locator('[data-controller-presets] img').count(),0);
  await page.locator('[data-controller-input]').selectOption('fixture-port');
  await page.locator('[data-controller-apply]').click();
  assert.equal(await app(a=>a.s.midiMappings.every(m=>m.inputId==='fixture-port')),true);
  const maps=await app(a=>JSON.stringify(a.s.midiMappings));
  await page.locator('[data-action=import-midi]').click();
  await page.locator('#json-file').setInputFiles({name:'invalid-controller.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({version:1,midiMappings:[{target:'deck.99.play',kind:'note',channel:0,number:1}]}))});
  await page.waitForSelector('.toast.error');assert.equal(await app(a=>JSON.stringify(a.s.midiMappings)),maps);
  await app(a=>{a.controllers.access.inputs.get('fixture-port').state='disconnected';a.controllers.emit('devices');});
  assert.equal(await page.locator('[data-controller-input]').inputValue(),'fixture-port');
  assert.equal(await page.locator('[data-controller-apply]').isDisabled(),true);
  assert.equal(await app(a=>JSON.stringify(a.s.midiMappings)),maps);
  await page.locator('[data-controller-input]').selectOption('');assert.equal(await page.locator('[data-controller-apply]').isEnabled(),true);
  await page.locator('[data-action=close-dialog]').click();await page.locator('[data-panel=deck0] [data-action=play]').click();
  assert.deepEqual(errors,[]);
  console.log('Controllers: preset replacement, preserved transport/session, port selection, disconnect handling, safe markup, and atomic invalid import passed (simulated ports; no physical hardware).');
 }finally{await context.close();}
}
