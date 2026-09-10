import { randomUUID,randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db.js';
import { readConfig } from '../src/config.js';
import { buildApp } from '../src/app.js';
import { DEMO_CATALOG,seedCatalog } from '../src/catalog.js';
import { newTotpSecret,totpAt } from '../src/security.js';
export async function fixture(request?:typeof fetch){
  const config={...readConfig({APP_MODE:'demo',DATA_ENCRYPTION_KEY:randomBytes(32).toString('hex'),MEDIA_SIGNING_KEY:randomBytes(32).toString('hex'),AGE_WEBHOOK_SECRET:randomBytes(32).toString('hex')}),rateMultiplier:1000};
  const db=await openDatabase(process.env.TEST_DATABASE_URL??'');await db.tx(seedCatalog);
  const result=await buildApp(config,db,{request});return {...result,db,config};
}
export type Fixture=Awaited<ReturnType<typeof fixture>>;
export type User={id:string;accessToken:string;refreshToken:string;email:string;city:string};
export const testPassword='Test-Password!2026';
export function call(f:Fixture,user:User|null,method:string,url:string,body?:unknown,key=randomUUID()){
  return f.app.inject({method:method as any,url,headers:{...(user?{authorization:`Bearer ${user.accessToken}`} :{}),'idempotency-key':key},payload:body as any});
}
export async function user(f:Fixture,city=`city-${randomUUID()}`,extra:Record<string,unknown>={}):Promise<User>{
  const email=`test-${randomUUID()}@example.test`,response=await call(f,null,'POST','/v1/auth/register',{email,password:testPassword,displayName:'Deneme',city,birthDate:'1998-04-10',acceptedTerms:true,...extra});
  assert.equal(response.statusCode,200,response.body);const s=response.json();return {id:s.userId,accessToken:s.accessToken,refreshToken:s.refreshToken,email,city};
}
export async function rateUser(f:Fixture,u:User){await f.db.tx(async q=>{for(const t of DEMO_CATALOG.filter(t=>!t.explicit).slice(0,25))await q.query("INSERT INTO track_swipes(user_id,item_id,action) VALUES($1,$2,'like') ON CONFLICT DO NOTHING",[u.id,t.id]);});}
export async function pair(f:Fixture,create=true){
  const city=`city-${randomUUID()}`,a=await user(f,city),b=await user(f,city);await rateUser(f,a);await rateUser(f,b);
  for(const u of [a,b])assert.equal((await call(f,u,'GET','/v1/people/feed')).statusCode,200);
  if(!create)return {a,b,id:''};
  await call(f,a,'POST',`/v1/people/${b.id}/swipes`,{action:'like'});const response=await call(f,b,'POST',`/v1/people/${a.id}/swipes`,{action:'like'});assert.equal(response.statusCode,200,response.body);assert.equal(response.json().matched,true);
  return {a,b,id:response.json().matchId as string};
}
export async function moderator(f:Fixture){
  const u=await user(f),value=newTotpSecret();
  await f.db.query("UPDATE users SET role='moderator',totp_secret=$2 WHERE id=$1",[u.id,f.ctx.crypto.seal(value,`totp:${u.id}`)]);
  const code=totpAt(value,Math.floor(Date.now()/30000));const r=await call(f,u,'POST','/v1/auth/mfa',{code});assert.equal(r.statusCode,200,r.body);return {u,value,code};
}
