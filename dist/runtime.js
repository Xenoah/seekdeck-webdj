// Browser lifecycle protection. A suspended context is never treated as audible playback.
const finite=value=>Number.isFinite(value)?value:null;
const timestamp=()=>new Date().toISOString();

export class PerformanceRuntime {
 constructor(api,environment={}){
  this.api=api;this.doc=environment.document??globalThis.document;this.win=environment.window??globalThis.window;this.nav=environment.navigator??globalThis.navigator;
  this.now=environment.now??(()=>performance.now());this.pending=new Map();this.revisions=[0,0,0,0];this.events=[];this.wake=null;this.wakeRequest=null;this.wakeBlocked=false;this.activeBefore=false;this.disposed=false;this.generation=0;this.state='standby';this.cueContext=null;this.uiSamples=0;this.maxForegroundGapMs=0;
  this.stateListener=()=>this.refresh();this.visibilityListener=()=>{if(this.doc.visibilityState==='visible')this.wakeBlocked=false;this.lastTick=this.now();this.note('visibility',this.doc.visibilityState);this.refresh();};
  this.pagehideListener=()=>{this.interrupt('pagehide');this.reset();this.releaseWake();};
  this.clickListener=e=>{const action=e.target.closest?.('[data-runtime-action]')?.dataset.runtimeAction;if(!action)return;const task=action==='resume'?this.resume():action==='cancel-resume'?this.reset():action==='diagnostics'?this.exportDiagnostics():action==='wake-retry'?(this.wakeBlocked=false,this.refresh()):null;Promise.resolve(task).catch(error=>api.toast(error.message,true));};
  this.changeListener=e=>{if(!e.target.matches?.('[data-runtime-awake]'))return;api.s.runtime??={};api.s.runtime.keepAwake=e.target.checked;api.save();this.wakeBlocked=false;this.refresh();};
  api.engine.addEventListener('state',this.stateListener);this.doc?.addEventListener('visibilitychange',this.visibilityListener);this.win?.addEventListener('pagehide',this.pagehideListener);this.doc?.addEventListener('click',this.clickListener);this.doc?.addEventListener('change',this.changeListener);
  this.lastTick=this.now();if(environment.timer!==false)this.timer=setInterval(()=>this.tick(),1000);
  this.refresh();
 }
 note(type,value){this.events.push({at:timestamp(),type,value});if(this.events.length>100)this.events.shift();}
 get needsResume(){return this.pending.size>0;}
 get active(){return this.api.s.decks.some(d=>d.playing)||!!this.api.engine.recording||!!this.api.engine.sampleSlots?.length;}
 cancelDeck(i){this.revisions[i]++;this.pending.delete(i);this.renderStatus();}
 reset(){this.generation++;this.pending.clear();this.revisions=this.revisions.map(n=>n+1);this.renderStatus();}
 interrupt(reason){
  const a=this.api;let interrupted=false;a.releaseGestures?.();
  a.s.decks.forEach((d,i)=>{
   // Cancel asynchronous starts as well as already audible transport.
   a.invalidateDeck?.(i);
   if(d.playing){const position=a.position(i);this.pending.set(i,{trackId:d.trackId,revision:this.revisions[i]});d.position=position;d.playing=false;a.engine.play(i,false);a.renderDeck(i);interrupted=true;}
   a.engine.scratch(i,false);a.engine.roll(i,false);
  });
  a.engine.stopSamples();
  if(interrupted||a.engine.recording){a.save();a.toast(reason==='closed'?'音声エンジンが終了しました。保存後にページを再読み込みしてください。':'音声が中断されました。出力を確認し「演奏を再開」で復帰できます。サンプルは再度押してください。',true,10000);}
  if(reason==='closed')this.reset();
  this.note('audio-interruption',reason);this.renderStatus();
 }
 refresh(){
  if(this.disposed)return;
  const engine=this.api.engine,c=engine.context,cue=engine.cueContext;
  if(cue!==this.cueContext){this.cueContext?.removeEventListener('statechange',this.stateListener);this.cueContext=cue;cue?.addEventListener('statechange',this.stateListener);}
  const main=c?.state||'standby',cueUnavailable=engine.route==='device'&&cue&&cue.state!=='running',state=cueUnavailable?'cue-'+cue.state:main;
  if(state!==this.state){const previous=this.state;this.state=state;this.note('audio-state',state);if(state!=='running'&&state!=='standby'&&(previous==='running'||this.active))this.interrupt(main==='closed'?'closed':state);}
  const active=this.active;if(active&&!this.activeBefore)this.wakeBlocked=false;this.activeBefore=active;
  this.syncWake();this.renderStatus();
 }
 async resume(){
  if(this.doc.visibilityState!=='visible')throw new Error('画面を開いてから音声を再開してください。');
  if(this.api.engine.context?.state==='closed')throw new Error('音声エンジンが終了しています。保存後にページを再読み込みしてください。');
  const generation=this.generation,held=[...this.pending.entries()];
  await this.api.startAudio();
  if(generation!==this.generation)return;
  this.refresh();
  if(this.state!=='running')throw new Error('まだ音声出力を利用できません。着信や他アプリの音声を終了して再試行してください。');
  // Only the original, unchanged deck is resumed; loading/stopping it cancels its intent.
  for(const [i,entry] of held){const d=this.api.s.decks[i];if(generation!==this.generation)return;if(this.pending.get(i)!==entry)continue;if(entry.revision!==this.revisions[i]||entry.trackId!==d.trackId||d.playing){this.pending.delete(i);continue;}await this.api.playDeck(i,true);this.pending.delete(i);}
  this.note('explicit-resume',held.length);this.refresh();
 }
 wakeWanted(){return !this.disposed&&this.api.s.runtime?.keepAwake===true&&this.doc?.visibilityState==='visible'&&this.active&&this.state==='running';}
 syncWake(){
  if(!this.wakeWanted()){this.releaseWake();return;}
  if(this.wake||this.wakeRequest||this.wakeBlocked||!this.nav?.wakeLock?.request)return;
  const request=Promise.resolve().then(()=>this.nav.wakeLock.request('screen'));this.wakeRequest=request;
  request.then(async lock=>{
   if(!this.wakeWanted()){await lock.release();return;}
   this.wake=lock;lock.addEventListener('release',()=>{if(this.wake===lock){this.wake=null;this.wakeBlocked=true;this.note('wake-lock','released');this.renderStatus();}},{once:true});this.note('wake-lock','acquired');
  }).catch(error=>{this.wakeBlocked=true;this.note('wake-lock',error.name||'denied');}).finally(()=>{if(this.wakeRequest===request)this.wakeRequest=null;this.renderStatus();});
 }
 releaseWake(){const lock=this.wake;this.wake=null;if(lock)Promise.resolve(lock.release()).catch(()=>{});}
 tick(){const now=this.now(),gap=now-this.lastTick;this.lastTick=now;if(this.doc?.visibilityState==='visible'&&this.active&&this.state==='running'){this.uiSamples++;this.maxForegroundGapMs=Math.max(this.maxForegroundGapMs,Math.max(0,gap-1000));}this.refresh();}
 get wakeLabel(){return !this.nav?.wakeLock?.request?'このブラウザでは利用不可':this.wake?'画面点灯を保持中':this.wakeBlocked?'OSにより解除／利用不可':this.api.s.runtime?.keepAwake?'演奏開始待ち':'OFF';}
 renderStatus(){
  const state=this.needsResume?'音声中断 · 演奏の再開待ち':this.state==='running'?'音声出力中':this.state==='standby'?'オーディオ開始待ち':'音声出力を確認してください';
  this.doc?.querySelectorAll?.('[data-runtime-status]').forEach(el=>el.textContent=state+' · 画面保持 '+this.wakeLabel);
  this.doc?.querySelectorAll?.('[data-runtime-action="resume"]').forEach(el=>el.textContent=this.needsResume?'音声・演奏を再開':'音声を再開');
  const button=this.doc?.querySelector?.('#audio-start');if(button){button.textContent=this.needsResume?'演奏を再開':this.state==='running'?'AUDIO ON':this.state==='standby'?'オーディオ開始':'オーディオ再開';button.classList.toggle('active',!this.needsResume&&this.state==='running');}
 }
 settingsMarkup(){return `<h3>演奏の安定性</h3><label><input type="checkbox" data-runtime-awake ${this.api.s.runtime?.keepAwake?'checked':''}>演奏・録音中は画面を点灯したままにする</label><p class="muted">画面が表示されている間だけ保持します。OSの省電力設定や着信で解除される場合があります。音声が中断されたときは、出力を確認してから再開してください。</p><p data-runtime-status>${this.needsResume?'演奏の再開待ち':'画面保持 '+this.wakeLabel}</p><div class="dialog-actions"><button data-runtime-action="resume" class="button">音声・演奏を再開</button><button data-runtime-action="cancel-resume" class="button">再開待ちを解除</button><button data-runtime-action="wake-retry" class="button">画面保持を再試行</button><button data-runtime-action="diagnostics" class="button">端末診断JSONを書き出す</button></div><p class="muted">診断には音源・曲名・保存先を含みません。遅延はブラウザの報告値で、操作から発音までの実測値ではありません。</p>`;}
 diagnostics(){
  const e=this.api.engine,c=e.context,lat=e.latency;
  return {format:'seekdeck-runtime-diagnostics',version:1,createdAt:timestamp(),appVersion:this.doc?.querySelector?.('[data-app-version]')?.textContent||null,browser:this.nav?.userAgent||null,visibility:this.doc?.visibilityState||null,viewport:{width:this.win?.innerWidth||null,height:this.win?.innerHeight||null,pixelRatio:this.win?.devicePixelRatio||null},audio:{state:this.state,contextState:c?.state||'standby',cueState:e.cueContext?.state||null,route:e.route||'stereo',sampleRate:finite(c?.sampleRate),browserReportedBaseLatencyMs:finite(lat?.base),browserReportedOutputLatencyMs:finite(lat?.output),physicalInputToSoundLatencyMs:null,physicalLatencyMeasured:false,decodedBytes:[...e.buffers.values()].reduce((sum,b)=>sum+(b.bytes||0),0),recording:!!e.recording,activeDecks:this.api.s.decks.flatMap((d,i)=>d.playing?[i]:[]),resumePendingDecks:[...this.pending.keys()]},screenWakeLock:{requested:this.api.s.runtime?.keepAwake===true,supported:!!this.nav?.wakeLock?.request,held:!!this.wake},foregroundTimer:{samples:this.uiSamples,maxSchedulingGapMs:finite(this.maxForegroundGapMs),meaning:'Delay beyond a 1000 ms main-thread timer; not audio underruns or physical latency.'},recentEvents:this.events.map(e=>({...e}))};
 }
 exportDiagnostics(){const report=this.diagnostics();this.api.downloadBlob(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}),'SeekDeck-diagnostics-'+report.createdAt.replace(/[:.]/g,'-')+'.json');}
 dispose(){this.disposed=true;clearInterval(this.timer);this.api.engine.removeEventListener('state',this.stateListener);this.cueContext?.removeEventListener('statechange',this.stateListener);this.doc?.removeEventListener('visibilitychange',this.visibilityListener);this.win?.removeEventListener('pagehide',this.pagehideListener);this.doc?.removeEventListener('click',this.clickListener);this.doc?.removeEventListener('change',this.changeListener);this.releaseWake();this.reset();}
}
export const createRuntime=(api,environment)=>new PerformanceRuntime(api,environment);
