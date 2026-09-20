import {clamp} from './core.js';

// Calibration reference: Mixxx's FLX4 mapping uses 720 ticks / revolution at
// 33 1/3 RPM (1.8 seconds / revolution). This is not a manufacturer guarantee.
export const JOG_SECONDS_PER_TICK=1.8/720;
export class MIDIJog {
 constructor(api,{schedule=(fn,ms)=>setTimeout(fn,ms),cancel=id=>clearTimeout(id)}={}){
  this.api=api;this.schedule=schedule;this.cancel=cancel;
  this.states=Array.from({length:4},()=>({touch:false,vinyl:true,timer:null,bending:false}));
 }
 restore(i){const state=this.states[i];this.cancel(state.timer);state.timer=null;if(state.bending){state.bending=false;this.api.engine.applyDeck(i,this.api.s.decks[i],this.api.getTrack(i)?.bpm);}}
 touch(i,active,{force=false}={}){if(!force&&this.states[i].touch===active)return;this.restore(i);this.states[i].touch=active;this.api.engine.scratch(i,active&&this.states[i].vinyl,0);}
 move(i,delta,{jogMode,sensitivity=1}={}){
  if(!Number.isFinite(delta)||!delta)return;
  const a=this.api,state=this.states[i],d=a.s.decks[i],amount=delta*(Number.isFinite(sensitivity)&&sensitivity>0?Math.min(sensitivity,10):1);
  if(jogMode==='seek'){
   this.restore(i);a.seekDeck(i,a.position(i)+amount*JOG_SECONDS_PER_TICK*16);return;
  }
  if(jogMode==='vinyl-off'&&state.vinyl){state.vinyl=false;a.engine.scratch(i,false);}
  else if(jogMode==='touch'&&!state.vinyl){state.vinyl=true;if(state.touch){this.restore(i);a.engine.scratch(i,true,0);}}
  if(state.touch&&state.vinyl){
   // FLX4 rim / vinyl-off packets must never enter the scratch path, even if
   // the top touch switch is held or firmware sends both rotation reports.
   if(jogMode!=='bend')a.engine.scratchMove(i,amount*JOG_SECONDS_PER_TICK);
   return;
  }
  if(d.playing){
   this.cancel(state.timer);a.disengageSync(i);state.bending=true;
   a.engine.applyDeck(i,{...d,rate:d.rate*(1+clamp(amount*.006,-.08,.08))},a.getTrack(i)?.bpm);
   state.timer=this.schedule(()=>this.restore(i),90);
  }else a.seekDeck(i,a.position(i)+amount*JOG_SECONDS_PER_TICK);
 }
 reset(i){for(const deck of i===undefined?[0,1,2,3]:[i]){this.restore(deck);this.states[deck].touch=false;this.api.engine.scratch(deck,false);}}
}
