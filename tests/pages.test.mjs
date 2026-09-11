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
