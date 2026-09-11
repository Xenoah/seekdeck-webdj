import {waitForAsync} from './poll.mjs';
import assert from 'node:assert/strict';
export async function runPagesEntry(browser,url){
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(url+'?entry=branch#saved-view');
  await page.waitForURL(url+'dist/?entry=branch#saved-view');
  await page.waitForSelector('[data-panel=deck0]');
  assert.equal(await page.title(),'SeekDeck — Local mixing studio');
  await page.locator('[data-panel=deck0] [data-action=loop]').click();
  await page.locator('[data-panel=deck0] [data-action=play]').click();
  await waitForAsync(page,async()=>{const {api}=await import(new URL('./app.js',location.href).href);return api.s.decks[0].playing&&api.position(0)>.2;});
  await page.locator('[data-panel=deck0] [data-action=play]').click();
  await waitForAsync(page,async()=>{const registration=await navigator.serviceWorker.getRegistration();return registration?.active?.state==='activated'&&!!navigator.serviceWorker.controller;});
  assert.equal(await page.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration();return r.scope;}),url+'dist/');
  await context.setOffline(true);await page.reload();await page.waitForSelector('[data-panel=deck0]');
  assert.deepEqual(errors,[]);await page.screenshot({path:'test-results/branch-pages-entry.png',fullPage:true});
  console.log('Branch Pages: repository root opens dist, preserves query/hash, plays audio, and reloads offline within its scope.');
 }finally{await context.close();}
}
