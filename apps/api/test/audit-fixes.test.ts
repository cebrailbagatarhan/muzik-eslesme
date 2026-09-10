import { after,before,test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import sharp from 'sharp';
import { call,fixture,moderator,pair,testPassword,user,type Fixture } from './helpers.js';

let f:Fixture;
before(async()=>{f=await fixture();});
after(async()=>{await f?.app.close();await f?.db.close();});

test('optional consent version is controlled by the server',async()=>{
  const u=await user(f);
  const response=await call(f,u,'PUT','/v1/consents/product-analytics',{granted:true,version:'client-forged-version'});
  assert.equal(response.statusCode,200,response.body);
  assert.equal(response.json().version,'2026-09-v1');
  const [row]=await f.db.query("SELECT version FROM consents WHERE user_id=$1 AND kind='product-analytics' AND revoked_at IS NULL",[u.id]);
  assert.equal(row.version,'2026-09-v1');
});

test('beta age verification requires and applies signed provider birth date',async()=>{
  const u=await user(f);
  await f.db.query('UPDATE users SET age_verified=false,birth_date=$2 WHERE id=$1',[u.id,'1998-04-10']);
  const previousMode=f.config.mode;f.config.mode='beta';
  try{
    const timestamp=Math.floor(Date.now()/1000),eventId='provider-event-000001';
    const missing={eventId,userId:u.id,verified:true,timestamp};
    assert.equal((await call(f,null,'POST','/v1/verification/age',missing)).statusCode,400);
    const birthDate='1996-02-03',body={eventId:'provider-event-000002',userId:u.id,verified:true,birthDate,timestamp};
    const signature=createHmac('sha256',f.config.ageSecret).update(`${body.eventId}.${body.userId}.${body.verified}.${body.birthDate}.${body.timestamp}`).digest('hex');
    const verified=await f.app.inject({method:'POST',url:'/v1/verification/age',headers:{'x-verification-signature':signature},payload:body});
    assert.equal(verified.statusCode,200,verified.body);
    const [row]=await f.db.query('SELECT age_verified,birth_date FROM users WHERE id=$1',[u.id]);
    assert.equal(row.age_verified,true);assert.equal(String(row.birth_date).slice(0,10),birthDate);
  }finally{f.config.mode=previousMode;}
});

test('one suspension action can only be appealed once',async()=>{
  const {a,b,id}=await pair(f),message=(await call(f,b,'POST',`/v1/matches/${id}/messages`,{body:'İtiraz tekillik testi mesajı'})).json();
  const report=(await call(f,a,'POST','/v1/reports',{targetType:'message',targetId:message.id,category:'harassment',detail:'Tek itiraz testi.'})).json(),mod=await moderator(f);
  assert.equal((await call(f,mod.u,'POST',`/v1/admin/reports/${report.id}/actions`,{action:'suspend',note:'Tek itiraz davranışı için askı.',suspendDays:7})).statusCode,200);
  const first=await call(f,null,'POST','/v1/moderation/appeals',{email:b.email,password:testPassword,body:'Bu askı kararına karşı ilk ve tek itirazımı iletiyorum.'});
  const second=await call(f,null,'POST','/v1/moderation/appeals',{email:b.email,password:testPassword,body:'Aynı askı için ikinci kayıt açılmamalı, mevcut kayıt dönmeli.'});
  assert.equal(first.statusCode,200,first.body);assert.equal(second.statusCode,200,second.body);assert.equal(second.json().id,first.json().id);assert.equal(second.json().alreadySubmitted,true);
  assert.equal((await call(f,mod.u,'POST',`/v1/admin/appeals/${first.json().id}/actions`,{decision:'reject',note:'Test kapsamında itiraz reddedildi.'})).statusCode,200);
  const third=await call(f,null,'POST','/v1/moderation/appeals',{email:b.email,password:testPassword,body:'Reddedilen aynı askı kararı için yeni itiraz açılmamalı.'});
  assert.equal(third.json().id,first.json().id);assert.equal(third.json().status,'rejected');
});

test('photo reports preserve evidence after the original photo is deleted',async()=>{
  const {a,b}=await pair(f,false),image=await sharp({create:{width:32,height:32,channels:3,background:'#365A47'}}).png().toBuffer();
  const uploaded=await call(f,a,'POST','/v1/profile/photos',{base64:image.toString('base64'),mimeType:'image/png'});assert.equal(uploaded.statusCode,200,uploaded.body);const photoId=uploaded.json().id;
  const mod=await moderator(f);assert.equal((await call(f,mod.u,'POST',`/v1/admin/photos/${photoId}/review`,{approved:true})).statusCode,200);
  const report=await call(f,b,'POST','/v1/reports',{targetType:'photo',targetId:photoId,category:'other',detail:'Fotoğraf kanıt snapshot testi.'});assert.equal(report.statusCode,200,report.body);
  await call(f,a,'DELETE',`/v1/profile/photos/${photoId}`);
  const detail=await call(f,mod.u,'GET',`/v1/admin/reports/${report.json().id}`);assert.equal(detail.statusCode,200,detail.body);
  assert.equal(detail.json().evidence,'Fotoğrafın şikâyet anındaki kopyası saklandı.');
  assert.match(detail.json().evidencePhotoDataUrl,/^data:image\/jpeg;base64,/);
});

test('account export includes relationship and safety records without auth secrets',async()=>{
  const {a,b}=await pair(f,false);await call(f,a,'POST',`/v1/people/${b.id}/swipes`,{action:'pass'});await call(f,a,'POST','/v1/blocks',{userId:b.id});
  const exported=await call(f,a,'GET','/v1/account/export');assert.equal(exported.statusCode,200,exported.body);const body=exported.json();
  assert(Array.isArray(body.personSwipes));assert(Array.isArray(body.blocks));assert(Array.isArray(body.reports));assert(Array.isArray(body.photos));assert(Array.isArray(body.audit));
  assert(!exported.body.includes('password_hash'));assert(!exported.body.includes('refreshToken'));assert(!exported.body.includes('accessToken'));
});
