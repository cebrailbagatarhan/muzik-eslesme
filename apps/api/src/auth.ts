import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Context } from './context.js';
import type { Query } from './db.js';
import { ageOn,checkPassword,deny,passwordHash,secret,sha,verifyTotp } from './security.js';
const birthDateSchema=z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const credentials=z.object({email:z.email().max(254).transform(v=>v.trim().toLowerCase()),password:z.string().min(12).max(128)});
const registerSchema=credentials.extend({displayName:z.string().trim().min(2).max(40),city:z.string().trim().min(2).max(60),birthDate:birthDateSchema,acceptedTerms:z.literal(true)});
type ActionPurpose='email_verify'|'password_reset';
export async function issueSession(q:Query,userId:string,family=randomUUID()) {
  const accessToken=secret(),refreshToken=secret();
  await q.query(`INSERT INTO sessions(id,user_id,family_id,access_hash,refresh_hash,access_expires_at,refresh_expires_at)
    VALUES($1,$2,$3,$4,$5,now()+interval '15 minutes',now()+interval '30 days')`,[randomUUID(),userId,family,sha(accessToken),sha(refreshToken)]);
  return {accessToken,refreshToken,expiresIn:900,userId};
}
async function actionToken(q:Query,userId:string,purpose:ActionPurpose) {
  const token=secret(),minutes=purpose==='email_verify'?1440:30,id=randomUUID();
  await q.query('DELETE FROM auth_action_tokens WHERE user_id=$1 AND purpose=$2 AND used_at IS NULL',[userId,purpose]);
  await q.query(`INSERT INTO auth_action_tokens(id,user_id,purpose,token_hash,expires_at) VALUES($1,$2,$3,$4,now()+($5::text || ' minutes')::interval)`,[id,userId,purpose,sha(token),minutes]);
  return {token,expiresIn:minutes*60};
}
async function deliver(ctx:Context,purpose:ActionPurpose,email:string,token:string,expiresIn:number) {
  if(ctx.config.mode==='demo')return;
  try{
    const response=await fetch(ctx.config.authDeliveryUrl,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${ctx.config.authDeliveryToken}`},body:JSON.stringify({purpose,email,token,expiresIn}),signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw new Error(`delivery status ${response.status}`);
  }catch{deny(503,'delivery_unavailable','E-posta gönderilemedi. Biraz sonra yeniden dene.');}
}
export async function authRoutes(app:FastifyInstance,ctx:Context) {
  const dummy=await passwordHash(secret());
  app.post('/v1/auth/register',async req=>{
    const input=registerSchema.parse(req.body);const age=ageOn(input.birthDate);
    if(age<18||age>99)deny(400,'age_restricted','Kayıt için 18–99 yaş aralığında olmalısın.');
    const hash=await passwordHash(input.password),verified=ctx.config.mode==='demo';
    const result=await ctx.db.tx(async q=>{
      const existing=await q.query('SELECT id FROM users WHERE email=$1',[input.email]);
      if(existing.length)deny(409,'registration_unavailable','Bu bilgilerle kayıt tamamlanamadı. Giriş yapmayı deneyebilirsin.');
      const id=randomUUID();
      await q.query('INSERT INTO users(id,email,password_hash,birth_date,age_verified,email_verified) VALUES($1,$2,$3,$4,$5,$6)',[id,input.email,hash,input.birthDate,ctx.config.mode==='demo',verified]);
      await q.query('INSERT INTO profiles(user_id,display_name,city) VALUES($1,$2,$3)',[id,input.displayName,input.city.normalize('NFC').toLocaleLowerCase('tr-TR')]);
      await q.query('INSERT INTO consents(id,user_id,kind,version) VALUES($1,$2,$3,$4)',[randomUUID(),id,'terms-and-privacy','2026-09-demo']);
      await ctx.audit(q,id,'account.registered');
      if(verified)return {session:await issueSession(q,id),action:null};
      return {session:null,action:await actionToken(q,id,'email_verify')};
    });
    if(result.action)await deliver(ctx,'email_verify',input.email,result.action.token,result.action.expiresIn);
    if(result.session)return {...result.session,ageVerified:true,emailVerified:true};
    return {verificationRequired:true,email:input.email,...(ctx.config.mode==='demo'?{debugToken:result.action?.token}: {})};
  });
  app.post('/v1/auth/login',async req=>{
    const input=credentials.parse(req.body);
    let [user]=await ctx.db.query('SELECT * FROM users WHERE email=$1',[input.email]);
    const valid=await checkPassword(input.password,user?.password_hash??dummy);
    if(!valid||!user)deny(401,'invalid_credentials','E-posta veya parola yanlış.');
    if(user.status==='suspended'&&user.suspended_until&&new Date(user.suspended_until).getTime()<=Date.now()){
      await ctx.db.query("UPDATE users SET status='active',suspended_until=NULL,suspension_reason_ciphertext=NULL WHERE id=$1",[user.id]);
      [user]=await ctx.db.query('SELECT * FROM users WHERE id=$1',[user.id]);
    }
    if(user.status!=='active')deny(403,'account_suspended','Hesabın askıda. İtiraz bağlantısını kullanabilirsin.');
    if(!user.email_verified)deny(403,'email_verification_required','Devam etmek için e-posta adresini doğrula.');
    return ctx.db.tx(async q=>{await ctx.audit(q,user.id,'session.created');return issueSession(q,user.id);});
  });
  app.post('/v1/auth/email-verification/request',async req=>{
    const {email}=z.object({email:z.email().max(254).transform(v=>v.trim().toLowerCase())}).parse(req.body);
    const [u]=await ctx.db.query('SELECT id,email_verified FROM users WHERE email=$1',[email]);
    if(!u||u.email_verified)return {ok:true};
    const action=await ctx.db.tx(q=>actionToken(q,u.id,'email_verify'));
    await deliver(ctx,'email_verify',email,action.token,action.expiresIn);
    return {ok:true,...(ctx.config.mode==='demo'?{debugToken:action.token}: {})};
  });
  app.post('/v1/auth/email-verification/confirm',async req=>{
    const {token}=z.object({token:z.string().min(40).max(100)}).parse(req.body);
    const userId=await ctx.db.tx(async q=>{
      const [row]=await q.query("SELECT * FROM auth_action_tokens WHERE token_hash=$1 AND purpose='email_verify' AND used_at IS NULL AND expires_at>now() FOR UPDATE",[sha(token)]);
      if(!row)deny(400,'invalid_token','Doğrulama bağlantısı geçersiz veya süresi dolmuş.');
      await q.query('UPDATE auth_action_tokens SET used_at=now() WHERE id=$1',[row.id]);
      await q.query('UPDATE users SET email_verified=true WHERE id=$1',[row.user_id]);
      await ctx.audit(q,row.user_id,'email.verified');return row.user_id as string;
    });
    return {ok:true,userId};
  });
  app.post('/v1/auth/password-reset/request',async req=>{
    const {email}=z.object({email:z.email().max(254).transform(v=>v.trim().toLowerCase())}).parse(req.body);
    const [u]=await ctx.db.query("SELECT id FROM users WHERE email=$1 AND status='active'",[email]);
    if(!u)return {ok:true};
    const action=await ctx.db.tx(q=>actionToken(q,u.id,'password_reset'));
    await deliver(ctx,'password_reset',email,action.token,action.expiresIn);
    return {ok:true,...(ctx.config.mode==='demo'?{debugToken:action.token}: {})};
  });
  app.post('/v1/auth/password-reset/confirm',async req=>{
    const {token,newPassword}=z.object({token:z.string().min(40).max(100),newPassword:z.string().min(12).max(128)}).parse(req.body),hash=await passwordHash(newPassword);
    const userId=await ctx.db.tx(async q=>{
      const [row]=await q.query("SELECT * FROM auth_action_tokens WHERE token_hash=$1 AND purpose='password_reset' AND used_at IS NULL AND expires_at>now() FOR UPDATE",[sha(token)]);
      if(!row)deny(400,'invalid_token','Parola yenileme bağlantısı geçersiz veya süresi dolmuş.');
      await q.query('UPDATE auth_action_tokens SET used_at=now() WHERE id=$1',[row.id]);
      await q.query('UPDATE users SET password_hash=$2 WHERE id=$1',[row.user_id,hash]);
      await q.query('DELETE FROM sessions WHERE user_id=$1',[row.user_id]);
      await ctx.audit(q,row.user_id,'password.reset');return row.user_id as string;
    });
    ctx.closeUser(userId);await ctx.changed([userId]);return {ok:true};
  });
  app.post('/v1/auth/password/change',async req=>{
    const {currentPassword,newPassword}=z.object({currentPassword:z.string().max(128),newPassword:z.string().min(12).max(128)}).parse(req.body),hash=await passwordHash(newPassword);
    const result=await ctx.write(req,'password.changed',async q=>{
      const [u]=await q.query('SELECT password_hash FROM users WHERE id=$1',[req.actor.id]);
      if(!u||!await checkPassword(currentPassword,u.password_hash))deny(401,'invalid_credentials','Mevcut parola yanlış.');
      await q.query('UPDATE users SET password_hash=$2 WHERE id=$1',[req.actor.id,hash]);
      await q.query('DELETE FROM sessions WHERE user_id=$1 AND id<>$2',[req.actor.id,req.actor.sessionId]);
      return {ok:true};
    });
    await ctx.changed([req.actor.id]);return result;
  });
  app.post('/v1/auth/refresh',async req=>{
    const {refreshToken}=z.object({refreshToken:z.string().min(40).max(100)}).parse(req.body);
    const result=await ctx.db.tx(async q=>{
      const [session]=await q.query('SELECT s.*,u.status,u.email_verified FROM sessions s JOIN users u ON u.id=s.user_id WHERE refresh_hash=$1 FOR UPDATE',[sha(refreshToken)]);
      if(!session)return null;
      if(session.rotated){await q.query('DELETE FROM sessions WHERE family_id=$1',[session.family_id]);await ctx.audit(q,session.user_id,'session.reuse_detected');return null;}
      if(session.status!=='active'||!session.email_verified||new Date(session.refresh_expires_at).getTime()<=Date.now())return null;
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
  app.post('/v1/verification/age',async req=>{
    if(!ctx.config.ageSecret)deny(503,'not_configured','Yaş doğrulama sağlayıcısı yapılandırılmamış.');
    const data=z.object({eventId:z.string().min(12).max(128),userId:z.uuid(),verified:z.boolean(),birthDate:birthDateSchema.optional(),timestamp:z.number().int()}).strict().refine(v=>!v.verified||!!v.birthDate,{message:'Doğrulanmış sonuç için doğum tarihi gerekli.',path:['birthDate']}).parse(req.body);
    if(Math.abs(Date.now()/1000-data.timestamp)>300)deny(401,'invalid_signature','İmza süresi dolmuş.');
    const material=`${data.eventId}.${data.userId}.${data.verified}.${data.birthDate??''}.${data.timestamp}`;
    const expected=createHmac('sha256',ctx.config.ageSecret).update(material).digest('hex');
    const signature=req.headers['x-verification-signature'];
    if(typeof signature!=='string'||signature.length!==expected.length||!timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))deny(401,'invalid_signature','Geçersiz imza.');
    if(data.verified){const age=ageOn(data.birthDate!);if(age<18||age>99)deny(400,'invalid_age_attestation','Sağlayıcının doğruladığı yaş kabul edilen aralıkta değil.');}
    const result=await ctx.db.tx(async q=>{
      if((await q.query('SELECT 1 FROM verification_events WHERE id=$1',[data.eventId])).length)return {ok:true,duplicate:true,verified:data.verified};
      await q.query('INSERT INTO verification_events(id) VALUES($1)',[data.eventId]);
      const [u]=data.verified
        ?await q.query('UPDATE users SET age_verified=true,birth_date=$2 WHERE id=$1 RETURNING id',[data.userId,data.birthDate])
        :await q.query('UPDATE users SET age_verified=false WHERE id=$1 RETURNING id',[data.userId]);
      if(!u)deny(404,'not_found','Kayıt bulunamadı.');
      if(!data.verified){
        await q.query("UPDATE matches SET status='removed' WHERE user_a=$1 OR user_b=$1",[data.userId]);
        await q.query('DELETE FROM sessions WHERE user_id=$1',[data.userId]);
      }
      await ctx.audit(q,data.userId,data.verified?'age.verified':'age.rejected');return {ok:true,duplicate:false,verified:data.verified};
    });
    if(!result.duplicate){if(!result.verified)ctx.closeUser(data.userId);await ctx.changed([data.userId]);}
    return {ok:true};
  });
}
