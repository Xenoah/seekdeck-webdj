let worker,seq=0;const pending=new Map();
function getWorker(){if(!worker){worker=new Worker(new URL('./audio/analysis.js',import.meta.url),{type:'module'});worker.onmessage=({data})=>{let p=pending.get(data.id);if(!p)return;clearTimeout(p.timeout);pending.delete(data.id);data.error?p.reject(new Error(data.error)):p.resolve(data.result);};worker.onerror=()=>{for(const p of pending.values()){clearTimeout(p.timeout);p.reject(new Error('音源解析に失敗しました。BPMは手入力できます。'));}pending.clear();worker.terminate();worker=null;};}return worker;}
let waveQueue=Promise.resolve();
export function waveform(audio){
 const task=waveQueue.then(async()=>{
  const instance=new Worker(new URL('./audio/waveform-worker.js',import.meta.url),{type:'module'});
  let active=null,id=0;
  instance.onmessage=({data})=>{if(!active||data.id!==active.id)return;const p=active;active=null;clearTimeout(p.timeout);data.error?p.reject(new Error(data.error)):p.resolve(data.result);};
  instance.onerror=()=>{if(active){clearTimeout(active.timeout);active.reject(new Error('カラー波形の解析に失敗しました。'));active=null;}};
  const request=(type,data={},transfer=[])=>new Promise((resolve,reject)=>{const current=++id;active={id:current,resolve,reject,timeout:setTimeout(()=>{active=null;reject(new Error('カラー波形の解析がタイムアウトしました。'));},30000)};instance.postMessage({id:current,type,...data},transfer);});
  try{
   const count=Math.min(2,audio.numberOfChannels);
   await request('start',{frames:audio.length,sampleRate:audio.sampleRate,channels:count});
   for(let start=0;start<audio.length;start+=262144){const channels=Array.from({length:count},(_,c)=>audio.getChannelData(c).slice(start,Math.min(audio.length,start+262144)));await request('chunk',{channels},channels.map(c=>c.buffer));}
   return await request('finish');
  }finally{if(active)clearTimeout(active.timeout);instance.terminate();}
 });
 waveQueue=task.catch(()=>{});return task;
}
export function analyse(audio){const source=audio.getChannelData(0),stride=Math.max(1,Math.round(audio.sampleRate/11025)),n=Math.min(Math.floor(source.length/stride),Math.floor(audio.sampleRate*180/stride)),samples=new Float32Array(n);for(let i=0;i<n;i++){let s=0;for(let k=0;k<stride;k++)s+=source[i*stride+k]||0;samples[i]=s/stride;}const id=++seq;return new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{pending.delete(id);reject(new Error('解析に時間がかかっています。BPMは手入力できます。'));},45000);pending.set(id,{resolve,reject,timeout});getWorker().postMessage({id,samples,sampleRate:audio.sampleRate/stride},[samples.buffer]);});}
