import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {defaultSession} from '../dist/core.js';
import {Controllers,decodeMIDI,relative} from '../dist/controllers.js';
import {validateControllerProfile,DDJ400_PROFILE,DDJFLX4_PROFILE,CONTROLLER_PRESETS,validMIDIMapping,validHIDMapping} from '../dist/controller-profiles.js';
const input=(id='left')=>({id,manufacturer:'Test',name:'Same model',state:'connected'});
const mapping=(target='deck.0.play',extra={})=>({target,kind:'note',channel:0,number:11,...extra});
const flx4Input=(id='flx4')=>({id,manufacturer:'Microsoft Corporation',name:'DDJ-FLX4',state:'connected'});
function setup(mappings=[]){const s=defaultSession(),calls=[];s.midiMappings=mappings;return {s,calls,c:new Controllers(()=>s,(...args)=>calls.push(args))};}

test('malformed MIDI and unsupported messages never enter the mapping engine',()=>{
 for(const data of [[],[0x90,1],[0xb0,1,128],[0x90,-1,10],[0x90,1,NaN],[0x70,1,1],[0xf0,1,1],[0x90,1,1,1]])assert.equal(decodeMIDI(data),null);
 assert.equal(relative(64,'relative-sign'),0);
});
test('profiles validate all rows before replacing live mappings, ignoring executable extras',()=>{
 const old=[mapping()],{s,c}=setup(old);
 assert.throws(()=>c.importProfile({version:1,midiMappings:[mapping(),mapping('deck.9.play')]}),/2 行目/);assert.equal(s.midiMappings,old);
 for(const m of [mapping('deck.0.play',{channel:16}),mapping('deck.0.rate',{kind:'cc',number:32,mode:'cc14'}),mapping('deck.0.play',{mode:'javascript'}),mapping('deck.0.play',{feedback:{kind:'sysex',channel:0,number:0,on:127,off:0}})])assert.equal(validMIDIMapping(m),false);
 const safe=validateControllerProfile(JSON.parse('{"midiMappings":[{"target":"deck.0.play","kind":"note","channel":0,"number":11,"__proto__":{"polluted":true},"script":"alert(1)"}]}'));
 assert.equal(safe.midiMappings[0].script,undefined);assert.equal(Object.hasOwn(safe.midiMappings[0],'__proto__'),false);assert.equal({}.polluted,undefined);
 assert.throws(()=>validateControllerProfile({midiMappings:Array(1001).fill(mapping())}));
 assert.throws(()=>validateControllerProfile({version:2,midiMappings:[]}));
});
test('independent same-model ports have separate press edges and disconnect does not zero faders',()=>{
 const {c,calls}=setup([mapping(),mapping('deck.0.volume',{kind:'cc',number:19})]),a=input('a'),b=input('b');
 c.receive(a,[0x90,11,127]);c.receive(b,[0x90,11,127]);assert.equal(calls[0][2].pressed,true);assert.equal(calls[1][2].pressed,true);
 c.receive(a,[0x80,11,0]);c.receive(b,[0x90,11,127]);assert.equal(calls.at(-1)[2].pressed,false);
 c.receive(a,[0xb0,19,100]);const before=calls.length;c.releaseInput('midi:a');assert.equal(calls.length,before);
 c.receive(a,[0x90,11,127]);assert.equal(calls.at(-1)[2].pressed,true);
});
test('scratch release waits for other holders and disconnect/reset always releases the final holder',()=>{
 const {c,calls}=setup([mapping('deck.0.scratch')]),a=input('a'),b=input('b');
 c.receive(a,[0x90,11,127]);c.receive(b,[0x90,11,127]);const count=calls.length;
 c.receive(a,[0x80,11,0]);assert.equal(calls.length,count);
 c.releaseInput('midi:b');assert.equal(calls.at(-1)[1],0);assert.equal(calls.at(-1)[2].released,true);
 c.receive(a,[0x90,11,127]);c.resetInputState();assert.equal(calls.at(-1)[1],0);
});
test('14-bit CC does not combine different ports, note bytes, or pre-disconnect LSB values',()=>{
 const {c,calls}=setup([mapping('deck.0.rate',{kind:'cc',number:0,mode:'cc14'})]),a=input('a'),b=input('b');
 c.receive(a,[0xb0,0,64]);c.receive(b,[0xb0,32,20]);c.receive(a,[0x90,32,99]);assert.equal(calls.length,0);
 c.receive(a,[0xb0,32,1]);assert.equal(calls.at(-1)[1],8193/16383);
 c.releaseInput('midi:a');const count=calls.length;c.receive(a,[0xb0,0,65]);assert.equal(calls.length,count);
 c.receive(a,[0xb0,32,0]);assert.equal(calls.at(-1)[1],8320/16383);
});
test('FLX4 14-bit CC dispatches one fresh pair across MSB boundaries, in either byte order',()=>{
 const {c,calls}=setup([mapping('deck.0.rate',{kind:'cc',number:0,mode:'cc14'})]),a=flx4Input();
 c.receive(a,[0xb0,0,64]);c.receive(a,[0xb0,32,127]);assert.deepEqual(calls.map(x=>x[1]),[8319/16383]);
 c.receive(a,[0xb0,0,65]);assert.equal(calls.length,1,'new MSB must not use the preceding LSB');
 c.receive(a,[0xb0,32,0]);assert.deepEqual(calls.map(x=>x[1]),[8319/16383,8320/16383]);
 c.receive(a,[0xb0,32,127]);assert.equal(calls.length,2,'new LSB must not use the preceding MSB');
 c.receive(a,[0xb0,0,64]);assert.equal(calls.at(-1)[1],8319/16383);
 c.receive(a,[0xb0,0,63]);c.receive(a,[0xb0,0,62]);assert.equal(calls.length,3);
 c.receive(a,[0xb0,32,0]);assert.equal(calls.at(-1)[1],7936/16383,'most recent pending byte wins');
});
test('one complete 14-bit CC pair can control two targets without duplicate intermediate events',()=>{
 const maps=['deck.0.volume','deck.1.volume'].map(target=>mapping(target,{kind:'cc',number:19,mode:'cc14'})),{c,calls}=setup(maps),a=flx4Input();
 c.receive(a,[0xb0,19,63]);c.receive(a,[0xb0,51,127]);
 assert.deepEqual(calls.map(x=>[x[0],x[1]]),[['deck.0.volume',8191/16383],['deck.1.volume',8191/16383]]);
 c.receive(a,[0xb0,19,64]);assert.equal(calls.length,2);c.receive(a,[0xb0,51,0]);assert.equal(calls.length,4);
});
test('generic 14-bit controllers can continue sending only the changed LSB or MSB',()=>{
 const {c,calls}=setup([mapping('deck.0.rate',{kind:'cc',number:0,mode:'cc14'})]),a=input();
 c.receive(a,[0xb0,0,64]);c.receive(a,[0xb0,32,1]);c.receive(a,[0xb0,32,2]);c.receive(a,[0xb0,32,3]);c.receive(a,[0xb0,0,65]);
 assert.deepEqual(calls.map(x=>x[1]),[8193/16383,8194/16383,8195/16383,8323/16383]);
});
test('inversion also reverses logical press and release edges',()=>{
 const {c,calls}=setup([mapping('deck.0.scratch',{invert:true})]),a=input();
 c.receive(a,[0x90,11,127]);assert.equal(calls.at(-1)[1],0);assert.equal(calls.at(-1)[2].pressed,false);
 c.receive(a,[0x90,11,0]);assert.equal(calls.at(-1)[1],1);assert.equal(calls.at(-1)[2].pressed,true);
 c.receive(a,[0x90,11,127]);assert.equal(calls.at(-1)[2].released,true);
});
test('MIDI unplug/replug clears held state and restores deduplicated LED output',()=>{
 const {s,c,calls}=setup([mapping('deck.0.scratch',{feedback:false}),mapping()]);s.midiFeedback=true;s.midiOutput='out';s.decks[0].playing=true;
 const a=input(),messages=[],out={id:'out',state:'connected',send:bytes=>messages.push(bytes)};c.access={inputs:new Map([[a.id,a]]),outputs:new Map([[out.id,out]])};
 c.attach();assert.deepEqual(messages,[[0x90,11,127]]);c.feedback('deck.0.play',true);assert.equal(messages.length,1);
 c.receive(a,[0x90,11,127]);a.state='disconnected';out.state='disconnected';c.attach();assert.equal(calls.at(-1)[1],0);assert.equal(a.onmidimessage,null);
 a.state='connected';out.state='connected';c.attach();assert.deepEqual(messages.at(-1),[0x90,11,127]);assert.equal(messages.length,2);
 c.receive(a,[0x90,11,127]);assert.equal(calls.at(-1)[2].pressed,true);
});
test('explicit CC feedback uses documented values and handles failed send without poisoning retry',()=>{
 const {s,c}=setup([mapping('deck.0.play',{feedback:{kind:'cc',channel:2,number:45,on:64,off:1}})]);s.midiFeedback=true;s.midiOutput='out';let fail=true;const messages=[];
 c.access={outputs:new Map([['out',{id:'out',send(bytes){if(fail)throw new Error('gone');messages.push(bytes);}}]])};
 c.feedback('deck.0.play',true);fail=false;c.feedback('deck.0.play',true);assert.deepEqual(messages,[[0xb2,45,64]]);c.feedback('deck.0.play',false);assert.deepEqual(messages.at(-1),[0xb2,45,1]);
});
test('DDJ-400 basic profile matches manufacturer bytes and keeps EQ/trim center at zero',()=>{
 const p=validateControllerProfile(DDJ400_PROFILE),{s,c,calls}=setup();c.importProfile(p);
 const a={id:'ddj',name:'DDJ-400',manufacturer:'Pioneer DJ'};
 c.receive(a,[0x91,11,127]);assert.equal(calls.at(-1)[0],'deck.1.play');
 c.receive(a,[0x97,7,127]);assert.equal(calls.at(-1)[0],'deck.0.hotcue7');
 c.receive(a,[0x99,3,127]);assert.equal(calls.at(-1)[0],'deck.1.hotcue3');
 c.receive(a,[0xb0,34,63]);assert.equal(calls.at(-1)[0],'deck.0.jog');assert.equal(calls.at(-1)[1],-1);
 c.receive(a,[0xb0,7,64]);c.receive(a,[0xb0,39,0]);assert.equal(-30+calls.at(-1)[1]*42,0);
 c.receive(a,[0xb0,4,64]);c.receive(a,[0xb0,36,0]);assert.equal(-24+calls.at(-1)[1]*36,0);
 c.receive(a,[0xb6,31,127]);c.receive(a,[0xb6,63,127]);assert.equal(calls.at(-1)[0],'mixer.crossfader');assert.equal(calls.at(-1)[1],1);
 const before=calls.length;c.receive(input('other'),[0x90,11,127]);assert.equal(calls.length,before);
 assert.ok(s.midiMappings.length>40);
});
test('FLX4 profile separates platter, vinyl-off, rim and shifted jog messages in both decks',()=>{
 const {c,calls}=setup();c.importProfile(DDJFLX4_PROFILE);const a=flx4Input();
 for(let deck=0;deck<2;deck++){
  c.receive(a,[0x90+deck,54,127]);assert.equal(calls.at(-1)[0],`deck.${deck}.scratch`);assert.equal(calls.at(-1)[1],1);
  for(const [cc,jogMode]of [[34,'touch'],[33,'bend'],[35,'vinyl-off'],[41,'seek']]){
   for(const [byte,delta]of [[65,1],[63,-1],[68,4]]){
    c.receive(a,[0xb0+deck,cc,byte]);assert.deepEqual(calls.at(-1),[`deck.${deck}.jog`,delta,{relative:true,pressed:true,jogMode}]);
   }
   const count=calls.length;c.receive(a,[0xb0+deck,cc,64]);assert.equal(calls.length,count);
  }
  c.receive(a,[0x80+deck,103,0]);assert.equal(calls.at(-1)[1],0);assert.equal(calls.at(-1)[2].released,true,'SHIFT state may change before release');
 }
 const count=calls.length;c.receive(input(),[0xb0,34,65]);assert.equal(calls.length,count,'preset does not capture other controllers');
});
test('FLX4 normal and SHIFT touch share one sensor while other MIDI ports retain their own holds',()=>{
 const {c,calls}=setup();c.importProfile(DDJFLX4_PROFILE);const a=flx4Input('a'),b=flx4Input('b');
 c.receive(a,[0x90,54,127]);c.receive(a,[0x90,103,127]);assert.equal(calls.at(-1)[2].pressed,false);
 c.receive(b,[0x90,54,127]);const count=calls.length;c.receive(a,[0x80,103,0]);assert.equal(calls.length,count);
 c.receive(b,[0x80,103,0]);assert.equal(calls.at(-1)[1],0);assert.equal(calls.at(-1)[2].released,true);
 c.receive(a,[0x90,103,127]);c.receive(a,[0x80,54,0]);assert.equal(calls.at(-1)[1],0);assert.equal(calls.at(-1)[2].released,true);
});
test('FLX4 mapping uses paired full resolution faders and exact musical knob centers',()=>{
 const {c,calls}=setup();c.importProfile(DDJFLX4_PROFILE);const a=flx4Input();
 for(let deck=0;deck<2;deck++)for(const [cc,target,center]of [[0,'rate',.5],[4,'gain',2/3],[7,'high',5/7],[11,'mid',5/7],[15,'low',5/7],[19,'volume',8192/16383]]){
  const count=calls.length;c.receive(a,[0xb0+deck,cc,64]);assert.equal(calls.length,count);
  c.receive(a,[0xb0+deck,cc+32,0]);assert.equal(calls.at(-1)[0],`deck.${deck}.${target}`);assert.equal(calls.at(-1)[1],center);
 }
 for(const [cc,target]of [[23,'deck.0.filter'],[24,'deck.1.filter'],[31,'mixer.crossfader']]){
  c.receive(a,[0xb6,cc,64]);c.receive(a,[0xb6,cc+32,0]);assert.equal(calls.at(-1)[0],target);assert.equal(calls.at(-1)[1],.5);
 }
 c.receive(a,[0xb1,19,127]);c.receive(a,[0xb1,51,127]);assert.equal(calls.at(-1)[1],1);
 c.receive(a,[0xb1,19,0]);c.receive(a,[0xb1,51,0]);assert.equal(calls.at(-1)[1],0);
});
test('FLX4 transport, library, shift-delete, loops, pads and FX match the documented MIDI bytes',()=>{
 const {c,calls}=setup();c.importProfile(DDJFLX4_PROFILE);const a=flx4Input();
 const notes=[
  [0x90,11,'deck.0.play'],[0x91,12,'deck.1.cue'],[0x90,88,'deck.0.sync'],[0x91,96,'deck.1.master'],
  [0x90,16,'deck.0.loopIn'],[0x91,17,'deck.1.loopOut'],[0x90,77,'deck.0.loop4'],[0x91,80,'deck.1.reloop'],[0x90,81,'deck.0.loopHalf'],[0x91,83,'deck.1.loopDouble'],
  [0x96,70,'deck.0.load'],[0x96,71,'deck.1.load'],[0x96,65,'library.focus'],
  [0x97,7,'deck.0.hotcue7'],[0x9a,3,'deck.1.hotcueDelete3'],[0x99,32,'deck.1.beatjump0'],[0x97,103,'deck.0.beatloop7'],[0x99,55,'sampler.7'],
  [0x94,99,'fx.next'],[0x94,100,'fx.previous'],[0x94,74,'fx.beatsHalf'],[0x94,75,'fx.beatsDouble'],[0x95,71,'fx.on']
 ];
 for(const [status,number,target]of notes){c.receive(a,[status,number,127]);assert.equal(calls.at(-1)[0],target,`${status.toString(16)} ${number}`);}
 c.receive(a,[0xb6,64,127]);assert.deepEqual(calls.at(-1),['library.browse',-1,{relative:true,pressed:true}]);
 c.receive(a,[0xb6,100,2]);assert.equal(calls.at(-1)[1],2);
 // FX CH SELECT emits all four notes; only A's 0x10 and B's 0x11 are active flags.
 const count=calls.length;for(const bytes of [[0x94,16,127],[0x94,17,0],[0x95,16,0],[0x95,17,127]])c.receive(a,bytes);
 assert.deepEqual(calls.slice(count).map(x=>[x[0],x[1]]),[['fx.assign0',1],['fx.assign1',1]]);
 c.receive(a,[0x94,16,0]);assert.equal(calls.at(-1)[1],0);assert.equal(calls.at(-1)[2].released,true);
 c.receive(a,[0xb4,2,64]);c.receive(a,[0xb4,34,0]);assert.equal(calls.at(-1)[0],'fx.mix');assert.equal(calls.at(-1)[1],8192/16383);
});
test('FLX4 MIDI Learn skips touch notes and learns all jog surfaces with their companion touch controls',()=>{
 const {s,c,calls}=setup([mapping('deck.2.jog',{kind:'cc',number:34,mode:'relative-twos'}),mapping()]),a=flx4Input();c.learning=true;c.arm('deck.2.jog');
 c.receive(a,[0x91,54,127]);assert.equal(c.target,'deck.2.jog');
 c.receive(a,[0xb1,34,64]);assert.equal(c.target,'deck.2.jog');
 c.receive(a,[0xb1,34,63]);assert.equal(c.target,null);
 const wheel=s.midiMappings.filter(x=>x.target==='deck.2.jog');assert.equal(wheel.length,4);assert.ok(wheel.every(x=>x.mode==='relative-offset'&&x.channel===1&&x.inputId===a.id));
 assert.deepEqual(wheel.map(x=>[x.number,x.jogMode]),[[34,'touch'],[33,'bend'],[35,'vinyl-off'],[41,'seek']]);
 assert.deepEqual(s.midiMappings.filter(x=>x.target==='deck.2.scratch').map(x=>x.number),[54,103]);assert.ok(s.midiMappings.some(x=>x.target==='deck.0.play'));
 c.receive(a,[0xb1,34,63]);assert.equal(calls.at(-1)[1],-1);
 c.receive(a,[0xb1,33,65]);assert.equal(calls.at(-1)[2].jogMode,'bend');
 c.receive(a,[0x91,54,127]);assert.equal(calls.at(-1)[0],'deck.2.scratch');c.releaseInput('midi:flx4');assert.equal(calls.at(-1)[1],0);
});
test('FLX4 MIDI Learn normalizes fader LSBs and retains center calibration, including a zero byte',()=>{
 const {s,c,calls}=setup(),a=flx4Input();c.learning=true;c.arm('deck.1.volume');
 c.receive(a,[0xb1,51,0]);assert.equal(c.target,null);assert.equal(s.midiMappings[0].number,19);assert.equal(s.midiMappings[0].mode,'cc14');
 c.receive(a,[0xb1,19,64]);assert.equal(calls.length,0);c.receive(a,[0xb1,51,0]);assert.equal(calls.at(-1)[1],8192/16383);
 c.arm('deck.0.gain');c.receive(a,[0xb0,36,1]);const gain=s.midiMappings.find(x=>x.target==='deck.0.gain');assert.equal(gain.number,4);assert.equal(gain.center,2/3);
 c.arm('deck.0.scratch');c.receive(a,[0xb0,34,65]);assert.equal(c.target,'deck.0.scratch');c.receive(a,[0x90,54,127]);assert.equal(c.target,null);
 const touch=s.midiMappings.find(x=>x.target==='deck.0.scratch');assert.equal(touch.kind,'note');assert.equal(touch.mode,'absolute');assert.equal(touch.feedback,false);
});
test('unrecognized devices keep generic two\'s-complement MIDI Learn behavior',()=>{
 const {s,c,calls}=setup(),a=input();c.learning=true;c.arm('deck.0.jog');c.receive(a,[0xb0,20,127]);
 assert.equal(s.midiMappings[0].mode,'relative-twos');assert.equal(s.midiMappings[0].jogMode,undefined);
 c.receive(a,[0xb0,20,127]);assert.equal(calls.at(-1)[1],-1);
});
test('MIDI Learn still forwards releases that cannot be learned so held controls never get trapped',()=>{
 const {c,calls}=setup([mapping('deck.0.scratch')]),a=input();
 c.receive(a,[0x90,11,127]);c.learning=true;c.arm('deck.1.play');c.receive(a,[0x80,11,0]);
 assert.equal(c.target,'deck.1.play');assert.equal(calls.at(-1)[0],'deck.0.scratch');assert.equal(calls.at(-1)[1],0);assert.equal(calls.at(-1)[2].released,true);
});
test('jog behavior metadata validates, round-trips and reaches the dispatcher without changing pulse counts',()=>{
 const m=mapping('deck.0.jog',{kind:'cc',number:34,mode:'relative-offset',jogMode:'touch',sensitivity:.5});
 for(const extra of [{jogMode:'eval'},{sensitivity:NaN},{sensitivity:Infinity},{sensitivity:0},{sensitivity:11},{target:'deck.0.volume'},{mode:'absolute'}])assert.equal(validMIDIMapping({...m,...extra}),false);
 const p=validateControllerProfile({midiMappings:[{...m,executable:'ignored'}]});assert.equal(p.midiMappings[0].jogMode,'touch');assert.equal(p.midiMappings[0].sensitivity,.5);assert.equal(p.midiMappings[0].executable,undefined);
 const {c,calls}=setup(p.midiMappings);c.receive(input(),[0xb0,34,66]);assert.deepEqual(calls.at(-1),['deck.0.jog',2,{relative:true,pressed:true,jogMode:'touch',sensitivity:.5}]);
});
test('profile can bind to one selected MIDI port without affecting a same-model second unit',()=>{
 const {s,c,calls}=setup(),a=input('a'),b=input('b');c.access={inputs:new Map([[a.id,a],[b.id,b]]),outputs:new Map()};
 c.importProfile(DDJ400_PROFILE,{inputId:a.id});assert.equal(s.midiMappings[0].inputId,'a');
 c.receive(b,[0x90,11,127]);assert.equal(calls.length,0);c.receive(a,[0x90,11,127]);assert.equal(calls.length,1);
});
test('HID validation rejects invalid layouts and keeps separate device held states',()=>{
 const map={target:'deck.0.scratch',vendorId:1,productId:2,reportId:1,offset:0,encoding:'uint8',min:0,max:1};
 assert.equal(validHIDMapping({...map,max:0}),false);assert.equal(validHIDMapping({...map,offset:-1}),false);assert.equal(validHIDMapping({...map,encoding:'eval'}),false);
 const {s,c,calls}=setup();s.hidMappings=[map];const a={vendorId:1,productId:2},b={vendorId:1,productId:2};
 const send=(device,value)=>c.receiveHID({device,reportId:1,data:new DataView(Uint8Array.of(value).buffer)});
 send(a,1);send(b,1);const count=calls.length;send(a,0);assert.equal(calls.length,count);c.releaseInput(c.hidKeys.get(b));assert.equal(calls.at(-1)[1],0);
});
test('downloadable DDJ-400 profile exactly matches the built-in profile',async()=>{
 const profile=JSON.parse(await readFile(new URL('../dist/controller-profiles/ddj-400-basic.json',import.meta.url),'utf8'));
 assert.deepEqual(profile,DDJ400_PROFILE);
});
test('FLX4 is the first preset and its downloadable mapping matches the validated built-in profile',async()=>{
 assert.equal(CONTROLLER_PRESETS[0].id,'ddj-flx4');assert.equal(CONTROLLER_PRESETS[0].profile,DDJFLX4_PROFILE);
 const profile=JSON.parse(await readFile(new URL('../dist/controller-profiles/ddj-flx4.json',import.meta.url),'utf8'));
 assert.deepEqual(profile,DDJFLX4_PROFILE);assert.equal(validateControllerProfile(profile).midiMappings.length,147);
});
