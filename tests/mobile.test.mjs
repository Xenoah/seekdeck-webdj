import assert from 'node:assert/strict';
import test from 'node:test';
import {normalizeMobile,mobilePanelVisible,mixerDecks} from '../dist/mobile.js';
import {defaultSession,normalizeSession} from '../dist/core.js';
test('mobile view restores independently of desktop layout and SYNC master',()=>{
 const s=defaultSession(),layout=structuredClone(s.layout);s.mobile={view:'library',deck:3,surfaces:['pads','vinyl','tools','vinyl']};s.selectedDeck=1;s.decks[0].playing=true;
 const restored=normalizeSession(s);assert.deepEqual(restored.mobile,s.mobile);assert.deepEqual(restored.layout,layout);assert.equal(restored.selectedDeck,1);assert.equal(restored.decks[0].playing,false);
 assert.deepEqual(mixerDecks(restored,true),[2,3]);assert.deepEqual(mixerDecks(restored,false),[0,1]);
});
test('mobile exposes all decks even if hidden on the desktop',()=>{
 for(let deck=0;deck<4;deck++)assert.deepEqual(['waves','deck0','deck1','deck2','deck3','mixer','library','sampler'].filter(id=>mobilePanelVisible(id,{deck,view:'deck'})),['waves','deck'+deck]);
 assert.deepEqual(normalizeMobile({view:'bad',deck:4}),{view:'deck',deck:0,surfaces:['vinyl','vinyl','vinyl','vinyl']});
});

test('landscape exposes a deck pair and mixer while migrating existing mobile sessions',()=>{
 const ids=['waves','deck0','deck1','deck2','deck3','mixer','library','sampler'];
 for(const view of ['deck','mixer'])for(let deck=0;deck<4;deck++)assert.deepEqual(ids.filter(id=>mobilePanelVisible(id,{deck,view},true)),deck<2?['deck0','deck1','mixer']:['deck2','deck3','mixer']);
 const migrated=normalizeSession({...defaultSession(),mobile:{deck:2,view:'deck'}});
 assert.deepEqual(migrated.mobile,{deck:2,view:'deck',surfaces:['vinyl','vinyl','vinyl','vinyl']});
 assert.deepEqual(normalizeMobile({surfaces:['tools','invalid','pads',null,'pads']}).surfaces,['tools','vinyl','pads','vinyl']);
 assert.deepEqual(ids.filter(id=>mobilePanelVisible(id,{view:'library',deck:1},true)),['library']);
});
