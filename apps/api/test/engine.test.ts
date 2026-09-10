import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { ageOn,vault,totpAt,instagramName } from '../src/security.js';
import { DEMO_CATALOG } from '../src/catalog.js';
import { tasteProfile,compatibility,createPlaylist } from '../src/engine.js';
test('18th birthday, invalid dates and leap-year age checks use calendar dates',()=>{
  const now=new Date('2026-09-09T00:00:00Z');assert.equal(ageOn('2008-09-09',now),18);assert.equal(ageOn('2008-09-10',now),17);assert.equal(ageOn('2000-02-30',now),-1);assert.equal(ageOn('2027-01-01',now),-1);assert.equal(ageOn('2008-02-29',new Date('2026-02-28Z')),17);
});
test('AES-GCM rejects tampering and cross-record ciphertext substitution',()=>{
  const box=vault(randomBytes(32).toString('hex')),encrypted=box.seal('Özel mesaj','message:1');assert.equal(box.open(encrypted,'message:1'),'Özel mesaj');assert.throws(()=>box.open(encrypted,'message:2'));const parts=encrypted.split('.');parts[2]='AAAAAAAAAAAAAAAAAAAAAA';assert.throws(()=>box.open(parts.join('.'),'message:1'));assert(!encrypted.includes('Özel mesaj'));
});
test('TOTP matches RFC 6238 published SHA-1 vector',()=>{assert.equal(totpAt('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',1,8),'94287082');});
test('Instagram names cannot introduce URLs or path escapes',()=>{assert.equal(instagramName('@test.name'),'test.name');for(const value of ['https://evil.test','../bad/name','name?x=y','<script>'])assert.throws(()=>instagramName(value));});
test('matching is deterministic, explained, and penalizes explicitly conflicting preferences',()=>{
  const profile={genres:['Rock'],artists:[],exploration:.5},tracks=DEMO_CATALOG.slice(0,20),base=tracks.map(t=>({item_id:t.id,action:'like'}));
  const a=tasteProfile(DEMO_CATALOG,base,profile),b=tasteProfile(DEMO_CATALOG,base,profile),different=tasteProfile(DEMO_CATALOG,base.map((s,i)=>({...s,action:i<10?'dislike':'like'})),profile);
  assert.deepEqual(compatibility(a,b),compatibility(a,b));assert(compatibility(a,b).musicScore>compatibility(a,different).musicScore);assert.equal(compatibility(a,b).commonTracks,20);assert.equal(compatibility(a,different).conflicts,10);
});
test('playlist excludes dislikes/explicit content, deduplicates recordings, interleaves artists and explains every item',()=>{
  const tracks=[...DEMO_CATALOG,{...DEMO_CATALOG[1],id:'ffffffff-ffff-4fff-8fff-ffffffffffff'}],profile={genres:[],artists:[],exploration:.5};
  const a=tasteProfile(tracks,tracks.slice(0,22).map((t,i)=>({item_id:t.id,action:i===2?'dislike':'like'})),profile),b=tasteProfile(tracks,tracks.slice(8,32).map(t=>({item_id:t.id,action:'favorite'})),profile),items=createPlaylist(tracks,a,b,false);
  assert.equal(items.length,25);assert.deepEqual(items,createPlaylist(tracks,a,b,false));assert(items.every(i=>i.reason.length>0));
  const selected=items.map(i=>tracks.find(t=>t.id===i.trackId)!);assert(selected.every(t=>!t.explicit&&!a.negative.includes(t.id)&&!b.negative.includes(t.id)));assert.equal(new Set(selected.map(t=>t.recording_id)).size,items.length);assert(selected.slice(1).every((t,i)=>t.artist!==selected[i].artist));assert(items.some(i=>i.source==='discovery'));
});
