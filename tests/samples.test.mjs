import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {indexSamples} from '../tools/index-samples.mjs';
import {discoverSampleTracks,fetchSampleAudio,validateSampleCatalog,validateSamplePath,resolveSampleSource,SAMPLE_LIMITS} from '../dist/sample-library.js';

const appURL='https://example.test/seekdeck-webdj/dist/';
const entry=(overrides={})=>({id:'sample-'+'1'.repeat(64),file:'audio/demo.wav',bytes:8,sha256:'a'.repeat(64),name:'Demo',artist:'',...overrides});
const catalog=(tracks=[])=>({format:'seekdeck-samples',version:1,tracks});
async function fixture(){const root=await fs.mkdtemp(path.join(os.tmpdir(),'seekdeck-samples-'));await fs.mkdir(path.join(root,'dist/samples/audio'),{recursive:true});return {root,audio:path.join(root,'dist/samples/audio'),close:()=>fs.rm(root,{recursive:true,force:true})};}

test('indexer creates deterministic catalogs, preserves Unicode and only includes audio',async()=>{
 const f=await fixture();try{
  await fs.mkdir(path.join(f.audio,'日本語'));await fs.writeFile(path.join(f.audio,'README.md'),'ignored');await fs.writeFile(path.join(f.audio,'日本語','作者 - 曲 1.wav'),'audio-one');await fs.writeFile(path.join(f.audio,'other.MP3'),'audio-two');
  const first=await indexSamples({root:f.root}),again=await indexSamples({root:f.root});assert.equal(first.json,again.json);assert.equal(first.catalog.tracks.length,2);const song=first.catalog.tracks.find(t=>t.artist==='作者');assert.equal(song.name,'曲 1');assert.equal(song.file,'audio/日本語/作者 - 曲 1.wav');
  const source=await fs.readFile(path.join(f.root,'dist/samples/catalog.json'),'utf8');assert.equal(source,first.json);
  await fs.writeFile(path.join(f.audio,'日本語','作者 - 曲 1.wav'),'replacement');const changed=await indexSamples({root:f.root});assert.notEqual(changed.catalog.tracks.find(t=>t.artist==='作者').id,song.id);
 }finally{await f.close();}
});
test('indexer rejects symlinks, empty audio and oversized audio without following or hashing them',async()=>{
 const f=await fixture();try{
  await fs.symlink('../catalog.json',path.join(f.audio,'link.wav'));await assert.rejects(indexSamples({root:f.root}),/シンボリック/);await fs.unlink(path.join(f.audio,'link.wav'));
  await fs.writeFile(path.join(f.audio,'empty.wav'),'');await assert.rejects(indexSamples({root:f.root}),/0バイト/);await fs.unlink(path.join(f.audio,'empty.wav'));
  const handle=await fs.open(path.join(f.audio,'large.wav'),'w');await handle.truncate(SAMPLE_LIMITS.fileBytes+1);await handle.close();await assert.rejects(indexSamples({root:f.root}),/50 MiB/);
 }finally{await f.close();}
});
test('symlinked catalog destinations are never overwritten',async()=>{
 const f=await fixture();try{await fs.writeFile(path.join(f.root,'protected.txt'),'protected');await fs.symlink('../../protected.txt',path.join(f.root,'dist/samples/catalog.json'));await assert.rejects(indexSamples({root:f.root}),/通常ファイル/);assert.equal(await fs.readFile(path.join(f.root,'protected.txt'),'utf8'),'protected');}finally{await f.close();}
});
test('path validation rejects external URLs, traversal, encoded separators and unsafe names',()=>{
 for(const file of ['https://evil.test/song.wav','//evil.test/song.wav','audio/../song.wav','audio/./song.wav','audio//song.wav','audio/%2e%2e/song.wav','audio/sub\\song.wav','audio/.hidden.wav','audio/song.wav?x','audio/x#y.wav','audio/ bad.wav','audio/sub /song.wav'])assert.throws(()=>validateSamplePath(file));
 for(const source of ['./samples/audio/../song.wav','./samples/audio/%2e%2e/song.wav','./samples/audio/%252e%252e/song.wav','./samples/audio/sub%2fsong.wav','./samples/audio/song.wav?x=1','https://evil.test/song.wav'])assert.throws(()=>resolveSampleSource(source,appURL));
 assert.equal(resolveSampleSource('./samples/audio/%E6%9B%B2%201.wav',appURL).href,'https://example.test/seekdeck-webdj/dist/samples/audio/%E6%9B%B2%201.wav');
});
test('catalog validation bounds totals, entries and duplicate identities',()=>{
 assert.throws(()=>validateSampleCatalog(catalog([entry(),entry()])));
 assert.throws(()=>validateSampleCatalog(catalog([entry({bytes:SAMPLE_LIMITS.fileBytes+1})])));
 assert.throws(()=>validateSampleCatalog(catalog(Array.from({length:11},(_,i)=>entry({id:'sample-'+i.toString(16).padStart(64,'0'),file:`audio/${i}.wav`,bytes:SAMPLE_LIMITS.fileBytes})))));
 assert.throws(()=>validateSampleCatalog(catalog(Array.from({length:1001},()=>entry()))));
 assert.throws(()=>validateSampleCatalog({...catalog(),version:2}));
});
test('discovery fetches only a bounded same-site catalog and registers deferred audio metadata',async()=>{
 const requests=[],fetchImpl=async(url,options)=>{requests.push({url:String(url),options});return new Response(JSON.stringify(catalog([entry({file:'audio/日本語/曲 1.wav'})])));};
 const tracks=await discoverSampleTracks({appURL,fetchImpl});assert.equal(requests.length,1);assert.equal(requests[0].url,'https://example.test/seekdeck-webdj/dist/samples/catalog.json');assert.equal(requests[0].options.redirect,'error');assert.equal(tracks.length,1);assert.equal(tracks[0].bundled,true);assert.equal(tracks[0].samplePending,true);assert.equal(tracks[0].bpmConfidence,0);assert.equal(tracks[0].duration,0);assert.equal(tracks[0].filename,'曲 1.wav');assert.equal(resolveSampleSource(tracks[0].source,appURL).origin,'https://example.test');
 assert.deepEqual(await discoverSampleTracks({appURL,fetchImpl:async()=>new Response('',{status:404})}),[]);
 await assert.rejects(discoverSampleTracks({appURL,fetchImpl:async()=>new Response('x'.repeat(SAMPLE_LIMITS.catalogBytes+1))}),/1 MiB/);
});
test('audio fetch verifies hash and stream size before returning bytes',async()=>{
 const bytes=Buffer.from('local audio'),hash=createHash('sha256').update(bytes).digest('hex'),track={bundled:true,size:bytes.length,sampleHash:hash,source:'./samples/audio/demo.wav'};let options;
 const audio=await fetchSampleAudio(track,{appURL,fetchImpl:async(url,opts)=>{options=opts;assert.equal(String(url),'https://example.test/seekdeck-webdj/dist/samples/audio/demo.wav');return new Response(bytes);}});assert.deepEqual(Buffer.from(await audio.arrayBuffer()),bytes);assert.equal(options.redirect,'error');
 await assert.rejects(fetchSampleAudio(track,{appURL,fetchImpl:async()=>new Response(Buffer.alloc(bytes.length+1))}),/サイズ/);
 await assert.rejects(fetchSampleAudio(track,{appURL,fetchImpl:async()=>new Response(Buffer.alloc(bytes.length))}),/変更/);
 await assert.rejects(fetchSampleAudio({...track,source:'https://evil.test/demo.wav'},{appURL,fetchImpl:async()=>{throw new Error('must not fetch');}}),/URL/);
});
