// Independently transcribed from AlphaTheta's DDJ-FLX4 MIDI message list v1.0.
// https://downloads.support.alphatheta.com/software_info/dj-controllers/DDJ-FLX4/DDJ-FLX4_MIDI_message_List_E1.pdf
// MIDI channels below are zero based. Keep this data module independent of core.js.
const midiMappings=[];
const add=(target,kind,channel,number,extra={})=>midiMappings.push({target,kind,channel,number,mode:'absolute',deviceName:'DDJ-FLX4',...extra});

for(let d=0;d<2;d++){
 for(const [target,number]of [['play',11],['cue',12],['sync',88],['master',96],['cueOn',84],['loopIn',16],['loopOut',17]])add(`deck.${d}.${target}`,'note',d,number);
 for(const [target,number]of [['loop4',77],['reloop',80],['loopHalf',81],['loopDouble',83]])add(`deck.${d}.${target}`,'note',d,number,{feedback:false});
 // The capacitive platter and its side send distinct messages. Never decode these
 // as two's complement: 0x41 is +1, 0x3f is -1, and 0x40 is stationary.
 for(const number of [54,103])add(`deck.${d}.scratch`,'note',d,number,{feedback:false});
 for(const [number,jogMode]of [[34,'touch'],[33,'bend'],[35,'vinyl-off'],[41,'seek']])add(`deck.${d}.jog`,'cc',d,number,{mode:'relative-offset',jogMode});
 for(const [target,number,center]of [['rate',0,.5],['volume',19,undefined],['gain',4,2/3],['high',7,5/7],['mid',11,5/7],['low',15,5/7]])add(`deck.${d}.${target}`,'cc',d,number,{mode:'cc14',...(center===undefined?{}:{center})});
 add(`deck.${d}.filter`,'cc',6,23+d,{mode:'cc14',center:.5});
 add(`deck.${d}.load`,'note',6,70+d,{feedback:false});
 for(let pad=0;pad<8;pad++){
  const channel=7+d*2;
  add(`deck.${d}.hotcue${pad}`,'note',channel,pad);
  add(`deck.${d}.hotcueDelete${pad}`,'note',channel+1,pad,{feedback:false});
  add(`deck.${d}.beatjump${pad}`,'note',channel,32+pad,{feedback:false});
  add(`deck.${d}.beatloop${pad}`,'note',channel,96+pad,{feedback:false});
  add(`sampler.${pad}`,'note',channel,48+pad,{feedback:false});
 }
}
for(const [target,number]of [['crossfader',31],['master',8],['cueMix',12],['headphone',13]])add(`mixer.${target}`,'cc',6,number,{mode:'cc14',...(target==='crossfader'?{center:.5}:{})});
for(const number of [64,100])add('library.browse','cc',6,number,{mode:'relative-twos'});
for(const number of [65,66])add('library.focus','note',6,number,{feedback:false});

// The selector emits four notes. Only these two carry the active A/B flags;
// the other two are always zero. Handle releases too to distinguish A/B/both.
add('fx.assign0','note',4,16,{feedback:false});
add('fx.assign1','note',5,17,{feedback:false});
for(const [target,number]of [['next',99],['previous',100],['beatsHalf',74],['beatsDouble',75]])add(`fx.${target}`,'note',4,number,{feedback:false});
// LEVEL/DEPTH uses status B4 (the channel column of the manufacturer's PDF is
// inconsistent). Mixxx's DDJ-FLX4 mapping independently confirms B4 CC 2/34.
add('fx.mix','cc',4,2,{mode:'cc14'});
for(const channel of [4,5])add('fx.on','note',channel,71,{feedback:false});

export const DDJFLX4_PROFILE={format:'seekdeck-controller',version:1,name:'Pioneer DJ DDJ-FLX4',midiMappings};

export const isDDJFLX4=input=>/^DDJ-FLX4(?:\s|$)/i.test((input.name||'').trim());

// Use the known protocol even when MIDI Learn sees the LSB before the MSB.
// Match by channel as jog CCs 33/34/35 are not 14-bit fader LSBs on deck channels.
export function flx4MessageMapping(message){
 return midiMappings.find(m=>m.kind===message.kind&&m.channel===message.channel&&(m.number===message.number||m.mode==='cc14'&&m.number+32===message.number));
}
