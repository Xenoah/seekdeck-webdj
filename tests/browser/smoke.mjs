import {waitForAsync} from './poll.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createServer} from 'node:http';
import {chromium} from 'playwright';

const root=path.resolve('dist'),prefix='/seekdeck-webdj/',branchPrefix='/branch-pages/seekdeck-webdj/';
const types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/manifest+json','.wav':'audio/wav'};
const server=createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  const branch=url.pathname.startsWith(branchPrefix),route=branch?branchPrefix:prefix,base=branch?path.resolve('.'):root;
  if(!url.pathname.startsWith(route)){res.writeHead(404).end();return;}
  let file=path.resolve(base,decodeURIComponent(url.pathname.slice(route.length)||'index.html'));
  if(file.startsWith(base+path.sep)&&fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');
  if(!file.startsWith(base+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404).end();return;}
  res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'});fs.createReadStream(file).pipe(res);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url='http://127.0.0.1:'+server.address().port+prefix;
fs.mkdirSync('test-results',{recursive:true});
let browser;
try{
  browser=await chromium.launch({headless:true});
  await (await import('./pages-entry.mjs')).runPagesEntry(browser,'http://127.0.0.1:'+server.address().port+branchPrefix);
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);
  await page.waitForSelector('[data-wave="0"]');
  await page.waitForFunction(()=>{
    const c=document.querySelector('[data-wave="0"]');if(!c?.width)return false;
    const pixels=c.getContext('2d').getImageData(0,0,c.width,c.height).data,colors=new Set();
    for(let i=0;i<pixels.length;i+=4){const r=pixels[i],g=pixels[i+1],b=pixels[i+2];if(Math.max(r,g,b)>120&&Math.max(r,g,b)-Math.min(r,g,b)>32)colors.add(r+','+g+','+b);}
    return colors.size>20;
  });
  await page.screenshot({path:'test-results/desktop-rgb.png',fullPage:true});
  await page.locator('[data-waveform-style]').selectOption('3band');
  // Set the loop before starting the short demo so it cannot finish before the import check begins.
  await page.locator('[data-panel=deck0] [data-action=loop]').click();
  await page.locator('[data-panel=deck0] [data-action=play]').click();
  await waitForAsync(page,async()=>{const {api}=await import('/seekdeck-webdj/app.js');return api.s.decks[0].playing&&api.engine.positions[0]>.2;});
  const transportState=()=>page.evaluate(async()=>{const {api}=await import('/seekdeck-webdj/app.js');return {playing:api.s.decks[0].playing,position:api.position(0),contextTime:api.engine.context.currentTime,duration:api.getTrack(0).duration,loop:api.s.decks[0].loop,errors:Array.from(document.querySelectorAll('.toast.error')).map(e=>e.textContent)};});
  const before=await transportState();console.log('Before import:',before);
  assert.equal(before.playing,true,'The demo must be playing before the import continuity check');
  await page.locator('#audio-files').setInputFiles('dist/demos/demo-0.wav');
  await waitForAsync(page,async()=>{const {api}=await import('/seekdeck-webdj/app.js');return !api.importing&&[...api.tracks.values()].some(t=>!t.demo&&t.waveform?.version===1&&t.waveform.low.some(x=>x>0));},{},{timeout:60000});
  console.log('After import:',await transportState());
  assert.equal(await page.evaluate(async()=>{const {api}=await import('/seekdeck-webdj/app.js');return api.s.decks[0].playing;}),true,'Playback stopped during waveform analysis');
  await page.locator('[data-panel=deck0] [data-action=play]').click();
  await page.waitForTimeout(900);
  await page.reload();await page.waitForSelector('[data-wave="0"]');
  assert.equal(await page.locator('[data-waveform-style]').inputValue(),'3band');
  assert.equal(await page.evaluate(async()=>{const {api}=await import('/seekdeck-webdj/app.js');return api.s.decks.some(d=>d.playing);}),false);
  assert.deepEqual(errors,[]);
  await page.screenshot({path:'test-results/desktop-3band.png',fullPage:true});
  if(fs.existsSync('tests/browser/mobile.mjs'))await (await import('./mobile.mjs')).runMobile(browser,url);
  if(fs.existsSync('tests/browser/exchange.mjs'))await (await import('./exchange.mjs')).runExchange(page,url);
  console.log('Chromium: subpath startup, RGB canvas, audio playback, worker import, and state restore passed.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
