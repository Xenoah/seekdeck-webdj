import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
test('PWA starts within the repository path on GitHub Pages',()=>{
 const manifest=JSON.parse(fs.readFileSync('dist/manifest.webmanifest','utf8'));
 const base='https://example.github.io/seekdeck-webdj/manifest.webmanifest';
 for(const key of ['id','scope','start_url'])assert.equal(new URL(manifest[key],base).pathname,'/seekdeck-webdj/');
 const html=fs.readFileSync('dist/index.html','utf8');
 for(const [,value]of html.matchAll(/(?:src|href)="([^"#]+)"/g))assert.ok(new URL(value,base).pathname.startsWith('/seekdeck-webdj/'));
});
test('offline cache cleanup leaves other applications intact',async()=>{
 const events={},deleted=[];
 const context={URL,Set,Promise,fetch:()=>{},self:{location:'https://example.github.io/seekdeck-webdj/sw.js',clients:{claim:async()=>{}},addEventListener:(name,fn)=>events[name]=fn},caches:{keys:async()=>['seekdeck:/seekdeck-webdj/:old','seekdeck:/other-app/:old','another-app-cache'],delete:async key=>deleted.push(key)}};
 vm.runInNewContext(fs.readFileSync('dist/sw.js','utf8'),context);
 await new Promise((resolve,reject)=>events.activate({waitUntil:p=>p.then(resolve,reject)}));
 assert.deepEqual(deleted,['seekdeck:/seekdeck-webdj/:old']);
});
test('offline entry with query parameters uses the app cache without intercepting other paths',async()=>{
 const events={},lookups=[],base='https://example.github.io/seekdeck-webdj/dist/',cached={html:'DJ app'};
 const context={URL,Set,Promise,fetch:async()=>{throw new Error('offline');},self:{location:new URL(base+'sw.js'),addEventListener:(name,fn)=>events[name]=fn},caches:{open:async()=>({match:async key=>{lookups.push(key);return key===base?cached:undefined;}})}};
 vm.runInNewContext(fs.readFileSync('dist/sw.js','utf8'),context);
 let response;
 events.fetch({request:{method:'GET',mode:'navigate',url:base+'?v=0.5.1'},respondWith:p=>{response=p;}});
 assert.equal(await response,cached);assert.deepEqual(lookups,[base]);
 for(const url of ['https://example.github.io/another-app/?v=1',base+'unknown.html?v=1','https://other.example/seekdeck-webdj/dist/?v=1']){
  events.fetch({request:{method:'GET',mode:'navigate',url},respondWith:()=>assert.fail('Out-of-scope request intercepted')});
 }
});
