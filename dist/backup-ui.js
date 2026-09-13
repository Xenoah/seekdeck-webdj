import {escapeHTML as esc} from './core.js';
import {getAudio,downloadBlob} from './storage.js';
import {listRecordings,getRecording,getRecordingBlob,writeRecording,deleteRecording,recordingFilename} from './recording.js';
import {exportBackup,inspectBackup,restoreBackup} from './backup.js';

const bytes=value=>value>=1073741824?`${(value/1073741824).toFixed(2)} GiB`:`${(value/1048576).toFixed(2)} MiB`;
const progressMarkup=()=>'<p id="backup-progress" role="status" aria-live="polite"></p><p id="backup-error" role="alert"></p>';
const instances=new WeakMap();
const extension=name=>name.slice(name.lastIndexOf('.'));

export function attachBackupUI(a){
  if(instances.has(a))return instances.get(a);
  let busy=false,controller=null,cancellable=false,pending=null,recordings=new Map();
  const fileInput=document.createElement('input');fileInput.type='file';fileInput.accept='.seekdeck,application/x-seekdeck-backup';fileInput.hidden=true;fileInput.dataset.backupInput='true';document.body.append(fileInput);
  const active=id=>Boolean(a.engine.recordingStarting||(a.engine.recording&&(!(a.engine.recordingSession?.id||a.engine.recordingId)||(a.engine.recordingSession?.id||a.engine.recordingId)===id)));
  function updateButtons(){
    document.querySelectorAll('[data-backup-action]').forEach(button=>{
      button.disabled=button.dataset.backupAction==='cancel-work'?!busy||!cancellable:busy||button.dataset.backupLocked==='true';
    });
  }
  function progress(message){const el=document.querySelector('#backup-progress');if(el)el.textContent=message;}
  function onProgress(value){progress(`${value.phase==='verify'?'検証中':'書き出し準備中'}：${value.track}/${value.tracks} 曲 · ${bytes(value.bytes)}`);}
  function report(error){
    if(error?.name==='AbortError'){progress('中止しました。');return;}
    const message=error?.name==='QuotaExceededError'?'端末の空き容量が不足しています。保存先を確認してください。':error?.message||'保存処理に失敗しました。';
    const el=document.querySelector('#backup-error');if(el)el.textContent=message;
    a.toast(message,true,10000);
  }
  async function work(run,{cancel=true}={}){
    if(busy)throw new Error('現在の保存処理が終わるまでお待ちください。');
    busy=true;cancellable=cancel;controller=new AbortController();updateButtons();
    const error=document.querySelector('#backup-error');if(error)error.textContent='';
    try{return await run(controller.signal);}finally{busy=false;cancellable=false;controller=null;updateButtons();}
  }
  async function pickWriter(name,type){
    if(typeof globalThis.showSaveFilePicker!=='function')return null;
    const handle=await globalThis.showSaveFilePicker({suggestedName:name,types:[{description:'SeekDeck ファイル',accept:{[type]:[extension(name)]}}]});
    return handle.createWritable();
  }
  function settingsMarkup(){return `<h3>録音・音源付きバックアップ</h3><div class="dialog-actions"><button class="button" data-backup-action="recordings">保存済み録音</button><button class="button" data-backup-action="export">音源付きバックアップを書き出す</button><button class="button" data-backup-action="import">音源付きバックアップを読み込む</button></div><p>バックアップは音源・キュー・クレート・設定を .seekdeck 形式にまとめます。録音一覧の音声は個別に書き出してください。</p>`;}
  async function showRecordings(){
    const rows=await listRecordings();recordings=new Map(rows.map(row=>[row.id,row]));
    a.modal('保存済み録音',`<p>録音は端末に順次保存されます。未終了の録音も保存済みの範囲を取り出せます。</p>${progressMarkup()}<div class="dialog-actions"><button class="button" data-backup-action="recordings">一覧を更新</button></div>${rows.length?rows.map(row=>{
      const live=active(row.id),name=recordingFilename(row),status=live?'録音中':row.status==='complete'?'完了':'中断・未終了';
      return `<section class="note" data-recording-id="${esc(row.id)}"><strong>${esc(name)}</strong><p>${esc(status)} · ${bytes(row.bytes)} · ${row.chunks} チャンク${row.error?`<br>${esc(row.error)}`:''}</p><div class="dialog-actions"><button class="button" data-backup-action="record-download" data-recording-id="${esc(row.id)}" data-backup-locked="${live||!row.bytes}" ${live||!row.bytes?'disabled':''}>音声を書き出す</button><button class="button danger" data-backup-action="record-delete-confirm" data-recording-id="${esc(row.id)}" data-backup-locked="${live}" ${live?'disabled':''}>削除</button></div></section>`;
    }).join(''):'<p>保存済みの録音はありません。</p>'}<p class="muted">「中断・未終了」はコンテナー終端が欠け、書き出しても再生できない形式があります。</p>`);updateButtons();
  }
  async function saveRecording(id){
    const meta=recordings.get(id);if(!meta)throw new Error('録音一覧を更新してください。');
    if(active(id))throw new Error('録音を停止してから書き出してください。');
    // Call the picker in the original user click before any database awaits.
    const name=recordingFilename(meta),writerPromise=pickWriter(name,meta.mimeType?.split(';')[0]||'audio/webm');
    await work(async()=>{
      progress('録音を書き出しています…');const writable=await writerPromise;
      if(writable)await writeRecording(id,writable);else downloadBlob(await getRecordingBlob(id),name);
      progress(`${name} を書き出しました。`);a.toast('録音を書き出しました。');
    },{cancel:false});
  }
  async function confirmDelete(id){
    if(active(id))throw new Error('録音中のデータは削除できません。');
    const meta=await getRecording(id);if(!meta)throw new Error('録音が見つかりません。');
    a.modal('録音を削除',`<p>${esc(recordingFilename(meta))}</p><p>この端末に保存した録音を削除します。</p><div class="dialog-actions"><button class="button danger" data-backup-action="record-delete" data-recording-id="${esc(id)}">この録音を削除</button><button class="button" data-backup-action="recordings">戻る</button></div>${progressMarkup()}`);
  }
  async function removeRecording(id){
    if(active(id))throw new Error('録音中のデータは削除できません。');
    await work(async()=>{await deleteRecording(id);await showRecordings();a.toast('録音を削除しました。');},{cancel:false});
  }
  async function resolveAudio(track){
    const blob=await getAudio(track.id);if(blob)return blob;
    if(!track.demo||typeof track.source!=='string')return undefined;
    const url=new URL(track.source,import.meta.url),base=new URL('./',import.meta.url);
    if(url.origin!==base.origin||!url.pathname.startsWith(base.pathname)||!['http:','https:'].includes(url.protocol))throw new Error(`音源の場所を確認してください：${track.name}`);
    const response=await fetch(url);if(!response.ok)throw new Error(`付属音源を読み込めません：${track.name}`);
    return response.blob();
  }
  async function saveBackup(){
    if(a.importing)throw new Error('音源の読み込みが終わるまでお待ちください。');
    const name=`SeekDeck-Backup-${new Date().toISOString().slice(0,10)}.seekdeck`,snapshot=a.snapshot(),tracks=structuredClone([...a.tracks.values()]);
    const writerPromise=pickWriter(name,'application/x-seekdeck-backup');
    a.modal('音源付きバックアップ',`<p>元の音源と設定を 1 ファイルにまとめます。</p>${progressMarkup()}<button class="button" data-backup-action="cancel-work">中止</button>`);
    await work(async signal=>{
      progress('保存先を確認しています…');const writable=await writerPromise;
      const output=await exportBackup({tracks,session:snapshot,resolveAudio,writable,signal,onProgress});
      if(output instanceof Blob)downloadBlob(output,name);
      progress(`${tracks.length} 曲のバックアップを書き出しました。`);a.toast('音源付きバックアップを書き出しました。');
    });
  }
  async function previewFile(file){
    pending=null;a.modal('バックアップを検証',`<p>${esc(file.name||'SeekDeck backup')}</p>${progressMarkup()}<button class="button" data-backup-action="cancel-work">中止</button>`);
    await work(async signal=>{
      const archive=await inspectBackup(file,{signal,onProgress}),overlap=archive.tracks.filter(track=>a.tracks.has(track.id)).length;
      pending={file};
      a.modal('バックアップの復元',`<p>${esc(file.name||'SeekDeck backup')}</p><p>${archive.tracks.length} 曲 · ${bytes(file.size)} · 音源の検証が完了しました。</p><p>同じ ID の ${overlap} 曲を更新します。クレートと設定はバックアップの内容になり、デッキは停止します。その他の曲と保存済み録音は保持します。</p><div class="dialog-actions"><button class="button primary" data-backup-action="restore">このバックアップを復元</button><button class="button" data-backup-action="cancel-preview">キャンセル</button></div>${progressMarkup()}`);
    });
  }
  async function applyRestore(){
    if(!pending)throw new Error('バックアップファイルを選んでください。');
    if(a.engine.recording||a.engine.recordingStarting||a.engine.recordingStopping)throw new Error('録音を停止してから復元してください。');
    if(a.importing)throw new Error('音源の読み込みが終わるまでお待ちください。');
    if(typeof a.prepareBackupRestore!=='function'||typeof a.applyBackupArchive!=='function')throw new Error('復元の準備ができていません。ページを再読み込みしてください。');
    const file=pending.file;
    await work(async signal=>{
      let release,committed=false;
      try{
        progress('デッキを停止し、復元の準備をしています…');release=await a.prepareBackupRestore();
        const archive=await restoreBackup(file,{signal,onProgress});committed=true;
        progress('音源と設定を反映しています…');await a.applyBackupArchive(archive);pending=null;
        a.modal('バックアップを復元しました',`<p>${archive.tracks.length} 曲の音源・曲情報・設定を復元しました。出力を確認してから再生してください。</p>${progressMarkup()}`);
        a.toast('音源付きバックアップを復元しました。');
      }catch(error){if(committed)throw new Error('復元データは保存されていますが、画面に反映できませんでした。ページを再読み込みしてください。');throw error;}finally{await release?.();}
    },{cancel:false});
  }
  async function handleClick(event){
    const button=event.target.closest?.('[data-backup-action]');if(!button)return;
    event.preventDefault();const action=button.dataset.backupAction;
    if(action==='cancel-work'){if(cancellable)controller?.abort();return;}
    if(busy){a.toast('現在の保存処理が終わるまでお待ちください。');return;}
    try{
      if(action==='recordings')await showRecordings();
      else if(action==='record-download')await saveRecording(button.dataset.recordingId);
      else if(action==='record-delete-confirm')await confirmDelete(button.dataset.recordingId);
      else if(action==='record-delete')await removeRecording(button.dataset.recordingId);
      else if(action==='export')await saveBackup();
      else if(action==='import'){fileInput.value='';fileInput.click();}
      else if(action==='restore')await applyRestore();
      else if(action==='cancel-preview'){pending=null;a.closeModal();}
    }catch(error){report(error);}
  }
  async function handleFile(){const file=fileInput.files?.[0];fileInput.value='';if(!file)return;try{if(busy)throw new Error('現在の保存処理が終わるまでお待ちください。');await previewFile(file);}catch(error){report(error);}}
  document.addEventListener('click',handleClick);fileInput.addEventListener('change',handleFile);
  const api={settingsMarkup,showRecordings,get busy(){return busy;},destroy(){controller?.abort();document.removeEventListener('click',handleClick);fileInput.removeEventListener('change',handleFile);fileInput.remove();instances.delete(a);}};
  instances.set(a,api);return api;
}
