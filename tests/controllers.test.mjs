import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {defaultSession} from '../dist/core.js';
import {Controllers,decodeMIDI,relative} from '../dist/controllers.js';
import {validateControllerProfile,DDJ400_PROFILE,validMIDIMapping,validHIDMapping} from '../dist/controller-profiles.js';
const input=(id='left')=>({id,manufacturer:'Test',name:'Same model',state:'connected'});
const mapping=(target='deck.0.play',extra={})=>({target,kind:'note',channel:0,number:11,...extra});
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
