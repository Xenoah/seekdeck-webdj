export function normalizeMobile(raw){return {view:['deck','mixer','library','sampler'].includes(raw?.view)?raw.view:'deck',deck:Number.isInteger(raw?.deck)&&raw.deck>=0&&raw.deck<4?raw.deck:0};}
export function isMobileScreen(){return matchMedia('(max-width: 859px), (pointer: coarse) and (max-width: 1100px)').matches;}
export function mobilePanelVisible(id,state){const m=normalizeMobile(state);return m.view==='deck'?id==='waves'||id===`deck${m.deck}`:id===m.view;}
export function mixerDecks(s,mobile){return mobile?(s.mobile.deck<2?[0,1]:[2,3]):s.preset==='four'||s.layout.deck2.visible||s.layout.deck3.visible?[0,1,2,3]:[0,1];}
