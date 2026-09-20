import assert from 'node:assert/strict';
import {waitForAsync} from './poll.mjs';

export async function runControllers(browser,url){
 const context=await browser.newContext({viewport:{width:1280,height:800}}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const app=fn=>page.evaluate(async source=>{const {api}=await import('/seekdeck-webdj/app.js');return new Function('api','return ('+source+')(api)')(api);},fn.toString());
 const open=()=>page.locator('[data-action=midi]').first().click();
 const midi=(bytes,id='flx4-port')=>page.evaluate(async({bytes,id})=>{const {api}=await import('/seekdeck-webdj/app.js');api.controllers.access.inputs.get(id).onmidimessage({data:Uint8Array.from(bytes)});},{bytes,id});
 const tap=async(status,number)=>{await midi([status,number,127]);await midi([status,number,0]);};
 try{
  await page.goto(url);await page.waitForSelector('[data-panel=deck0]');
  const defaults=await app(a=>a.s.midiMappings),presetCount=defaults.length;
  assert.ok(defaults.some(m=>m.target==='deck.0.jog'&&m.number===34&&m.mode==='relative-offset'));
  assert.ok(defaults.some(m=>m.target==='deck.0.jog'&&m.number===33&&m.mode==='relative-offset'));
  assert.ok(defaults.every(m=>m.deviceName==='DDJ-FLX4'),'Fresh sessions must use the model-scoped DDJ-FLX4 preset');
  await app(a=>{a.s.midiMappings=[{target:'deck.0.play',kind:'note',channel:0,number:99}];a.s.hidMappings=[{target:'deck.1.scratch',vendorId:1,productId:2,reportId:0,offset:0,min:0,max:1}];a.save();});
  await page.waitForTimeout(950);await page.reload();await page.waitForSelector('[data-panel=deck0]');
  assert.equal(await app(a=>a.s.midiMappings.length),1);
  assert.equal(await app(a=>a.s.midiMappings[0].number),99,'Saved custom MIDI mappings must survive the new default');
  await page.locator('[data-panel=deck0] [data-action=loop]').click();
  await page.locator('[data-panel=deck0] [data-action=play]').click();
  await waitForAsync(page,async()=>{const {api}=await import('/seekdeck-webdj/app.js');return api.s.decks[0].playing&&api.position(0)>.2;});
  const before=await app(a=>({hid:a.s.hidMappings,mixer:a.s.mixer,layout:a.s.layout,tracks:a.s.decks.map(d=>d.trackId)}));
  await open();assert.equal(await page.locator('[data-controller-preset]').inputValue(),'ddj-flx4');
  assert.equal(await page.locator('[data-controller-apply]').isEnabled(),true);
  assert.match(await page.locator('[data-controller-input] option').first().textContent(),/DDJ-FLX4/);
  assert.equal(await page.locator('[data-controller-download]').getAttribute('href'),'./controller-profiles/ddj-flx4.json');
  assert.match(await page.locator('[data-controller-scope]').textContent(),/側面/);
  await page.locator('[data-controller-preset]').selectOption('ddj-400-basic');
  assert.match(await page.locator('[data-controller-summary]').textContent(),/1件を、52件/);
  assert.match(await page.locator('[data-controller-input] option').first().textContent(),/DDJ-400/);
  assert.equal(await page.locator('[data-controller-download]').getAttribute('download'),'SeekDeck-DDJ-400-basic.json');
  assert.match(await page.locator('[data-controller-scope]').textContent(),/HOT CUEモード/);
  await page.locator('[data-controller-apply]').click();
  assert.equal(await app(a=>a.s.midiMappings.length),52);
  await page.locator('[data-controller-preset]').selectOption('ddj-flx4');
  assert.match(await page.locator('[data-controller-summary]').textContent(),new RegExp(`52件を、${presetCount}件`));
  assert.equal(await page.locator('[data-controller-download]').getAttribute('download'),'SeekDeck-DDJ-FLX4.json');
  await page.locator('[data-controller-apply]').click();
  assert.equal(await app(a=>a.s.midiMappings.length),presetCount);
  assert.deepEqual(await app(a=>({hid:a.s.hidMappings,mixer:a.s.mixer,layout:a.s.layout,tracks:a.s.decks.map(d=>d.trackId)})),before);
  assert.equal(await app(a=>a.s.decks[0].playing),true);
  assert.match(await page.locator('[data-controller-result]').textContent(),/適用しました/);
  await page.locator('[data-action=close-dialog]').click();await open();
  assert.equal(await page.locator('[data-controller-preset]').inputValue(),'ddj-flx4');
  await page.screenshot({path:'test-results/ddj-flx4-preset.png'});
  await page.locator('[data-action=close-dialog]').click();

  // Deliver the documented FLX4 bytes through an attached Web MIDI port and the real app/audio engine.
  await app(a=>{a.controllers.access={inputs:new Map([['flx4-port',{id:'flx4-port',name:'DDJ-FLX4',manufacturer:'AlphaTheta',state:'connected'}],['other-port',{id:'other-port',name:'Other controller',manufacturer:'Test',state:'connected'}]]),outputs:new Map()};a.controllers.attach();});
  await midi([0x90,11,127],'other-port');await midi([0x90,11,0],'other-port');
  assert.equal(await app(a=>a.s.decks[0].playing),true,'The model preset must ignore other controllers');
  await tap(0x90,11);
  await waitForAsync(page,async()=>{const {api}=await import('/seekdeck-webdj/app.js');return !api.s.decks[0].playing;});
  await tap(0x91,11);
  await waitForAsync(page,async()=>{const {api}=await import('/seekdeck-webdj/app.js');return api.s.decks[1].playing&&api.engine.positions[1]>.05;});
  await tap(0x91,11);
  await waitForAsync(page,async()=>{const {api}=await import('/seekdeck-webdj/app.js');return !api.s.decks[1].playing;});

  const rightVolume=await app(a=>a.s.decks[1].volume);
  await midi([0xb1,51,0]);assert.equal(await app(a=>a.s.decks[1].volume),rightVolume,'A lone fader LSB must not replace the fader value');
  await midi([0xb1,19,64]);
  assert.ok(Math.abs(await app(a=>a.s.decks[1].volume)-8192/16383)<1e-9);
  await midi([0xb0,19,127]);await midi([0xb0,51,127]);
  assert.equal(await app(a=>a.s.decks[0].volume),1);
  await midi([0xb0,4,64]);await midi([0xb0,36,0]);
  await midi([0xb0,7,64]);await midi([0xb0,39,0]);
  assert.ok(Math.abs(await app(a=>a.s.decks[0].gain))<1e-9);
  assert.ok(Math.abs(await app(a=>a.s.decks[0].high))<1e-9);
  await midi([0xb6,31,0]);await midi([0xb6,63,0]);
  assert.equal(await app(a=>a.s.mixer.crossfader),-1);
  await midi([0xb6,31,64]);await midi([0xb6,63,0]);
  assert.ok(Math.abs(await app(a=>a.s.mixer.crossfader))<.0001);
  await midi([0xb0,0,64]);await midi([0xb0,32,0]);
  assert.ok(Math.abs(await app(a=>a.s.decks[0].rate)-1)<.0001);
  await app(a=>{
   a.s.decks[0].loop={enabled:false,start:0,end:0};a.engine.applyDeck(0,a.s.decks[0],a.getTrack(0).bpm);a.seekDeck(0,1);
   a.controllerProbe={moves:[],rates:[],holds:[]};
   for(const [name,key]of [['scratchMove','moves'],['applyDeck','rates'],['scratch','holds']]){
    const original=a.engine[name];a.engine[name]=function(...args){a.controllerProbe[key].push(name==='applyDeck'?{deck:args[0],rate:args[1].rate}:args);return original.apply(this,args);};
   }
  });
  await tap(0x90,11);
  await waitForAsync(page,async()=>{const {api}=await import('/seekdeck-webdj/app.js');return api.s.decks[0].playing&&api.engine.positions[0]>1.05;});
  await midi([0x90,54,127]);await page.waitForTimeout(120);
  const heldPosition=await app(a=>a.engine.positions[0]);
  await app(a=>{const input=a.controllers.access.inputs.get('flx4-port');for(let n=0;n<20;n++)input.onmidimessage({data:Uint8Array.from([0xb0,34,65])});});
  const forward=await app(a=>a.controllerProbe.moves.reduce((sum,[deck,seconds])=>sum+(deck===0?seconds:0),0));
  assert.ok(forward>0&&forward<.2,'Twenty +1 ticks must produce a small forward scratch displacement');
  await waitForAsync(page,async expected=>{const {api}=await import('/seekdeck-webdj/app.js');return Math.abs(api.engine.positions[0]-expected)<.004;},heldPosition+forward);
  await app(a=>{const input=a.controllers.access.inputs.get('flx4-port');for(let n=0;n<20;n++)input.onmidimessage({data:Uint8Array.from([0xb0,34,63])});});
  await waitForAsync(page,async expected=>{const {api}=await import('/seekdeck-webdj/app.js');return Math.abs(api.engine.positions[0]-expected)<.004;},heldPosition);
  await page.waitForTimeout(150);
  assert.ok(Math.abs(await app(a=>a.engine.positions[0])-heldPosition)<.004,'A stationary touch must hold position without runaway audio');
  assert.equal(await app(a=>a.s.decks[0].playing),true,'Scratch must preserve the deck transport state');
  await midi([0x90,54,0]);
  await waitForAsync(page,async position=>{const {api}=await import('/seekdeck-webdj/app.js');return api.engine.positions[0]>position+.1;},heldPosition);

  const savedRate=await app(a=>a.s.decks[0].rate);
  await app(a=>{a.controllerProbe.moves=[];a.controllerProbe.rates=[];a.controllerProbe.holds=[];});
  // Sustain a small rim movement long enough for the worklet to report its temporary rate.
  for(let n=0;n<5;n++){await midi([0xb0,33,65]);await page.waitForTimeout(25);}
  assert.ok(await app(a=>a.engine.rates[0]>a.s.decks[0].rate&&a.engine.rates[0]<a.s.decks[0].rate*1.02));
  assert.equal(await app(a=>a.s.decks[0].rate),savedRate,'Rim bend must not overwrite the stored tempo');
  assert.equal(await app(a=>a.controllerProbe.moves.length),0,'The rim must not dispatch scratch displacement');
  assert.equal(await app(a=>a.controllerProbe.holds.some(([,active])=>active)),false);
  await waitForAsync(page,async rate=>{const {api}=await import('/seekdeck-webdj/app.js');return Math.abs(api.engine.rates[0]-rate)<1e-9;},savedRate);
  await midi([0xb0,33,63]);
  assert.ok(await app(a=>{const rate=a.controllerProbe.rates.at(-1).rate;return rate<a.s.decks[0].rate&&rate>a.s.decks[0].rate*.98;}));
  await waitForAsync(page,async rate=>{const {api}=await import('/seekdeck-webdj/app.js');return Math.abs(api.engine.rates[0]-rate)<1e-9;},savedRate);
  await tap(0x90,12);
  await waitForAsync(page,async()=>{const {api}=await import('/seekdeck-webdj/app.js');return !api.s.decks[0].playing&&Math.abs(api.position(0)-api.s.decks[0].cuePoint)<.02;});

  // Exercise the actual loop state and retained range, beyond dispatching a target string.
  await app(a=>{a.s.decks[0].quantize=false;a.seekDeck(0,1);});
  await tap(0x90,77);
  const loop=await app(a=>a.s.decks[0].loop);
  assert.equal(loop.enabled,true);assert.equal(loop.start,1);
  assert.ok(loop.end>loop.start);assert.equal(await app(a=>a.s.decks[0].loopBeats),4);
  await tap(0x90,77);assert.equal(await app(a=>a.s.decks[0].loop.enabled),false);
  await app(a=>a.seekDeck(0,4));await tap(0x90,80);
  assert.deepEqual(await app(a=>a.s.decks[0].loop),loop,'RELOOP must recall the retained bounds instead of creating a loop at the new position');
  await waitForAsync(page,async expected=>{const {api}=await import('/seekdeck-webdj/app.js');return Math.abs(api.engine.positions[0]-expected)<.01;},loop.start);
  await tap(0x90,77);

  // A shifted hot-cue packet must delete and persist the cue, without recalling or playing it.
  await app(a=>a.seekDeck(0,1.25));await tap(0x97,7);
  await page.waitForSelector('[data-panel=deck0] [data-pad="7"].set');
  assert.equal(await app(a=>a.getTrack(0).cues[7]),1.25);
  await tap(0x98,7);
  await page.waitForSelector('[data-panel=deck0] [data-pad="7"]:not(.set)');
  assert.equal(await app(a=>a.getTrack(0).cues[7]),null);
  assert.equal(await app(a=>a.s.decks[0].playing),false);
  assert.equal(await app(async a=>(await a.getTracks()).find(t=>t.id===a.s.decks[0].trackId).cues[7]),null);

  // Browse the rendered library, LOAD the selected audio, then play the loaded worklet buffer.
  const library=await app(a=>{a.search='SeekDeck · DEMO';a.s.playlist='all';a.sort={key:'name',direction:1};a.renderRows();const ids=[...document.querySelectorAll('#track-rows [data-track]')].map(row=>row.dataset.track);a.s.selectedTrack=ids[0];a.renderRows();return {ids,loaded:a.s.decks[0].trackId};});
  assert.ok(library.ids.length>=2);assert.notEqual(library.ids[1],library.loaded);
  await midi([0xb6,64,1]);
  assert.equal(await app(a=>a.s.selectedTrack),library.ids[1]);
  assert.equal(await page.locator('#track-rows [data-track].selected').getAttribute('data-track'),library.ids[1]);
  await tap(0x96,65);
  assert.equal(await page.evaluate(()=>document.activeElement?.dataset.track),library.ids[1]);
  await tap(0x96,70);
  await waitForAsync(page,async id=>{const {api}=await import('/seekdeck-webdj/app.js');return api.s.decks[0].trackId===id&&api.engine.loadedIds[0]===id;},library.ids[1]);
  assert.equal(await app(a=>a.s.decks[0].playing),false);
  await tap(0x90,11);
  await waitForAsync(page,async()=>{const {api}=await import('/seekdeck-webdj/app.js');return api.s.decks[0].playing&&api.engine.positions[0]>.05;});
  await tap(0x90,11);
  await waitForAsync(page,async()=>{const {api}=await import('/seekdeck-webdj/app.js');return !api.s.decks[0].playing;});

  // Full selector packets include zero-valued releases. Confirm that they reach the actual wet buses.
  for(const bytes of [[0x94,16,0],[0x94,17,0],[0x95,16,0],[0x95,17,127],[0xb4,2,96],[0xb4,34,0]])await midi(bytes);
  assert.deepEqual(await app(a=>a.s.decks.slice(0,2).map(d=>d.fx.mix)),[0,0]);
  await tap(0x95,71);
  assert.equal(await app(a=>a.s.decks[0].fx.mix),0);
  assert.ok(Math.abs(await app(a=>a.s.decks[1].fx.mix)-12288/16383)<1e-9);
  await waitForAsync(page,async()=>{const {api}=await import('/seekdeck-webdj/app.js');return api.engine.channels[1].wet.gain.value>.4&&api.engine.channels[0].wet.gain.value<.01;});
  await tap(0x94,99);
  assert.equal(await app(a=>a.s.decks[1].fx.type),'reverb');
  const effectBeats=await app(a=>a.s.decks[1].fx.beats);
  await tap(0x94,75);assert.equal(await app(a=>a.s.decks[1].fx.beats),effectBeats*2);
  for(const bytes of [[0x94,16,127],[0x94,17,0],[0x95,16,0],[0x95,17,127]])await midi(bytes);
  assert.ok(await app(a=>a.s.decks[0].fx.mix>0&&a.s.decks[0].fx.mix===a.s.decks[1].fx.mix));
  await tap(0x94,71);
  assert.deepEqual(await app(a=>a.s.decks.slice(0,2).map(d=>d.fx.mix)),[0,0]);
  await waitForAsync(page,async()=>{const {api}=await import('/seekdeck-webdj/app.js');return api.engine.channels.slice(0,2).every(channel=>channel.wet.gain.value<.01);});

  // Simulated Web MIDI ports test UI binding and escaping; this is not hardware verification.
  await open();
  await app(a=>{a.controllers.access={inputs:new Map([['fixture-port',{id:'fixture-port',name:'<img src=x onerror=alert(1)>',manufacturer:'Test',state:'connected'}]]),outputs:new Map()};a.controllers.attach();a.controllers.emit('devices');});
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
  await page.locator('[data-action=close-dialog]').click();
  assert.deepEqual(errors,[]);
  console.log('Controllers: default FLX4 and saved custom mappings, legacy preset, preserved session, real app MIDI transport/mixer, scratch displacement and touch release, reversible rim bend, loop/reloop, persistent shifted cue deletion, library/LOAD/audio, FX wet-bus routing, port binding, disconnect handling, safe markup, and atomic invalid import passed (simulated ports; no physical hardware).');
 }catch(error){
  console.error('Controller browser diagnostics:',await app(a=>({audio:a.engine.context?.state,loaded:a.engine.loadedIds,positions:a.engine.positions,rates:a.engine.rates,decks:a.s.decks.map(d=>({trackId:d.trackId,playing:d.playing,rate:d.rate,loop:d.loop})),toasts:[...document.querySelectorAll('.toast')].map(e=>e.textContent)})).catch(e=>({error:e.message})));
  await page.screenshot({path:'test-results/controllers-failure.png'}).catch(()=>{});
  throw error;
 }finally{await context.close();}
}
