let dbPromise;
export function database(){if(!dbPromise)dbPromise=new Promise((resolve,reject)=>{const r=indexedDB.open('orbit-dj-local',1);r.onupgradeneeded=()=>{const d=r.result;d.createObjectStore('tracks',{keyPath:'id'});d.createObjectStore('audio');d.createObjectStore('state');};r.onsuccess=()=>{r.result.onversionchange=()=>r.result.close();resolve(r.result);};r.onerror=()=>reject(r.error);r.onblocked=()=>reject(new Error('別のSeekDeckタブを閉じてから再読み込みしてください。'));});return dbPromise;}
async function op(store,mode,run){const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction(store,mode);let result;try{const r=run(tx.objectStore(store));if(r)r.onsuccess=()=>{result=r.result;};}catch(e){tx.abort();reject(e);return;}tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(tx.error||new Error('保存が中断されました。'));tx.onerror=()=>reject(tx.error);});}
export const getTracks=()=>op('tracks','readonly',s=>s.getAll());
export const putTrack=t=>op('tracks','readwrite',s=>s.put(t));
export const getAudio=id=>op('audio','readonly',s=>s.get(id));
export const getState=()=>op('state','readonly',s=>s.get('session'));
export const putState=s=>op('state','readwrite',o=>o.put(s,'session'));
export async function storeTrack(t,blob){const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction(['tracks','audio'],'readwrite');tx.objectStore('tracks').put(t);tx.objectStore('audio').put(blob,t.id);tx.oncomplete=resolve;tx.onabort=tx.onerror=()=>reject(tx.error);});}
export async function deleteTrack(id){const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction(['tracks','audio'],'readwrite');tx.objectStore('tracks').delete(id);tx.objectStore('audio').delete(id);tx.oncomplete=resolve;tx.onabort=tx.onerror=()=>reject(tx.error);});}
export async function storageInfo(){if(!navigator.storage?.estimate)return null;return await navigator.storage.estimate();}
export function downloadBlob(blob,name){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
export function exportJSON(data,name){downloadBlob(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),name);}
