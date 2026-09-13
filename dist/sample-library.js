// Optional repository samples. Catalog discovery does not download or decode audio.
export const SAMPLE_LIMITS=Object.freeze({files:1000,fileBytes:50*1024*1024,totalBytes:512*1024*1024,catalogBytes:1024*1024});
export const SAMPLE_EXTENSION=/\.(wav|mp3|flac|aiff?|m4a|ogg|opus|aac|webm|mp4)$/i;
export function validateSamplePath(file){
 if(typeof file!=='string'||file.length>1000||!file.startsWith('audio/')||!SAMPLE_EXTENSION.test(file)||/[\\%:#?\u0000-\u001f\u007f]/.test(file))throw new Error('サンプルのパスが不正です。audio/ 内の音声ファイルを指定してください。');
 if(file.split('/').some(part=>!part||part==='.'||part==='..'||part.startsWith('.')||part.trim()!==part))throw new Error('サンプルのパスに空の階層、隠しファイル、相対参照は使えません。');
 return file;
}
const encodedPath=file=>file.split('/').map(encodeURIComponent).join('/');
export function sampleSource(file){return './samples/'+encodedPath(validateSamplePath(file));}
export function resolveSampleSource(source,appURL=new URL('.',import.meta.url)){
 if(typeof source!=='string'||!source.startsWith('./samples/audio/'))throw new Error('公開サンプルのURLが不正です。');
 const raw=source.slice('./samples/'.length).split('/').map(part=>{try{return decodeURIComponent(part);}catch{throw new Error('公開サンプルのURLエンコードが不正です。');}}).join('/');
 if(sampleSource(raw)!==source)throw new Error('公開サンプルのURLが正規形式ではありません。');
 const root=new URL('./samples/audio/',appURL),url=new URL(source,appURL);
 if(!['http:','https:'].includes(url.protocol)||url.origin!==root.origin||!url.pathname.startsWith(root.pathname)||url.search||url.hash)throw new Error('同じサイトの samples/audio/ 内だけを読み込めます。');
 return url;
}
export function validateSampleCatalog(raw){
 if(!raw||raw.format!=='seekdeck-samples'||raw.version!==1||!Array.isArray(raw.tracks)||raw.tracks.length>SAMPLE_LIMITS.files)throw new Error('サンプル一覧の形式または曲数が不正です。');
 const ids=new Set(),paths=new Set();let bytes=0;
 const tracks=raw.tracks.map(entry=>{
  if(!entry||typeof entry!=='object')throw new Error('サンプル情報が不正です。');
  const file=validateSamplePath(entry.file);
  if(!/^sample-[a-f0-9]{64}$/.test(entry.id||'')||ids.has(entry.id)||paths.has(file)||!Number.isSafeInteger(entry.bytes)||entry.bytes<=0||entry.bytes>SAMPLE_LIMITS.fileBytes||!/^[a-f0-9]{64}$/.test(entry.sha256||''))throw new Error('サンプルのID、サイズ、ハッシュ、または重複を確認してください。');
  bytes+=entry.bytes;if(bytes>SAMPLE_LIMITS.totalBytes)throw new Error('公開サンプルの合計が512 MiBを超えています。');ids.add(entry.id);paths.add(file);
  return {id:entry.id,file,bytes:entry.bytes,sha256:entry.sha256,name:String(entry.name||file.split('/').at(-1).replace(SAMPLE_EXTENSION,'')).slice(0,500),artist:String(entry.artist||'').slice(0,500)};
 });
 return {format:'seekdeck-samples',version:1,tracks};
}
export async function discoverSampleTracks({fetchImpl=globalThis.fetch,appURL=new URL('.',import.meta.url),signal}={}){
 const catalogURL=new URL('./samples/catalog.json',appURL);
 if(!['http:','https:'].includes(catalogURL.protocol))throw new Error('公開サンプルはHTTPサーバーまたはGitHub Pagesで開いてください。');
 const response=await fetchImpl(catalogURL,{cache:'no-cache',redirect:'error',signal});
 if(response.status===404)return [];
 if(!response.ok)throw new Error('公開サンプルの一覧を読み込めませんでした。');
 const declared=Number(response.headers?.get('content-length'));if(declared>SAMPLE_LIMITS.catalogBytes)throw new Error('サンプル一覧が1 MiBを超えています。');
 // Bound streamed responses too; Content-Length is not always available or truthful.
 const reader=response.body?.getReader();let text;
 if(reader){const chunks=[];let bytes=0;try{while(true){const result=await reader.read();if(result.done)break;bytes+=result.value.byteLength;if(bytes>SAMPLE_LIMITS.catalogBytes)throw new Error('サンプル一覧が1 MiBを超えています。');chunks.push(result.value);}const joined=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){joined.set(chunk,offset);offset+=chunk.byteLength;}text=new TextDecoder().decode(joined);}catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}}
 else{text=await response.text();if(new TextEncoder().encode(text).byteLength>SAMPLE_LIMITS.catalogBytes)throw new Error('サンプル一覧が1 MiBを超えています。');}
 const catalog=validateSampleCatalog(JSON.parse(text));
 return catalog.tracks.map(entry=>{
  const source=sampleSource(entry.file);resolveSampleSource(source,appURL);
  return {id:entry.id,name:entry.name,artist:entry.artist,filename:entry.file.split('/').at(-1),relativePath:'samples/'+entry.file,source,bundled:true,demo:false,sampleHash:entry.sha256,samplePending:true,duration:0,size:entry.bytes,bpm:120,bpmConfidence:0,key:'—',keyConfidence:0,gridOffset:0,cues:Array(8).fill(null),rating:0,comment:'公開サンプル · 初回ロード時にこの端末で解析',addedAt:0};
 });
}
export async function fetchSampleAudio(track,{fetchImpl=globalThis.fetch,appURL=new URL('.',import.meta.url),signal}={}){
 if(track?.bundled!==true||!Number.isSafeInteger(track.size)||track.size<=0||track.size>SAMPLE_LIMITS.fileBytes||!/^[a-f0-9]{64}$/.test(track.sampleHash||''))throw new Error('公開サンプルの情報が不正です。');
 const response=await fetchImpl(resolveSampleSource(track.source,appURL),{redirect:'error',signal});if(!response.ok)throw new Error('公開サンプルを取得できませんでした。ページを更新して一覧を確認してください。');
 const declared=Number(response.headers?.get('content-length'));if(declared>track.size||declared>SAMPLE_LIMITS.fileBytes)throw new Error('公開サンプルのサイズが一覧と一致しません。');
 const reader=response.body?.getReader();let audio;
 if(reader){const chunks=[];let bytes=0;try{while(true){const result=await reader.read();if(result.done)break;bytes+=result.value.byteLength;if(bytes>track.size||bytes>SAMPLE_LIMITS.fileBytes)throw new Error('公開サンプルのサイズが一覧と一致しません。');chunks.push(result.value);}audio=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){audio.set(chunk,offset);offset+=chunk.byteLength;}}catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}}
 else audio=new Uint8Array(await response.arrayBuffer());
 if(audio.byteLength!==track.size)throw new Error('公開サンプルのサイズが一覧と一致しません。');
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',audio)),n=>n.toString(16).padStart(2,'0')).join('');
 if(hash!==track.sampleHash)throw new Error('公開サンプルが変更されています。一覧を再生成してページを更新してください。');
 return new Blob([audio],{type:'application/octet-stream'});
}
