import assert from 'node:assert/strict';
import test from 'node:test';
import {normalizeTrack,normalizeSession,defaultSession} from '../dist/core.js';
import {normalizePath,fileURL,createMatcher,writeCSV,parseCSV,parseCSVRows,parseM3U,writeM3U,parsePLS,writePLS,parseCrate,writeCrate,cratePath,writeMatchReport} from '../dist/exchange-core.js';
import {parseExchange,planExchange,applyExchange,buildExport} from '../dist/exchange.js';
const track=(id,path='Music/音,源.wav')=>normalizeTrack({id,filename:path.split('/').pop(),relativePath:path,name:'=SUM(1,2)\n"夜"',artist:'DJ, 音',duration:60,bpm:124,cues:[1.25,null,8],cueDetails:[{type:'loop',end:3.25,name:'Intro',color:'#ff8040'}],memoryCues:[{start:9,type:'cue',name:'Verse'}]});
test('paths retain Unicode and percent characters, and reject ambiguous filenames',()=>{
 const path='C:/音楽/a #50%.wav';assert.equal(normalizePath(fileURL(path)),path);assert.equal(normalizePath('file://localhost/C:/Music/a%20b.wav'),'C:/Music/a b.wav');
 const a=track('a','Music/House/same.wav'),b=track('b','Music/Techno/same.wav'),match=createMatcher([a,b]);
 assert.equal(match('same.wav').status,'ambiguous');assert.equal(match('D:/DJ/Music/House/same.wav').track.id,'a');assert.equal(match('https://example.com/same.wav').status,'unsupported');
 const plan=planExchange(parseM3U('one/x.wav\ntwo/x.wav','set'),[track('x','x.wav')]);assert.equal(plan.counts.ambiguous,2);
});
test('CSV handles quoted newlines, Unicode, semicolons and spreadsheet formula escaping',()=>{
 const t=track('a'),csv=writeCSV([t],{}),parsed=parseCSV(csv,'set').tracks[0];assert.equal(parsed.name,t.name);assert.equal(parsed.artist,t.artist);assert.deepEqual(parsed.cues,t.cues);assert.equal(parsed.cueDetails[0].end,3.25);
 assert.match(csv,/'=SUM/);assert.deepEqual(parseCSVRows('path;title\r\n"x.wav";"one;two"'),[['path','title'],['x.wav','one;two']]);assert.throws(()=>parseCSVRows('path,title\nx.wav,"bad'),/引用符/);
 assert.equal(parseCSV('filename,title,bpm\nx.wav,Normal,128','x').tracks[0].bpm,128);
 const report=writeMatchReport([{source:{path:'https://example.com/a.wav',name:'@danger'},status:'unsupported'}]);assert.match(report,/https/);assert.match(report,/'@danger/);
});
test('M3U and PLS preserve sequence, repeated tracks, and numeric ordering',()=>{
 const a=track('a','a.wav'),b=track('b','b.wav');for(const [write,parse]of [[writeM3U,parseM3U],[writePLS,parsePLS]])assert.deepEqual(parse(write([b,a,b],{}),'set').tracks.map(t=>t.path),['b.wav','a.wav','b.wav']);
 assert.deepEqual(parsePLS('[playlist]\nFile10=z.wav\nFile2=b.wav\nFile1=a.wav','set').tracks.map(t=>t.path),['a.wav','b.wav','z.wav']);
 const s=defaultSession();s.playlists=[{id:'p',name:'Set',tracks:['b','a','b']}];assert.deepEqual(normalizeSession(s).playlists[0].tracks,['b','a','b']);
});
test('Serato crate reads independent big-endian records, including Unicode and unknown fields',()=>{
 const field=(tag,body)=>{const header=Buffer.alloc(8);header.write(tag);header.writeUInt32BE(body.length,4);return Buffer.concat([header,body]);},u=s=>Buffer.from(s,'utf16le').swap16();
 const fixture=Buffer.concat([field('vrsn',u('1.0/Serato ScratchLive Crate')),field('zzzz',Buffer.from([1,2])),field('otrk',field('ptrk',u('Music/日本語.wav')))]);
 assert.equal(parseCrate(fixture,'set').tracks[0].path,'Music/日本語.wav');assert.throws(()=>parseCrate(fixture.subarray(0,fixture.length-1),'bad'),/レコード/);
 const t=track('a','Music/日本語.wav'),encoded=writeCrate([t,t],{});assert.deepEqual(parseCrate(encoded,'set').tracks.map(t=>t.path),['Music/日本語.wav','Music/日本語.wav']);assert.equal(new DataView(encoded.buffer).getUint32(4),56);
 assert.equal(cratePath('C:/Music/日本語.wav','C:/'),'Music/日本語.wav');assert.equal(cratePath('/Users/me/DJ/a.wav','/Users/me/Music'),'../DJ/a.wav');assert.throws(()=>cratePath('D:/a.wav','C:/Music'),/同じドライブ/);
});
test('exchange preview does not mutate tracks; commit preserves transport and survives restore',async()=>{
 const original=track('a','a.wav'),a={tracks:new Map([['a',original]]),s:defaultSession(),async persistExchange(tracks,ps){tracks.forEach(t=>this.tracks.set(t.id,t));this.s.playlists.push(...ps);}};a.s.decks[0].playing=true;
 const parsed=parseExchange('path,title,bpm,cue1\na.wav,Imported,132,2.5','set.csv'),plan=planExchange(parsed,[original]);assert.equal(original.bpm,124);
 await applyExchange(a,plan,true);assert.equal(a.tracks.get('a').bpm,132);assert.equal(a.tracks.get('a').cues[0],2.5);assert.equal(a.s.decks[0].playing,true);assert.equal(a.s.playlists.length,1);assert.equal(original.bpm,124);
 assert.equal(buildExport(a,'m3u8',a.s.playlists[0].id,{}).body.includes('a.wav'),true);
});
test('failed persistence leaves original metadata and playlists untouched',async()=>{
 const original=track('a','a.wav'),a={tracks:new Map([['a',original]]),s:defaultSession(),async persistExchange(){throw new Error('disk full');}};const plan=planExchange(parseCSV('path,bpm\na.wav,145','set'),[original]);await assert.rejects(()=>applyExchange(a,plan),/disk full/);assert.equal(original.bpm,124);assert.equal(a.s.playlists.length,0);
});
test('untrusted loop metadata cannot inject style or exceed the decoded audio',()=>{
 const t=normalizeTrack({...track('a'),cueDetails:[{type:'loop',end:999,color:'red;position:fixed'}],memoryCues:[null,{start:80,end:90,type:'loop'}]});assert.equal(t.cueDetails[0].type,'cue');assert.equal(t.cueDetails[0].color,undefined);assert.deepEqual(t.memoryCues,[]);
});
