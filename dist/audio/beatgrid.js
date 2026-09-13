// Piecewise-constant tempo anchors in seconds. Musical beat numbers in exchange
// files are retained separately from the continuous beat coordinate used here.
const bounded=(n,min,max,fallback)=>Number.isFinite(Number(n))?Math.max(min,Math.min(max,Number(n))):fallback;
export function normalizeTempoMap(input,bpm=120,gridOffset=0){
 const base=bounded(bpm,20,400,120),offset=bounded(gridOffset,0,86400,0);
 const anchors=(Array.isArray(input)?input:[]).slice(0,4096).filter(a=>a&&Number.isFinite(Number(a.time))&&Number.isFinite(Number(a.bpm))&&Number(a.time)>=offset&&Number(a.time)<=86400&&Number(a.bpm)>=20&&Number(a.bpm)<=400).map(a=>({time:Number(a.time),bpm:Number(a.bpm),meter:Math.round(bounded(a.meter,1,32,4)),denominator:[1,2,4,8,16,32].includes(Number(a.denominator))?Number(a.denominator):4,beat:Math.round(bounded(a.beat,1,32,1))})).sort((a,b)=>a.time-b.time);
 const map=[{time:offset,bpm:base,meter:4,denominator:4,beat:1,cumulativeBeat:0}];
 for(const a of anchors){a.beat=Math.min(a.beat,a.meter);const previous=map.at(-1);if(Math.abs(a.time-previous.time)<1e-7){Object.assign(previous,a);continue;}a.cumulativeBeat=previous.cumulativeBeat+(a.time-previous.time)*previous.bpm/60;map.push(a);}
 return map;
}
function anchorAt(map,value,key){let lo=0,hi=map.length-1;while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(map[mid][key]<=value)lo=mid;else hi=mid-1;}return map[lo];}
export function beatAtTime(map,time){const a=anchorAt(map,time,'time');return a.cumulativeBeat+(time-a.time)*a.bpm/60;}
export function timeAtBeat(map,beat){const a=anchorAt(map,beat,'cumulativeBeat');return a.time+(beat-a.cumulativeBeat)*60/a.bpm;}
export function bpmAtTime(map,time){return anchorAt(map,time,'time').bpm;}
const gridCache=new WeakMap(),defaultMap=normalizeTempoMap();
export function trackTempoMap(track){if(!track||typeof track!=='object')return defaultMap;const cached=gridCache.get(track);if(cached&&cached.input===track.tempoMap&&cached.bpm===track.bpm&&cached.offset===track.gridOffset)return cached.map;const map=normalizeTempoMap(track.tempoMap,track.bpm,track.gridOffset);gridCache.set(track,{input:track.tempoMap,bpm:track.bpm,offset:track.gridOffset,map});return map;}
export function parseTempoMap(text,bpm,offset,duration){
 let raw;try{raw=JSON.parse(text.trim()||'[]');}catch{throw new Error('テンポ変更点はJSON配列で入力してください。');}
 if(!Array.isArray(raw)||raw.length>4096)throw new Error('テンポ変更点は4096個以下の配列で入力してください。');
 let previous=-Infinity;for(const a of raw){if(!a||typeof a.time!=='number'||typeof a.bpm!=='number'||!Number.isFinite(a.time)||!Number.isFinite(a.bpm)||a.time<offset||a.time>duration||a.time<=previous||a.bpm<20||a.bpm>400)throw new Error('変更点は最初の拍から曲末までの時刻を昇順にし、BPMは20〜400で入力してください。');const meter=a.meter??4;if(!Number.isInteger(meter)||meter<1||meter>32||(a.beat!=null&&(!Number.isInteger(a.beat)||a.beat<1||a.beat>meter))||(a.denominator!=null&&![1,2,4,8,16,32].includes(a.denominator)))throw new Error('拍子・拍番号が不正です。');previous=a.time;}
 return raw.length?normalizeTempoMap(raw,bpm,offset).map(({cumulativeBeat,...a})=>a):[];
}
export function quantizeTrack(position,track){const map=trackTempoMap(track);return Math.max(0,timeAtBeat(map,Math.round(beatAtTime(map,position))));}
export function advanceBeats(position,beats,track){const map=trackTempoMap(track);return Math.max(0,timeAtBeat(map,beatAtTime(map,position)+beats));}
export function phaseDifference(targetBeat,currentBeat){const difference=targetBeat-currentBeat;return difference-Math.floor(difference+.5);}
