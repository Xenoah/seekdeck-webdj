import {clamp} from './core.js';
import {advanceBeats,quantizeTrack} from './audio/beatgrid.js';
import {MIDIJog} from './midi-jog.js';

// Hardware operations use the same application methods as the on-screen UI.
export function createControllerActions(a,doc=document){
 const jog=new MIDIJog(a),preparing=new Map();let fxSession,fx;
 const effects=['echo','reverb','flanger'];
 function effectState(){if(fxSession!==a.s){fxSession=a.s;fx={assigned:[true,false],mix:.5,on:false,type:a.s.decks[0].fx.type,beats:a.s.decks[0].fx.beats};}return fx;}
 function applyFX(){
  const state=effectState();
  for(let i=0;i<2;i++){
   const d=a.s.decks[i];d.fx={...d.fx,type:state.type,beats:state.beats,mix:state.on&&state.assigned[i]?state.mix:0};
   a.engine.applyDeck(i,d,a.getTrack(i)?.bpm);a.renderDeck(i);
  }
  a.controllers.feedback('fx.on',state.on);a.save();
 }
 function dispatch(target,value,meta={}){
  const parts=target.split('.'),trigger=meta.pressed??value>0;
  if(parts[0]==='library'){
   const rows=()=>[...doc.querySelectorAll('#track-rows [data-track]')];
   if(parts[1]==='browse'&&meta.relative){
    const list=rows();if(!list.length)return true;
    const current=list.findIndex(row=>row.dataset.track===a.s.selectedTrack);
    const index=clamp((current<0?0:current)+Math.trunc(value),0,list.length-1);
    a.s.selectedTrack=list[index].dataset.track;a.renderRows();
    const row=rows().find(row=>row.dataset.track===a.s.selectedTrack);row?.scrollIntoView({block:'nearest'});a.save();
   }else if(parts[1]==='focus'&&trigger){
    a.navigateMobile({view:'library'});(rows().find(row=>row.dataset.track===a.s.selectedTrack)||rows()[0]||doc.querySelector('#track-search'))?.focus();
   }
   return true;
  }
  if(parts[0]==='fx'){
   const state=effectState(),key=parts[1];
   if(key==='assign0'||key==='assign1')state.assigned[Number(key.at(-1))]=value>0;
   else if(key==='mix')state.mix=clamp(value,0,1);
   else if(!trigger)return true;
   else if(key==='on')state.on=!state.on;
   else if(key==='next'||key==='previous')state.type=effects[(effects.indexOf(state.type)+(key==='next'?1:2))%effects.length];
   else if(key==='beatsHalf'||key==='beatsDouble')state.beats=clamp(state.beats*(key==='beatsHalf'?.5:2),.125,4);
   else return false;
   applyFX();return true;
  }
  if(parts[0]!=='deck')return false;
  const i=Number(parts[1]),key=parts[2],d=a.s.decks[i],t=a.getTrack(i);if(!d)return false;
  if(key==='jog'){
   if(meta.relative)jog.move(i,value,meta);else a.seekDeck(i,value*(t?.duration||0));return true;
  }
  if(key==='scratch'){
   jog.touch(i,value>0);
   if(value>0&&t&&a.engine.loadedIds[i]!==d.trackId){
    // A quick press/release while decoding must not leave the platter held.
    const state=a.s,id=d.trackId,existing=preparing.get(i);
    if(existing?.session===state&&existing.id===id)return existing.promise;
    const entry={session:state,id};preparing.set(i,entry);
    entry.promise=a.ensureBuffer(id).then(()=>{if(a.s===state&&d.trackId===id&&jog.states[i].touch){
     if(a.engine.loadedIds[i]!==id){a.engine.load(i,id,d.position);a.engine.setGrid(i,t);a.engine.applyDeck(i,d,t.bpm);a.refreshSync();}
     jog.touch(i,true,{force:true});
    }}).finally(()=>{if(preparing.get(i)===entry)preparing.delete(i);});
    return entry.promise;
   }
   return true;
  }
  if(!/^(load|master|reloop|loopIn|loopOut|loop4|loopHalf|loopDouble|hotcueDelete[0-7]|beatjump[0-7]|beatloop[0-7])$/.test(key))return false;
  if(!trigger)return true;
  if(key==='load'){if(!a.s.selectedTrack)throw new Error('ライブラリで音源を選んでください。');return a.loadDeck(i,a.s.selectedTrack);}
  if(key==='master')return a.selectMaster(i);
  if(!t)return true;
  if(key==='reloop'){
   if(d.loop.enabled){a.loopDeck(i);return true;}
   if(d.loop.end>d.loop.start){d.loop.enabled=true;a.seekDeck(i,d.loop.start);a.engine.applyDeck(i,d,t.bpm);a.renderDeck(i);a.save();}
   else a.loopDeck(i);
   return true;
  }
  if(key.startsWith('hotcueDelete'))return a.hotcue(i,Number(key.at(-1)),true);
  if(key.startsWith('beatjump')){a.disengageSync(i);a.seekDeck(i,advanceBeats(a.position(i),[-1,1,-2,2,-4,4,-8,8][Number(key.at(-1))],t));return true;}
  if(key==='loopHalf'||key==='loopDouble'){a.resizeLoop(i,key==='loopHalf'?.5:2);return true;}
  if(key==='loop4'||key.startsWith('beatloop')){
   const beats=key==='loop4'?4:[.25,.5,1,2,4,8,16,32][Number(key.at(-1))];
   if(d.loop.enabled&&(key==='loop4'||d.loopBeats===beats)){a.loopDeck(i);return true;}
   d.loopBeats=beats;d.loop.enabled=false;a.loopDeck(i);return true;
  }
  if(key==='loopIn'){d.loop.start=d.quantize?quantizeTrack(a.position(i),t):a.position(i);a.toast('LOOP INを設定',false,1500);a.save();return true;}
  if(key==='loopOut'){
   const end=d.quantize?quantizeTrack(a.position(i),t):a.position(i);
   if(end<=d.loop.start)throw new Error('OUTはINより後に設定してください。');
   d.loop.end=Math.min(end,t.duration);d.loop.enabled=true;a.engine.applyDeck(i,d,t.bpm);a.renderDeck(i);a.save();return true;
  }
  return false;
 }
 return {dispatch,jog,reset:()=>jog.reset()};
}
