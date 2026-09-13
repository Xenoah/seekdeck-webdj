import {waitForAsync} from './poll.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
export async function runExchange(page,url){
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(url);await page.waitForSelector('[data-panel=library]');
 const xml=fs.readFileSync('tests/fixtures/exchange.xml','utf8'),nml=fs.readFileSync('tests/fixtures/exchange.nml','utf8');
 const formats=await page.evaluate(async({xml,nml})=>{
  const {parseExchange,buildExport}=await import('/seekdeck-webdj/exchange.js'),{api}=await import('/seekdeck-webdj/app.js'),x=parseExchange(xml,'set.xml'),n=parseExchange(nml,'set.nml');
  const t={...api.tracks.get('demo-1'),...x.tracks[0],id:'demo-1',originalLocation:x.tracks[0].path};const a={tracks:new Map([[t.id,t]]),s:{playlists:[{id:'p',name:'夜のセット',folderPath:['Deep','夜'],tracks:[t.id,t.id]}]}};
  const roundtrips=Object.fromEntries(['xml','nml','m3u8','pls','csv','crate'].map(format=>{const out=buildExport(a,format,'p',{base:'C:/Music',crateBase:'C:/'}),back=parseExchange(out.body,out.name);return [format,{tracks:back.tracks.length,sequence:back.playlists[0].tracks.length,folderPath:back.playlists[0].folderPath,cue:back.tracks[0].cues?.[0],end:back.tracks[0].cueDetails?.[0]?.end}];}));
  const multiGrid=parseExchange(nml.replace('   <CUE_V2 NAME="Intro loop"', '   <CUE_V2 NAME="Grid 2" TYPE="4" START="6000" LEN="0" HOTCUE="-1"/>\n   <CUE_V2 NAME="Intro loop"'),'grid.nml');
  const dynamic=parseExchange(xml.replace('   <POSITION_MARK', '   <TEMPO Inizio="7.125" Bpm="140" Metro="3/8" Battito="2"/>\n   <POSITION_MARK'),'tempo.xml');
  const dt={...t,tempoMap:dynamic.tracks[0].tempoMap},dynamicAPI={...a,tracks:new Map([[t.id,dt]])};const dynamicOut=buildExport(dynamicAPI,'xml','p',{base:'C:/Music'}),dynamicBack=parseExchange(dynamicOut.body,'back.xml');let nmlRefused=false;try{buildExport(dynamicAPI,'nml','p',{base:'C:/Music'});}catch(e){nmlRefused=e.message.includes('可変テンポ');}
  let rejects=0;for(const bad of ['<!DOCTYPE x [<!ENTITY y "bad">]><DJ_PLAYLISTS/>','<DJ_PLAYLISTS><bad>'])try{parseExchange(bad,'bad.xml');}catch{rejects++;}
  return {gridMarkers:multiGrid.tracks[0].gridMarkers,dynamicMap:dynamicBack.tracks[0].tempoMap,nmlRefused,xmlFolder:x.playlists[0].folderPath,xmlCue:x.tracks[0].cues[0],xmlColor:x.tracks[0].cueDetails[0].color,xmlOrder:x.playlists[0].tracks,nmlCue:n.tracks[0].cues[0],nmlEnd:n.tracks[0].cueDetails[0].end,nmlGrid:n.tracks[0].gridOffset,nmlRating:n.tracks[0].rating,nmlCount:n.playlists[0].tracks.length,roundtrips,rejects};
 },{xml,nml});
 assert.deepEqual(formats.gridMarkers,[.125,6]);assert.deepEqual(formats.xmlFolder,['Folder']);assert.equal(formats.dynamicMap.length,2);assert.equal(formats.dynamicMap[1].bpm,140);assert.equal(formats.dynamicMap[1].denominator,8);assert.equal(formats.dynamicMap[1].beat,2);assert.equal(formats.nmlRefused,true);for(const f of ['xml','nml'])assert.deepEqual(formats.roundtrips[f].folderPath,['Deep','夜']);
 assert.equal(formats.xmlCue,1.25);assert.equal(formats.xmlColor,'#ff8040');assert.deepEqual(formats.xmlOrder,['12','11','12']);assert.equal(formats.nmlCue,1.25);assert.equal(formats.nmlEnd,3.25);assert.equal(formats.nmlGrid,.125);assert.equal(formats.nmlRating,3);assert.equal(formats.nmlCount,1);assert.equal(formats.rejects,2);
 for(const r of Object.values(formats.roundtrips))assert.equal(r.sequence,2);for(const f of ['xml','nml','csv']){assert.equal(formats.roundtrips[f].cue,1.25);assert.equal(formats.roundtrips[f].end,3.25);}
 // Check cancellation, actual input/import controls, IndexedDB persistence, loop recall, and download bytes.
 await page.locator('[data-action=library-menu]').click();await page.locator('[data-action=exchange]').click();await page.locator('#exchange-file').setInputFiles('tests/fixtures/exchange.xml');
 await page.waitForSelector('[data-action=exchange-apply]');
 assert.equal(await page.evaluate(async()=>{const {api}=await import('/seekdeck-webdj/app.js');return api.tracks.get('demo-1').name;}),'Neon Current');
 await page.getByRole('button',{name:'キャンセル',exact:true}).click();
 await page.locator('#exchange-file').setInputFiles('tests/fixtures/exchange.xml');await page.locator('[data-action=exchange-apply]').click();await page.getByRole('heading',{name:'読み込み完了'}).waitFor();await page.locator('.dialog-head [data-action=close-dialog]').click();
 assert.equal(await page.evaluate(async()=>{const {api}=await import('/seekdeck-webdj/app.js');return api.tracks.get('demo-1').name;}),'夜 & 光');
 await page.locator('[data-panel=deck1] [data-pad="0"]').click();
 await waitForAsync(page,async()=>{const {api}=await import('/seekdeck-webdj/app.js');const d=api.s.decks[1];return d.playing&&d.loop.enabled&&d.loop.start===1.25&&d.loop.end===3.25;});
 await page.locator('[data-panel=deck1] [data-action=play]').click();
 await page.locator('[data-action=library-menu]').click();await page.locator('[data-action=exchange]').click();await page.locator('[data-action=exchange-export-dialog]').click();await page.locator('#exchange-format').selectOption('nml');await page.locator('#exchange-base').fill('C:/Music');
 const [download]=await Promise.all([page.waitForEvent('download'),page.locator('[data-action=exchange-export]').click()]);const path=await download.path(),text=fs.readFileSync(path,'utf8');assert.match(text,/TYPE="5" START="1250" LEN="2000"/);assert.match(text,/NML VERSION="19"/);
 await page.locator('.dialog-head [data-action=close-dialog]').click();await page.waitForTimeout(950);await page.reload();await page.waitForSelector('[data-panel=library]');
 const restored=await page.evaluate(async()=>{const {api}=await import('/seekdeck-webdj/app.js');return {name:api.tracks.get('demo-1').name,end:api.tracks.get('demo-1').cueDetails[0].end,sequence:api.s.playlists.find(p=>p.name==='Night set').tracks,folderPath:api.s.playlists.find(p=>p.name==='Night set').folderPath,playing:api.s.decks.some(d=>d.playing)};});
 assert.deepEqual(restored,{name:'夜 & 光',end:3.25,sequence:['demo-2','demo-1','demo-2'],folderPath:['Folder'],playing:false});
 await page.locator('[data-playlist]').filter({hasText:'Night set'}).click();
 assert.deepEqual(await page.locator('#track-rows tr').evaluateAll(rows=>rows.map(r=>r.dataset.track)),['demo-2','demo-1','demo-2']);
 const mp3=Buffer.from(fs.readFileSync('tests/fixtures/metadata.mp3.base64','utf8'),'base64');
 await page.locator('#audio-files').setInputFiles({name:'metadata-fixture.mp3',mimeType:'audio/mpeg',buffer:mp3});
 await waitForAsync(page,async()=>{const {api}=await import('/seekdeck-webdj/app.js');return [...api.tracks.values()].some(t=>t.filename==='metadata-fixture.mp3')&&!api.importing;});
 const imported=await page.evaluate(async()=>{const {api}=await import('/seekdeck-webdj/app.js');const t=[...api.tracks.values()].find(t=>t.filename==='metadata-fixture.mp3');api.s.selectedTrack=t.id;return {name:t.name,cue:t.cues[0],loop:t.memoryCues[0],bpm:t.bpm};});
 assert.equal(imported.name,'MP3 cues 日本語');assert.equal(imported.cue,.5);assert.equal(imported.loop.seratoSlot,4);assert.equal(imported.loop.locked,true);assert.equal(imported.bpm,128);
 await page.locator('[data-action=library-menu]').click();await page.locator('[data-action=exchange]').click();
 const [copy]=await Promise.all([page.waitForEvent('download'),page.locator('[data-action=exchange-mp3-copy]').click()]);assert.equal(copy.suggestedFilename(),'metadata-fixture-SeekDeck.mp3');
 const {parseAudioMetadata,readID3}=await import('../../dist/audio-metadata.js'),copyBytes=fs.readFileSync(await copy.path());assert.equal(parseAudioMetadata(copyBytes).metadata.cues[0],.5);assert.deepEqual(copyBytes.subarray(readID3(copyBytes).end),mp3.subarray(readID3(mp3).end));
 await page.locator('.dialog-head [data-action=close-dialog]').click();
 await page.evaluate(async()=>{const {api}=await import('/seekdeck-webdj/app.js'),t=api.tracks.get(api.s.selectedTrack);await api.updateTrack({...t,name:'Edited locally',cues:[.625,...t.cues.slice(1)]});});
 await page.locator('#audio-files').setInputFiles({name:'metadata-fixture.mp3',mimeType:'audio/mpeg',buffer:mp3});await page.getByRole('heading',{name:'取り込み結果',exact:true}).waitFor();
 const edited=()=>page.evaluate(async()=>{const {api}=await import('/seekdeck-webdj/app.js'),t=api.tracks.get(api.s.selectedTrack);return {name:t.name,cue:t.cues[0]};});assert.deepEqual(await edited(),{name:'Edited locally',cue:.625});await page.locator('.dialog-head [data-action=close-dialog]').click();
 await page.locator('[data-action=library-menu]').click();await page.locator('[data-action=exchange]').click();await page.locator('[data-action=exchange-mp3-refresh]').click();await page.getByRole('button',{name:'キャンセル',exact:true}).click();assert.equal((await edited()).cue,.625);
 await page.locator('[data-action=library-menu]').click();await page.locator('[data-action=exchange]').click();await page.locator('[data-action=exchange-mp3-refresh]').click();await page.locator('[data-action=exchange-mp3-apply]').click();
 await waitForAsync(page,async()=>{const {api}=await import('/seekdeck-webdj/app.js');return api.tracks.get(api.s.selectedTrack).cues[0]===.5;});assert.equal((await edited()).name,'MP3 cues 日本語');
 assert.deepEqual(errors,[]);console.log('Exchange: independent XML/NML fixtures, tempo maps, hierarchy, six-format roundtrips, tagged MP3 import/copy, preview cancellation, real import/export, hot-loop recall, Unicode, playlist order, and persistence passed.');
}
