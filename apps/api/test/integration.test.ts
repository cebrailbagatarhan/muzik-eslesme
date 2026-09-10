import { after,before,test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac,randomUUID } from 'node:crypto';
import { once } from 'node:events';
import sharp from 'sharp';
import { fixture,call,user,pair,rateUser,moderator,testPassword,type Fixture } from './helpers.js';
import { DEMO_CATALOG } from '../src/catalog.js';
let f:Fixture;
before(async()=>{f=await fixture();});
after(async()=>{await f?.app.close();await f?.db.close();});
test('anonymous access, under-18 registration and impossible birth dates are rejected',async()=>{
  assert.equal((await call(f,null,'GET','/v1/me')).statusCode,401);
  for(const birthDate of ['2012-01-01','1998-02-30','2099-01-01']){
    const r=await call(f,null,'POST','/v1/auth/register',{email:`${randomUUID()}@example.test`,password:testPassword,displayName:'Deneme',city:'İstanbul',birthDate,acceptedTerms:true});assert.equal(r.statusCode,400,r.body);
  }
});
test('music onboarding, idempotency, pass and undo are enforced through the API',async()=>{
  const u=await user(f),tracks=DEMO_CATALOG.filter(t=>!t.explicit),key=randomUUID();
  assert.equal((await call(f,u,'GET','/v1/people/feed')).json().error.code,'onboarding_required');
  const request={itemId:tracks[0].id,action:'like'};
  assert.equal((await call(f,u,'POST','/v1/music/swipes',request,key)).statusCode,200);
  assert.equal((await call(f,u,'POST','/v1/music/swipes',request,key)).statusCode,200);
  assert.equal((await call(f,u,'POST','/v1/music/swipes',{...request,action:'dislike'},key)).statusCode,409);
  const [history]=await f.db.query('SELECT count(*)::int AS n FROM track_swipe_history WHERE user_id=$1',[u.id]);assert.equal(history.n,1);
  for(const track of tracks.slice(1,20))assert.equal((await call(f,u,'POST','/v1/music/swipes',{itemId:track.id,action:'like'})).statusCode,200);
  assert.equal((await call(f,u,'GET','/v1/me')).json().rated,20);assert.equal((await call(f,u,'GET','/v1/people/feed')).statusCode,200);
  assert.equal((await call(f,u,'POST','/v1/music/swipes/undo',{})).statusCode,200);assert.equal((await call(f,u,'GET','/v1/me')).json().rated,19);
  await call(f,u,'POST','/v1/music/swipes',{itemId:tracks[21].id,action:'pass'});assert.equal((await call(f,u,'GET','/v1/me')).json().rated,19);
});
test('mutual age/city/intent filters and trusted age verification control discovery',async()=>{
  const {a,b}=await pair(f,false);
  let feed=(await call(f,a,'GET','/v1/people/feed')).json().items;assert(feed.some((p:any)=>p.id===b.id));
  await f.db.query('UPDATE profiles SET age_min=70 WHERE user_id=$1',[b.id]);feed=(await call(f,a,'GET','/v1/people/feed')).json().items;assert(!feed.some((p:any)=>p.id===b.id));
  assert.equal((await call(f,a,'POST',`/v1/people/${b.id}/swipes`,{action:'like'})).statusCode,404);
  await f.db.query('UPDATE profiles SET age_min=18,city=$2 WHERE user_id=$1',[b.id,'başka-şehir']);assert(!(await call(f,a,'GET','/v1/people/feed')).json().items.some((p:any)=>p.id===b.id));
  await f.db.query('UPDATE users SET age_verified=false WHERE id=$1',[a.id]);assert.equal((await call(f,a,'GET','/v1/people/feed')).json().error.code,'age_verification_required');
  const body={eventId:randomUUID(),userId:a.id,verified:true,timestamp:Math.floor(Date.now()/1000)};
  assert.equal((await call(f,null,'POST','/v1/verification/age',body)).statusCode,401);
  const signature=createHmac('sha256',f.config.ageSecret).update(`${body.eventId}.${body.userId}.${body.verified}.${body.timestamp}`).digest('hex');
  const verified=await f.app.inject({method:'POST',url:'/v1/verification/age',headers:{'x-verification-signature':signature},payload:body});assert.equal(verified.statusCode,200,verified.body);assert.equal((await call(f,a,'GET','/v1/me')).json().ageVerified,true);
});
test('concurrent reciprocal likes create one match and one-sided likes do not open chat',async()=>{
  const {a,b}=await pair(f,false),responses=await Promise.all([call(f,a,'POST',`/v1/people/${b.id}/swipes`,{action:'like'}),call(f,b,'POST',`/v1/people/${a.id}/swipes`,{action:'like'})]);
  for(const r of responses)assert.equal(r.statusCode,200,r.body);
  const [x,y]=[a.id,b.id].sort(),rows=await f.db.query('SELECT id FROM matches WHERE user_a=$1 AND user_b=$2',[x,y]);assert.equal(rows.length,1);
  const other=await pair(f,false);await call(f,other.a,'POST',`/v1/people/${other.b.id}/swipes`,{action:'like'});assert.equal((await call(f,other.a,'GET','/v1/matches')).json().items.length,0);
});
test('only active match participants can read, send, read-receipt or delete messages',async()=>{
  const {a,b,id}=await pair(f),outsider=await user(f),body='Merhaba, hangi parçayı önerirsin?',key=randomUUID();
  const sent=await call(f,a,'POST',`/v1/matches/${id}/messages`,{body},key);assert.equal(sent.statusCode,200,sent.body);const messageId=sent.json().id;
  assert.equal((await call(f,a,'POST',`/v1/matches/${id}/messages`,{body},key)).json().id,messageId);
  const [stored]=await f.db.query('SELECT body_ciphertext FROM messages WHERE id=$1',[messageId]);assert(!stored.body_ciphertext.includes(body));assert.equal(f.ctx.crypto.open(stored.body_ciphertext,`message:${messageId}`),body);
  for(const method of ['GET','POST'])assert.equal((await call(f,outsider,method,`/v1/matches/${id}/messages`,method==='POST'?{body:'Yabancı mesaj'}:undefined)).statusCode,404);
  assert.equal((await call(f,b,'GET',`/v1/matches/${id}/messages`)).json().items[0].body,body);
  await call(f,b,'POST',`/v1/matches/${id}/read`,{messageId});assert((await call(f,a,'GET',`/v1/matches/${id}/messages`)).json().items[0].readAt);
  assert.equal((await call(f,b,'DELETE',`/v1/matches/${id}/messages/${messageId}`)).statusCode,404);
  assert.equal((await call(f,a,'POST',`/v1/matches/${id}/messages`,{body:'https://spam.example'})).statusCode,400);
  await call(f,a,'DELETE',`/v1/matches/${id}/messages/${messageId}`);assert.equal((await call(f,b,'GET',`/v1/matches/${id}/messages`)).json().items[0].body,null);
  const audit=await f.db.query('SELECT * FROM audit_events WHERE actor_id=ANY($1::uuid[])',[[a.id,b.id]]);assert(!JSON.stringify(audit).includes(body));
});
test('Instagram requires fresh mutual consent, does not leak through cached responses, and resets on handle change',async()=>{
  const {a,b,id}=await pair(f),key=randomUUID(),path=`/v1/matches/${id}/instagram-share`,payload={acknowledgedRisk:true};
  await call(f,a,'PUT','/v1/profile/instagram',{username:'@private_alpha'});await call(f,b,'PUT','/v1/profile/instagram',{username:'private_beta'});
  const one=await call(f,a,'POST',path,payload,key);assert.equal(one.json().state,'REQUESTED');assert(!one.body.includes('private_'));assert(!(await call(f,b,'GET',path)).body.includes('private_'));
  const both=await call(f,b,'POST',path,payload);assert.equal(both.json().state,'MUTUAL');assert(both.body.includes('private_alpha'));assert.equal(both.json().accounts[0].verified,false);
  assert(!(await call(f,a,'GET','/v1/matches')).body.includes('private_'));
  await call(f,b,'DELETE',path);const replay=await call(f,a,'POST',path,payload,key);assert.equal(replay.json().state,'REVOKED');assert(!replay.body.includes('private_'));
  await call(f,a,'POST',path,payload);await call(f,b,'POST',path,payload);await call(f,a,'PUT','/v1/profile/instagram',{username:'changed_alpha'});
  const after=(await call(f,b,'GET',path));assert.equal(after.json().state,'PRIVATE');assert(!after.body.includes('changed_alpha'));
});
test('block revokes chat, Instagram, playlist access and prevents old-message idempotency replay',async()=>{
  const {a,b,id}=await pair(f),key=randomUUID();
  await call(f,a,'POST',`/v1/matches/${id}/messages`,{body:'Eski mesaj'},key);
  const draft=(await call(f,a,'POST',`/v1/matches/${id}/playlist-drafts`,{})).json();
  assert.equal((await call(f,b,'POST','/v1/blocks',{userId:a.id})).statusCode,200);
  for(const path of [`/v1/matches/${id}/messages`,`/v1/matches/${id}/instagram-share`,`/v1/playlist-drafts/${draft.id}`])assert.equal((await call(f,a,'GET',path)).statusCode,404,path);
  assert.equal((await call(f,a,'POST',`/v1/matches/${id}/messages`,{body:'Eski mesaj'},key)).statusCode,404);
  assert.equal((await call(f,a,'GET','/v1/matches')).json().items.length,0);
  await call(f,b,'DELETE',`/v1/blocks/${a.id}`);assert.equal((await call(f,a,'GET',`/v1/matches/${id}/messages`)).statusCode,404);
});
test('playlist read rechecks new negative preferences and edit requires current revision',async()=>{
  const {a,b,id}=await pair(f),draft=(await call(f,a,'POST',`/v1/matches/${id}/playlist-drafts`,{})).json(),path=`/v1/playlist-drafts/${draft.id}`;
  const view=(await call(f,a,'GET',path)).json();assert.equal(view.items.length,25);
  const banned=view.items[0].trackId;await call(f,b,'POST','/v1/music/swipes',{itemId:banned,action:'dislike'});
  const fresh=(await call(f,a,'GET',path)).json();assert(!fresh.items.some((i:any)=>i.trackId===banned));assert.equal(fresh.removedSinceCreation,1);
  const trackIds=fresh.items.map((i:any)=>i.trackId).reverse();assert.equal((await call(f,a,'PUT',path,{revision:fresh.revision,trackIds})).statusCode,200);
  assert.equal((await call(f,b,'PUT',path,{revision:fresh.revision,trackIds})).statusCode,409);
});
test('reporting closes the match; moderator role plus TOTP are required for evidence and decisions',async()=>{
  const {a,b,id}=await pair(f),message=(await call(f,b,'POST',`/v1/matches/${id}/messages`,{body:'İncelenecek örnek içerik'})).json();
  const response=await call(f,a,'POST','/v1/reports',{targetType:'message',targetId:message.id,category:'threat',detail:'Bu içeriği inceleyin.'});assert.equal(response.statusCode,200,response.body);const report=response.json();
  assert.equal((await call(f,b,'GET',`/v1/matches/${id}/messages`)).statusCode,404);assert.equal((await call(f,a,'GET','/v1/admin/reports')).statusCode,403);
  const mod=await moderator(f);assert.equal((await call(f,mod.u,'GET','/v1/admin/reports')).statusCode,200);
  const detail=(await call(f,mod.u,'GET',`/v1/admin/reports/${report.id}`)).json();assert.equal(detail.evidence,'İncelenecek örnek içerik');
  assert.equal((await call(f,mod.u,'POST','/v1/auth/mfa',{code:mod.code})).statusCode,403);
  assert.equal((await call(f,mod.u,'POST',`/v1/admin/reports/${report.id}/actions`,{action:'suspend',note:'Tehdit raporu inceleme kararı.'})).statusCode,200);
  assert.equal((await call(f,b,'GET','/v1/me')).statusCode,401);
  await f.db.query("UPDATE sessions SET mfa_until=now()-interval '1 minute' WHERE user_id=$1",[mod.u.id]);assert.equal((await call(f,mod.u,'GET','/v1/admin/reports')).json().error.code,'mfa_required');
});
test('photos are sanitized, private until approved, and signed URLs still honor blocks',async()=>{
  const {a,b}=await pair(f,false),image=await sharp({create:{width:50,height:50,channels:3,background:'#f37455'}}).png().toBuffer();
  const rejected=await call(f,a,'POST','/v1/profile/photos',{base64:Buffer.from('<svg onload="alert(1)"></svg>').toString('base64'),mimeType:'image/png'});assert.equal(rejected.statusCode,400);
  const uploaded=await call(f,a,'POST','/v1/profile/photos',{base64:image.toString('base64'),mimeType:'image/png'});assert.equal(uploaded.statusCode,200,uploaded.body);const id=uploaded.json().id;
  assert.equal((await call(f,b,'GET',`/v1/profile/photos/${id}/url`)).statusCode,404);
  const mod=await moderator(f);assert.equal((await call(f,mod.u,'POST',`/v1/admin/photos/${id}/review`,{approved:true})).statusCode,200);
  const url=await call(f,b,'GET',`/v1/profile/photos/${id}/url`);assert.equal(url.statusCode,200,url.body);const path=url.json().path;
  const photo=(await call(f,b,'GET',path)).json();assert(photo.dataUrl.startsWith('data:image/jpeg;base64,'));
  const outsider=await user(f);assert.equal((await call(f,outsider,'GET',path)).statusCode,403);
  await call(f,a,'POST','/v1/blocks',{userId:b.id});assert.equal((await call(f,b,'GET',path)).statusCode,404);
});
test('refresh-token reuse revokes the entire session family',async()=>{
  const u=await user(f),first=await call(f,null,'POST','/v1/auth/refresh',{refreshToken:u.refreshToken});assert.equal(first.statusCode,200,first.body);
  assert.equal((await call(f,u,'GET','/v1/me')).statusCode,401);
  const renewed={...u,...first.json()};assert.equal((await call(f,renewed,'GET','/v1/me')).statusCode,200);
  assert.equal((await call(f,null,'POST','/v1/auth/refresh',{refreshToken:u.refreshToken})).statusCode,401);
  assert.equal((await call(f,renewed,'GET','/v1/me')).statusCode,401);
});
test('WebSocket uses a one-use ticket, sends no message content and closes on account deletion',async()=>{
  const {a,b,id}=await pair(f),ticket=(await call(f,a,'POST','/v1/events/ticket',{})).json().ticket;
  const ws=await f.app.injectWS('/v1/events');const ready=once(ws,'message');ws.send(JSON.stringify({ticket}));assert.equal(JSON.parse((await ready)[0].toString()).type,'ready');
  const event=once(ws,'message');await call(f,b,'POST',`/v1/matches/${id}/messages`,{body:'Sokette açık metin olmamalı'});assert.deepEqual(JSON.parse((await event)[0].toString()),{type:'refresh'});
  const replay=await f.app.injectWS('/v1/events');const replayClosed=once(replay,'close');replay.send(JSON.stringify({ticket}));assert.equal((await replayClosed)[0],4001);replay.terminate();
  const closed=once(ws,'close');await call(f,a,'DELETE','/v1/account',{password:testPassword});assert.equal((await closed)[0],4001);ws.terminate();
});
test('account deletion requires reauthentication and cascades personal records and peer access',async()=>{
  const {a,b,id}=await pair(f);await call(f,a,'PUT','/v1/profile/instagram',{username:'to_be_deleted'});await call(f,a,'POST',`/v1/matches/${id}/messages`,{body:'Silinecek mesaj'});
  assert.equal((await call(f,a,'DELETE','/v1/account',{password:'wrong'})).statusCode,401);
  assert.equal((await call(f,a,'DELETE','/v1/account',{password:testPassword})).statusCode,200);
  for(const table of ['users','profiles','sessions','consents','track_swipes','instagram_accounts','oauth_connections','profile_photos']){
    const field=table==='users'?'id':'user_id';assert.equal((await f.db.query(`SELECT 1 FROM ${table} WHERE ${field}=$1`,[a.id])).length,0,table);
  }
  assert.equal((await call(f,b,'GET',`/v1/matches/${id}/messages`)).statusCode,404);assert.equal((await call(f,a,'GET','/v1/me')).statusCode,401);
});
test('per-user MFA rate limit returns 429 with retry information',async()=>{
  const u=await user(f);f.config.rateMultiplier=1;
  try{for(let i=0;i<5;i++)assert.equal((await call(f,u,'POST','/v1/auth/mfa',{code:'000000'})).statusCode,403);const r=await call(f,u,'POST','/v1/auth/mfa',{code:'000000'});assert.equal(r.statusCode,429,r.body);assert(r.headers['retry-after']);}
  finally{f.config.rateMultiplier=1000;}
});
