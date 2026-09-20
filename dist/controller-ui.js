import {escapeHTML as esc} from './core.js';
import {CONTROLLER_PRESETS} from './controller-profiles.js';

const choices=new WeakMap(),attached=new WeakMap();
const presetDetails={
 'ddj-flx4':{model:'DDJ-FLX4',file:'ddj-flx4.json',download:'SeekDeck-DDJ-FLX4.json',scope:'DDJ-FLX4の公式MIDI表に基づき、選曲・LOAD、ループ、HOT CUE／BEAT LOOP／BEAT JUMP／SAMPLER、SeekDeckのFXに対応。上面タッチはスクラッチ、側面は微調整。Smart CFX／Smart Fader／PAD FX等は未対応。実機検証は未実施です。'},
 'ddj-400-basic':{model:'DDJ-400',file:'ddj-400-basic.json',download:'SeekDeck-DDJ-400-basic.json',scope:'DDJ-400の公式MIDI表に基づく基本操作です。実機検証は未実施。HOT CUEモードで使用してください。選曲・LOAD・SHIFT・専用FXは含みません。'}
};
function state(a){let value=choices.get(a);if(!value){value={preset:'ddj-flx4',input:'',notice:''};choices.set(a,value);}return value;}
function connectedInputs(a){return [...(a.controllers.access?.inputs.values()||[])].filter(input=>input.state!=='disconnected');}
function selectedPreset(selection){return CONTROLLER_PRESETS.find(preset=>preset.id===selection.preset);}
function details(selection){return presetDetails[selection.preset];}
function description(a,selection){
 const preset=selectedPreset(selection);
 if(!preset)return 'プリセットを選び、割り当て先を指定してください。';
 return `現在のMIDI割当 ${(a.s.midiMappings||[]).length}件を、${preset.profile.midiMappings.length}件の${details(selection)?.model||preset.name}割当に置き換えます。必要な割当は先に「マッピングを書き出す」で保存してください。`;
}
function inputOptions(a,selection){
 const inputs=connectedInputs(a),missing=selection.input&&!inputs.some(input=>input.id===selection.input);
 const model=details(selection)?.model;
 return `<option value="" ${!selection.input?'selected':''}>モデル名が一致する全入力${model?`（${esc(model)}）`:''}</option>${inputs.map(input=>`<option value="${esc(input.id)}" ${selection.input===input.id?'selected':''}>${esc(input.manufacturer||'MIDI')} · ${esc(input.name||input.id)}</option>`).join('')}${missing?`<option value="${esc(selection.input)}" selected disabled>選択した入力は切断されています</option>`:''}`;
}

export function controllerPresetMarkup(a){
 const selection=state(a),preset=selectedPreset(selection),info=details(selection),missing=selection.input&&!connectedInputs(a).some(input=>input.id===selection.input);
 return `<section data-controller-presets aria-label="コントローラープリセット">
 <h3>機種別プリセット</h3>
 <label><span>プリセット</span><select data-controller-preset aria-label="コントローラープリセット"><option value="">選択してください</option>${CONTROLLER_PRESETS.map(p=>`<option value="${esc(p.id)}" ${selection.preset===p.id?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label>
 <label><span>割り当て先のMIDI入力</span><select data-controller-input aria-label="プリセットの割り当て先">${inputOptions(a,selection)}</select></label>
 <p data-controller-summary>${esc(description(a,selection))}</p>
 <div class="dialog-actions"><button type="button" class="button primary" data-controller-apply ${!preset||missing?'disabled':''}>既存MIDI割当を置き換えて適用</button><a class="button" data-controller-download ${info?`href="./controller-profiles/${esc(info.file)}" download="${esc(info.download)}"`:'hidden'}>${info?`${esc(info.model)} JSON`:''}</a></div>
 <p data-controller-scope>${esc(info?.scope||'')}</p>
 <p data-controller-result role="status" aria-live="polite">${esc(selection.notice)}</p>
 </section>`;
}

export function attachControllerUI(a){
 if(attached.has(a))return attached.get(a);
 const update=()=>{
  const section=document.querySelector('[data-controller-presets]');if(!section)return;
  const selection=state(a),preset=selectedPreset(selection),info=details(selection);
  section.querySelector('[data-controller-summary]').textContent=description(a,selection);
  section.querySelector('[data-controller-input]').innerHTML=inputOptions(a,selection);
  section.querySelector('[data-controller-apply]').disabled=!preset||!!(selection.input&&!connectedInputs(a).some(input=>input.id===selection.input));
  const download=section.querySelector('[data-controller-download]');download.hidden=!info;
  if(info){download.href=`./controller-profiles/${info.file}`;download.download=info.download;download.textContent=`${info.model} JSON`;}
  else{download.removeAttribute('href');download.removeAttribute('download');download.textContent='';}
  section.querySelector('[data-controller-scope]').textContent=info?.scope||'';
  section.querySelector('[data-controller-result]').textContent=selection.notice;
 };
 const onChange=event=>{
  const select=event.target.closest?.('[data-controller-preset], [data-controller-input]');if(!select)return;
  const selection=state(a);
  if(select.hasAttribute('data-controller-preset'))selection.preset=select.value;
  else selection.input=select.value;
  selection.notice='';update();
 };
 const onClick=event=>{
  const button=event.target.closest?.('[data-controller-apply]');if(!button||button.disabled)return;
  event.preventDefault();
  const selection=state(a),preset=selectedPreset(selection);if(!preset)return;
  button.disabled=true;
  try{
   a.controllers.importProfile(preset.profile,{kind:'midi',...(selection.input?{inputId:selection.input}:{})});
   a.save();selection.notice=`${preset.name} を適用しました。${preset.profile.midiMappings.length}件のMIDI割当を保存しました。`;
  }catch(error){selection.notice=error.message;a.toast(error.message,true);}
  finally{update();}
 };
 document.addEventListener('change',onChange);document.addEventListener('click',onClick);
 a.controllers.addEventListener('devices',update);
 const cleanup=()=>{document.removeEventListener('change',onChange);document.removeEventListener('click',onClick);a.controllers.removeEventListener('devices',update);attached.delete(a);};
 attached.set(a,cleanup);return cleanup;
}
