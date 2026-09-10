import { after,before,test } from 'node:test';
import assert from 'node:assert/strict';
import { call,fixture,moderator,pair,testPassword,user,type Fixture } from './helpers.js';
let f:Fixture;
before(async()=>{f=await fixture();});
after(async()=>{await f?.app.close();await f?.db.close();});

test('email verification tokens are single-use',async()=>{
  const u=await user(f);await f.db.query('UPDATE users SET email_verified=false WHERE id=$1',[u.id]);
  const request=await call(f,null,'POST','/v1/auth/email-verification/request',{email:u.email});assert.equal(request.statusCode,200,request.body);const token=request.json().debugToken;assert(token);
  assert.equal((await call(f,null,'POST','/v1/auth/email-verification/confirm',{token})).statusCode,200);
  assert.equal((await call(f,null,'POST','/v1/auth/email-verification/confirm',{token})).statusCode,400);
  const [row]=await f.db.query('SELECT email_verified FROM users WHERE id=$1',[u.id]);assert.equal(row.email_verified,true);
});

test('password reset revokes sessions and password change keeps only current session',async()=>{
  const u=await user(f),reset=await call(f,null,'POST','/v1/auth/password-reset/request',{email:u.email}),token=reset.json().debugToken,newPassword='Different-Password!2026';assert(token);
  assert.equal((await call(f,null,'POST','/v1/auth/password-reset/confirm',{token,newPassword})).statusCode,200);
  assert.equal((await call(f,u,'GET','/v1/me')).statusCode,401);
  const login=await call(f,null,'POST','/v1/auth/login',{email:u.email,password:newPassword});assert.equal(login.statusCode,200,login.body);const current={...u,...login.json()};
  const second=(await call(f,null,'POST','/v1/auth/login',{email:u.email,password:newPassword})).json(),other={...u,...second};
  assert.equal((await call(f,current,'POST','/v1/auth/password/change',{currentPassword:newPassword,newPassword:testPassword})).statusCode,200);
  assert.equal((await call(f,current,'GET','/v1/me')).statusCode,200);assert.equal((await call(f,other,'GET','/v1/me')).statusCode,401);
});

test('optional consents can be granted and revoked independently',async()=>{
  const u=await user(f);let view=(await call(f,u,'GET','/v1/consents')).json();assert.equal(view.optional.find((x:any)=>x.kind==='product-analytics').granted,false);
  assert.equal((await call(f,u,'PUT','/v1/consents/product-analytics',{granted:true,version:'test-v1'})).statusCode,200);
  view=(await call(f,u,'GET','/v1/consents')).json();assert.equal(view.optional.find((x:any)=>x.kind==='product-analytics').granted,true);
  assert.equal((await call(f,u,'PUT','/v1/consents/product-analytics',{granted:false,version:'test-v1'})).statusCode,200);
  view=(await call(f,u,'GET','/v1/consents')).json();assert.equal(view.optional.find((x:any)=>x.kind==='product-analytics').granted,false);
});

test('suspensions are timed and can be appealed and accepted by a different moderator',async()=>{
  const {a,b,id}=await pair(f),message=(await call(f,b,'POST',`/v1/matches/${id}/messages`,{body:'Moderasyon testi için örnek mesaj'})).json();
  const report=(await call(f,a,'POST','/v1/reports',{targetType:'message',targetId:message.id,category:'harassment',detail:'Askı ve itiraz testi.'})).json(),mod=await moderator(f);
  assert.equal((await call(f,mod.u,'POST',`/v1/admin/reports/${report.id}/actions`,{action:'suspend',note:'Test için yedi günlük askı.',suspendDays:7})).statusCode,200);
  assert.equal((await call(f,null,'POST','/v1/auth/login',{email:b.email,password:testPassword})).json().error.code,'account_suspended');
  const appeal=await call(f,null,'POST','/v1/moderation/appeals',{email:b.email,password:testPassword,body:'Bu askı kararının yeniden incelenmesini talep ediyorum.'});assert.equal(appeal.statusCode,200,appeal.body);
  const queue=(await call(f,mod.u,'GET','/v1/admin/appeals')).json().items;assert(queue.some((x:any)=>x.id===appeal.json().id&&x.body.includes('yeniden incelenmesini')));
  assert.equal((await call(f,mod.u,'POST',`/v1/admin/appeals/${appeal.json().id}/actions`,{decision:'accept',note:'İtiraz test kapsamında kabul edildi.'})).statusCode,200);
  assert.equal((await call(f,null,'POST','/v1/auth/login',{email:b.email,password:testPassword})).statusCode,200);
});
