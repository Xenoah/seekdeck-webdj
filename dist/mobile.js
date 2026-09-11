export function normalizeMobile(raw){return {view:['deck','mixer','library','sampler'].includes(raw?.view)?raw.view:'deck',deck:Number.isInteger(raw?.deck)&&raw.deck>=0&&raw.deck<4?raw.deck:0,surfaces:Array.from({length:4},(_,i)=>['vinyl','pads','tools'].includes(raw?.surfaces?.[i])?raw.surfaces[i]:'vinyl')};}
export function isMobileScreen(){return matchMedia('(max-width: 859px), (pointer: coarse) and (max-width: 1100px)').matches;}
export function isLandscapeScreen(){return isMobileScreen()&&matchMedia('(orientation: landscape) and (min-width: 560px)').matches;}
export function mobilePair(state){return normalizeMobile(state).deck<2?[0,1]:[2,3];}
export function mobilePanelVisible(id,state,landscape=false){const m=normalizeMobile(state);if(landscape&&['deck','mixer'].includes(m.view))return id==='mixer'||mobilePair(m).some(i=>id===`deck${i}`);return m.view==='deck'?id==='waves'||id===`deck${m.deck}`:id===m.view;}
export function mixerDecks(s,mobile){return mobile?(s.mobile.deck<2?[0,1]:[2,3]):s.preset==='four'||s.layout.deck2.visible||s.layout.deck3.visible?[0,1,2,3]:[0,1];}
