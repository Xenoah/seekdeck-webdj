import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const engineSource=fs.readFileSync(new URL('../dist/audio/engine.js',import.meta.url),'utf8').replace(/^import .*\n/gm,'').replace('export class AudioEngine','class AudioEngine').replaceAll('import.meta.url',JSON.stringify('https://example.test/audio/engine.js'))+'\nglobalThis.Engine=AudioEngine;';
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function session(id='recording'){
  const done=deferred();let stops=0;
  return {id,startedAt:12345,stopped:done.promise,stop(){stops++;return done.promise;},get stops(){return stops;},finish(meta={id,status:'complete',bytes:100,chunks:1}){done.resolve(meta);}};
}
function fixture(factory){
  const context={EventTarget,CustomEvent,Float32Array,Map,Array,Promise,Error,Math,URL,setTimeout,clearTimeout,startPersistentRecording:factory};
  vm.runInNewContext(engineSource,context);const engine=new context.Engine();engine.recordDestination={stream:{local:true}};return engine;
}
test('simultaneous starts allocate one recording session and stop waits for startup',async()=>{
  const creation=deferred(),record=session();let creates=0;
  const engine=fixture(()=>{creates++;return creation.promise;}),ended=[];engine.addEventListener('recording-stopped',event=>ended.push(event.detail));
  const first=engine.startRecording(),second=engine.startRecording(),stop=engine.stopRecording();
  assert.equal(creates,1);assert.ok(engine.recordingStarting);creation.resolve(record);
  assert.equal(await first,record);assert.equal(await second,record);await Promise.resolve();
  assert.equal(record.stops,1);assert.equal(engine.recording,true);assert.equal(engine.recordStarted,12345);
  record.finish();assert.equal((await stop).status,'complete');assert.equal(engine.recording,false);assert.equal(ended.length,1);assert.equal(engine.recordingStarting,null);assert.equal(engine.recordingStopping,null);
});
test('automatic interrupted completion clears REC and publishes recovery metadata without stopping decks',async()=>{
  const record=session();let options;
  const engine=fixture((stream,config)=>{assert.equal(stream.local,true);options=config;return Promise.resolve(record);}),events=[],errors=[];
  engine.playing[0]=true;engine.addEventListener('recording-stopped',event=>events.push(event.detail));engine.addEventListener('error',event=>errors.push(event.detail));
  await engine.startRecording();options.onError(new Error('storage full'));record.finish({id:record.id,status:'interrupted',bytes:80,chunks:1});await record.stopped;await Promise.resolve();
  assert.equal(engine.recording,false);assert.equal(engine.playing[0],true);assert.equal(events[0].status,'interrupted');assert.equal(events[0].bytes,80);assert.deepEqual(errors,['storage full']);
});
test('failed start releases its lock so a later retry can record',async()=>{
  const record=session();let calls=0;
  const engine=fixture(()=>{if(++calls===1)return Promise.reject(new Error('quota'));return Promise.resolve(record);});
  await assert.rejects(engine.startRecording(),/quota/);assert.equal(engine.recordingStarting,null);assert.equal(engine.recording,false);
  await engine.startRecording();assert.equal(engine.recording,true);const stop=engine.stopRecording();record.finish();await stop;
});
test('a new start waits for the prior recording to flush before creating its session',async()=>{
  const first=session('first'),second=session('second');let calls=0;
  const engine=fixture(()=>Promise.resolve(++calls===1?first:second));await engine.startRecording();
  const stopping=engine.stopRecording(),starting=engine.startRecording();assert.equal(calls,1);
  first.finish();await stopping;assert.equal(await starting,second);assert.equal(calls,2);assert.equal(engine.recording,true);
  const finalStop=engine.stopRecording();second.finish();await finalStop;
});
