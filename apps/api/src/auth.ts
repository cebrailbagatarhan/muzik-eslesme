import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Context } from './context.js';
import type { Query } from './db.js';
import { ageOn,checkPassword,deny,passwordHash,secret,sha,verifyTotp } from './security.js';
const credentials=z.object({email:z.email().max(254).transform(v=>v.trim().toLowerCase()),password:z.string().min(12).max(128)});
const registerSchema=credentials.extend({displayName:z.string().trim().min(2).max(40),city:z.string().trim().min(2).max(60),birthDate:z.string(),acceptedTerms:z.literal(true)});
export async function issueSession(q:Query,userId:string,family=randomUUID()) {
  const accessToken=secret(),refreshToken=secret();
  await q.query(`INSERT INTO sessions(id,user_id,family_id,access_hash,refresh_hash,access_expires_at,refresh_expires_at)
    VALUES($1,$2,$3,$4,$5,now()+interval '15 minutes',now()+interval '30 days')`,[randomUUID(),userId,family,sha(accessToken),sha(refreshToken)]);
  return {accessToken,refreshToken,expiresIn:900,userId};
}
export async function authRoutes(app:FastifyInstance,ctx:Context) {
  const dummy=await passwordHash(secret());
  app.post('/v1/auth/register',async req=>{
    const input=registerSchema.parse(req.body);const age=ageOn(input.birthDate);
    if(age<18||age>99)deny(400,'age_restricted','Kayıt için 18–99 yaş aralığında olmalısın.');
    const hash=await passwordHash(input.password);
    return ctx.db.tx(async q=>{
      const existing=await q.query('SELECT id FROM users WHERE email=$1',[input.email]);
      if(existing.length)deny(409,'registration_unavailable','Bu bilgilerle kayıt tamamlanamadı. Giriş yapmayı deneyebilirsin.');
      const id=randomUUID();
      await q.query('INSERT INTO users(id,email,password_hash,birth_date,age_verified) VALUES($1,$2,$3,$4,$5)',[id,input.email,hash,input.birthDate,ctx.config.mode==='demo']);
      await q.query('INSERT INTO profiles(user_id,display_name,city) VALUES($1,$2,$3)',[id,input.displayName,input.city.normalize('NFC').toLocaleLowerCase('tr-TR')]);
      await q.query('INSERT INTO consents(id,user_id,kind,version) VALUES($1,$2,$3,$4)',[randomUUID(),id,'terms-and-privacy','2026-09-demo']);
      await ctx.audit(q,id,'account.registered');
      return {...await issueSession(q,id),ageVerified:ctx.config.mode==='demo'};
    });
  });
  app.post('/v1/auth/login',async req=>{
    const input=credentials.parse(req.body);
    const [user]=await ctx.db.query('SELECT * FROM users WHERE email=$1',[input.email]);
    const valid=await checkPassword(input.password,user?.password_hash??dummy);
    if(!valid||!user||user.status!=='active')deny(401,'invalid_credentials','E-posta veya parola yanlış.');
    return ctx.db.tx(async q=>{await ctx.audit(q,user.id,'session.created');return issueSession(q,user.id);});
  });
  app.post('/v1/auth/refresh',async req=>{
    const {refreshToken}=z.object({refreshToken:z.string().min(40).max(100)}).parse(req.body);
    const result=await ctx.db.tx(async q=>{
      const [session]=await q.query('SELECT s.*,u.status FROM sessions s JOIN users u ON u.id=s.user_id WHERE refresh_hash=$1 FOR UPDATE',[sha(refreshToken)]);
      if(!session)return null;
      if(session.rotated){await q.query('DELETE FROM sessions WHERE family_id=$1',[session.family_id]);await ctx.audit(q,session.user_id,'session.reuse_detected');return null;}
      if(session.status!=='active'||new Date(session.refresh_expires_at).getTime()<=Date.now())return null;
      await q.query('UPDATE sessions SET rotated=true WHERE id=$1',[session.id]);
      return issueSession(q,session.user_id,session.family_id);
    });
    if(!result)deny(401,'invalid_refresh','Oturum yenilenemedi. Tekrar giriş yap.');return result;
  });
  app.post('/v1/auth/logout',async req=>{
    await ctx.db.tx(async q=>{const a=await ctx.authenticate(req,q);const [s]=await q.query('SELECT family_id FROM sessions WHERE id=$1',[a.sessionId]);await q.query('DELETE FROM sessions WHERE family_id=$1',[s.family_id]);await ctx.audit(q,a.id,'session.closed');});
    await ctx.changed([req.actor.id]);return {ok:true};
  });
  app.post('/v1/auth/mfa',async req=>{
    const {code}=z.object({code:z.string().regex(/^\d{6}$/)}).parse(req.body);
    return ctx.write(req,'moderator.mfa',async q=>{
      const [u]=await q.query('SELECT * FROM users WHERE id=$1 FOR UPDATE',[req.actor.id]);
      if(u.role!=='moderator'||!u.totp_secret)deny(403,'forbidden','Moderatör hesabı ve TOTP kurulumu gerekli.');
      const step=verifyTotp(ctx.crypto.open(u.totp_secret,`totp:${u.id}`),code,Number(u.totp_last_step??-1));
      if(step===null)deny(403,'invalid_mfa','Doğrulama kodu geçersiz veya kullanılmış.');
      await q.query('UPDATE users SET totp_last_step=$2 WHERE id=$1',[u.id,step]);
      await q.query("UPDATE sessions SET mfa_until=now()+interval '10 minutes' WHERE id=$1",[req.actor.sessionId]);
      return {ok:true,expiresIn:600};
    });
  });
  // Provider-neutral, signed server callback. It cannot be called by the mobile client.
  app.post('/v1/verification/age',async req=>{
    if(!ctx.config.ageSecret)deny(503,'not_configured','Yaş doğrulama sağlayıcısı yapılandırılmamış.');
    const data=z.object({eventId:z.string().min(12).max(128),userId:z.uuid(),verified:z.boolean(),timestamp:z.number().int()}).strict().parse(req.body);
    if(Math.abs(Date.now()/1000-data.timestamp)>300)deny(401,'invalid_signature','İmza süresi dolmuş.');
    const expected=createHmac('sha256',ctx.config.ageSecret).update(`${data.eventId}.${data.userId}.${data.verified}.${data.timestamp}`).digest('hex');
    const signature=req.headers['x-verification-signature'];
    if(typeof signature!=='string'||signature.length!==expected.length||!timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))deny(401,'invalid_signature','Geçersiz imza.');
    return ctx.db.tx(async q=>{
      if((await q.query('SELECT 1 FROM verification_events WHERE id=$1',[data.eventId])).length)return {ok:true};
      await q.query('INSERT INTO verification_events(id) VALUES($1)',[data.eventId]);
      const [u]=await q.query('UPDATE users SET age_verified=$2 WHERE id=$1 RETURNING id',[data.userId,data.verified]);
      if(!u)deny(404,'not_found','Kayıt bulunamadı.');
      if(!data.verified)await q.query("UPDATE matches SET status='removed' WHERE user_a=$1 OR user_b=$1",[data.userId]);
      await ctx.audit(q,data.userId,'age.verified');return {ok:true};
    });
  });
}
