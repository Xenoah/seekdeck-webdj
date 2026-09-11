const CACHE_PREFIX='seekdeck:'+new URL('./',self.location).pathname+':';
const CACHE=CACHE_PREFIX+'0.5.1';
const ASSETS=['./','./index.html','./style.css','./workspace.css','./app.js','./core.js','./storage.js','./ui.js','./events.js','./dialogs.js','./layout.js','./mobile.js','./mobile.css','./controllers.js','./analysis-client.js','./visuals.js','./exchange.js','./exchange-core.js','./exchange-xml.js','./webmcp.js','./demo-data.js','./audio/waveform.js','./audio/waveform-worker.js','./icon.svg','./manifest.webmanifest','./audio/engine.js','./audio/processor.js','./audio/analysis.js','./demos/demo-0.wav','./demos/demo-1.wav','./demos/demo-2.wav','./demos/demo-3.wav'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith(CACHE_PREFIX)&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
const urls=new Set(ASSETS.map(path=>new URL(path,self.location).href));
self.addEventListener('fetch',e=>{
 if(e.request.method!=='GET')return;
 const url=new URL(e.request.url);url.search='';url.hash='';
 const key=url.href;if(!urls.has(key))return;
 e.respondWith(caches.open(CACHE).then(async cache=>{
  if(e.request.mode==='navigate'){
   try{const response=await fetch(e.request);if(response.ok&&response.type==='basic'&&new URL(response.url).origin===self.location.origin)cache.put(key,response.clone());return response;}
   catch{const cached=await cache.match(key)||await cache.match('./index.html');if(cached)return cached;throw new Error('Offline cache unavailable');}
  }
  const cached=await cache.match(key);if(cached)return cached;return fetch(e.request);
 }));
});
