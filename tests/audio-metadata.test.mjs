import test from 'node:test';
import assert from 'node:assert/strict';
import {parseMarkers2,writeMarkers2,parseLegacyMarkers,writeLegacyMarkers,parseSeratoBeatgrid,writeSeratoBeatgrid} from '../dist/serato-tags.js';
import {readID3,parseAudioMetadata,readAudioMetadata,writeTaggedMP3} from '../dist/audio-metadata.js';
// Construct independently with Node Buffer, not application serializers.
const u32=n=>{const b=Buffer.alloc(4);b.writeUInt32BE(n);return b;};
const syn=n=>Buffer.from([(n>>>21)&127,(n>>>14)&127,(n>>>7)&127,n&127]);
const entry=(type,body)=>Buffer.concat([Buffer.from(type+'\0'),u32(body.length),body]);
function markerFixture(){const cue=Buffer.alloc(12);cue[1]=2;cue.writeUInt32BE(12345,2);cue.set([255,128,64],7);const loop=Buffer.alloc(20);loop[1]=4;loop.writeUInt32BE(2000,2);loop.writeUInt32BE(4000,6);loop.fill(255,10,14);loop.set([39,170,225],15);loop[19]=1;const raw=Buffer.concat([Buffer.from([1,1]),entry('COLOR',Buffer.from([0,17,34,51])),entry('FLIP',Buffer.from([0,1,2,3])),entry('CUE',Buffer.concat([cue,Buffer.from('夜\0')])),entry('LOOP',Buffer.concat([loop,Buffer.from('Loop\0')])),Buffer.from([0])]);return Buffer.concat([Buffer.from([1,1]),Buffer.from(raw.toString('base64')),Buffer.alloc(12)]);}
const id3Frame=(id,body,version=4,flags=0)=>Buffer.concat([Buffer.from(id),version===4?syn(body.length):u32(body.length),Buffer.from([flags>>>8,flags&255]),body]);
const object=(name,body,version=4)=>id3Frame('GEOB',Buffer.concat([Buffer.from('\0application/octet-stream\0\0'+name+'\0'),body]),version);
const audio=Buffer.from([255,251,144,100,0,1,2,3,255,224,5,6,7,8]);
const id3=(frames,version=4,flags=0)=>{const body=Buffer.concat(frames);return Buffer.concat([Buffer.from([73,68,51,version,0,flags]),syn(body.length),body,audio]);};
const mp3=bytes=>new File([bytes],'fixture.mp3',{type:'audio/mpeg'});
const track={filename:'fixture.mp3',name:'新しい曲',artist:'観測者',album:'テスト',genre:'House',key:'Am',comment:'日本語コメント',bpm:120,gridOffset:.125,duration:60,cues:[1.25,null,12.345],cueDetails:[{name:'Start',color:'#8040ff'},null,{name:'夜',color:'#ff8040'}],memoryCues:[{type:'loop',start:2,end:4,name:'Loop',color:'#27aae1',seratoSlot:4,locked:true}]};
test('independent Serato markers decode positions, Unicode, separate loop bank and opaque entries',()=>{
 const data=parseMarkers2(markerFixture());assert.equal(data.cues[2],12.345);assert.equal(data.cueDetails[2].name,'夜');assert.equal(data.cueDetails[2].color,'#ff8040');assert.equal(data.memoryCues[0].start,2);assert.equal(data.memoryCues[0].end,4);assert.equal(data.memoryCues[0].seratoSlot,4);assert.equal(data.memoryCues[0].locked,true);assert.equal(data.cues[4],null);
 const round=parseMarkers2(writeMarkers2(track,data.entries));assert.deepEqual(round.entries.find(e=>e.type==='FLIP').body,new Uint8Array([0,1,2,3]));assert.equal(round.cues[0],1.25);assert.equal(round.memoryCues[0].seratoSlot,4);
 assert.throws(()=>parseMarkers2(new Uint8Array([1,1,64])),/Base64/);
 const bad=Buffer.concat([Buffer.from([1,1]),Buffer.from(Buffer.concat([Buffer.from([1,1]),Buffer.from('CUE\0'),u32(999)]).toString('base64'))]);assert.throws(()=>parseMarkers2(bad),/長さ/);
});
test('legacy Serato positions use 7-bit encoding and override the first five modern slots',()=>{
 const legacy=writeLegacyMarkers(track);assert.deepEqual(Array.from(legacy.subarray(7,11)),[0,0,9,98]); // 1,250 ms = 9*128 + 98
 assert.deepEqual(Array.from(legacy.subarray(22,26)),[4,1,1,127]); // #8040ff
 const data=parseLegacyMarkers(legacy,parseMarkers2(markerFixture()));assert.equal(data.cues[0],1.25);assert.equal(data.cues[2],12.345);assert.equal(data.cueDetails[2].name,'夜');assert.equal(data.memoryCues[0].seratoSlot,4);assert.equal(data.memoryCues[0].start,2);
 const modern=parseMarkers2(writeMarkers2({...track,cues:[9,8,7]}));legacy[6]=127;assert.equal(parseLegacyMarkers(legacy,modern).cues[0],null);
});
test('independent Serato variable-tempo grid derives BPM from beats to next marker',()=>{
 const bytes=Buffer.alloc(23);bytes.set([1,0,0,0,0,2]);bytes.writeFloatBE(.125,6);bytes.writeUInt32BE(8,10);bytes.writeFloatBE(4.125,14);bytes.writeFloatBE(140,18);bytes[22]=55;const map=parseSeratoBeatgrid(bytes);assert.deepEqual(map,[{time:.125,bpm:120,meter:4,beat:1},{time:4.125,bpm:140,meter:4,beat:1}]);assert.deepEqual(parseSeratoBeatgrid(writeSeratoBeatgrid({...track,tempoMap:map})),map);
 assert.throws(()=>writeSeratoBeatgrid({...track,tempoMap:[{time:0,bpm:120},{time:1.1,bpm:140}]}),/拍に/);assert.throws(()=>parseSeratoBeatgrid(bytes.subarray(1)),/形式/);
});
test('MP3 tag copy preserves compressed audio and unrelated artwork and opaque metadata byte-for-byte',async()=>{
 for(const version of [3,4]){const title=version===4?Buffer.concat([Buffer.from([3]),Buffer.from('Original')]):Buffer.concat([Buffer.from([1,255,254]),Buffer.from('Original','utf16le')]);const artwork=id3Frame('APIC',Buffer.from([0,1,2,255,5,6,7]),version),original=id3([id3Frame('TIT2',title,version),artwork,object('Serato Markers2',markerFixture(),version)],version),file=mp3(original);assert.equal(parseAudioMetadata(original).metadata.name,'Original');assert.equal((await readAudioMetadata(file)).metadata.cues[2],12.345);
 const result=new Uint8Array(await (await writeTaggedMP3(file,track)).arrayBuffer()),tag=readID3(result),parsed=parseAudioMetadata(result);assert.equal(parsed.metadata.name,track.name);assert.equal(parsed.metadata.artist,track.artist);assert.equal(parsed.metadata.comment,track.comment);assert.equal(parsed.metadata.cues[0],1.25);assert.equal(parsed.metadata.cues[2],12.345);assert.equal(parsed.metadata.memoryCues[0].seratoSlot,4);assert.deepEqual(parsed.warnings,[]);assert.deepEqual(Buffer.from(result.subarray(tag.end)),audio);assert.deepEqual(Buffer.from(tag.frames.find(f=>f.id==='APIC').raw),artwork);assert.deepEqual(new Uint8Array(await file.arrayBuffer()),new Uint8Array(original));}
});
test('malformed or special ID3 cannot silently overwrite audio, and tag reading stays bounded',async()=>{
 const bad=id3([id3Frame('TIT2',Buffer.from([3,97]))]);bad[17]=255;assert.throws(()=>readID3(bad),/サイズ/);
 const protectedFile=mp3(id3([id3Frame('TIT2',Buffer.from([3,97]),4,4096)]));await assert.rejects(()=>writeTaggedMP3(protectedFile,track),/特殊ID3/);
 const huge=mp3(Buffer.from([73,68,51,4,0,0,127,127,127,127]));const result=await readAudioMetadata(huge);assert.deepEqual(result.metadata,{});assert.match(result.warnings[0],/16 MB/);
 const short=mp3(Buffer.from([73,68,51,4,0,0,0,0,0,12]));assert.match((await readAudioMetadata(short)).warnings[0],/途中/);
 await assert.rejects(()=>writeTaggedMP3(new File([audio],'x.wav'),{...track,filename:'x.wav'}),/MP3/);
});
