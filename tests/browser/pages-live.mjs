import {waitForAsync} from './poll.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright';

const version=JSON.parse(fs.readFileSync('package.json','utf8')).version;
const base=process.env.PAGES_URL;
if(!base||!/^https:\/\/[^/]+\.github\.io\//.test(base))throw new Error('A GitHub Pages HTTPS URL is required.');
const browser=await chromium.launch({headless:true});
let lastError;
try{
 for(let attempt=1;attempt<=8;attempt++){
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  try{
   // A deployment and its CDN invalidation can complete after the release checks start.
   const url=new URL(base);url.searchParams.set('verify',`${version}-${Date.now()}`);
   await page.goto(url.href,{waitUntil:'domcontentloaded',timeout:20000});
   await page.locator('[data-app-version]').waitFor({timeout:12000});
   assert.equal(await page.locator('[data-app-version]').textContent(),'v'+version,'The new Pages release is not visible yet');
   await page.locator('[data-panel=deck0] [data-action=loop]').click();
   await page.locator('[data-panel=deck0] [data-action=play]').click();
   await waitForAsync(page,async()=>{const {api}=await import(new URL('./app.js',location.href).href);return api.s.decks[0].playing&&api.position(0)>.2;},{},{timeout:15000});
   await page.locator('[data-panel=deck0] [data-action=play]').click();
   assert.deepEqual(errors,[]);
   fs.mkdirSync('test-results',{recursive:true});await page.screenshot({path:'test-results/published-pages.png',fullPage:true});
   console.log(`Published Pages verified: ${base} → ${new URL(page.url()).pathname}; SeekDeck v${version}; DJ controls and AudioWorklet playback passed.`);
   lastError=null;break;
  }catch(error){lastError=error;console.log(`Pages propagation attempt ${attempt}/8: ${error.message.split('\n')[0]}`);}
  finally{await context.close();}
  if(attempt<8)await new Promise(resolve=>setTimeout(resolve,10000));
 }
 if(lastError)throw lastError;
}finally{await browser.close();}
