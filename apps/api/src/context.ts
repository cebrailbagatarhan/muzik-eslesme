import { randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { Database, Query, Row } from './db.js';
import type { Config } from './config.js';
import { ageOn,birthString,deny,sha,vault } from './security.js';
import { tasteProfile, type Track } from './engine.js';
export type Actor={id:string;sessionId:string;role:string;mfaUntil:Date|null};
declare module 'fastify' { interface FastifyRequest { actor: Actor; } }
export class Context {
  crypto:ReturnType<typeof vault>;
  changed:(ids:string[])=>Promise<void>=async()=>{};
  closeUser:(id:string)=>void=()=>{};
  constructor(public db:Database,public config:Config) { this.crypto=vault(config.dataKey); }
  async authenticate(req:FastifyRequest,q:Query=this.db):Promise<Actor> {
    const token=req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{40,100})$/)?.[1];
    if(!token)deny(401,'unauthorized','Oturum açman gerekiyor.');
    const [row]=await q.query(`SELECT u.id,u.role,s.id AS session_id,s.mfa_until FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.access_hash=$1 AND s.access_expires_at>now() AND s.rotated=false AND u.status='active'`,[sha(token!)]);
    if(!row)deny(401,'unauthorized','Oturum süresi doldu.');
    return {id:row.id,role:row.role,sessionId:row.session_id,mfaUntil:row.mfa_until};
  }
  async audit(q:Query,actor:string|null,event:string,subject:string|null=null) {
    await q.query('INSERT INTO audit_events(id,actor_id,event_type,subject_id) VALUES($1,$2,$3,$4)',[randomUUID(),actor,event,subject]);
  }
  async write<T>(req:FastifyRequest,event:string,work:(q:Query)=>Promise<T>,options:{guard?:(q:Query)=>Promise<unknown>;replay?:(q:Query)=>Promise<T>}={}):Promise<T> {
    const key=req.headers['idempotency-key'];
    if(typeof key!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(key))deny(400,'idempotency_required','Bu işlem için geçerli Idempotency-Key gerekli.');
    const requestHash=sha(JSON.stringify([req.method,req.routeOptions.url,req.params,req.body??null]));
    return this.db.tx(async q=>{
      const actor=await this.authenticate(req,q);
      if(options.guard)await options.guard(q);
      // Serializes same-user writes across PostgreSQL instances; PGlite serializes transactions itself.
      await q.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[actor.id]);
      const [cached]=await q.query('SELECT * FROM idempotency_keys WHERE user_id=$1 AND key=$2',[actor.id,key]);
      const context=`idempotency:${actor.id}:${key}`;
      if(cached){
        if(cached.request_hash!==requestHash)deny(409,'idempotency_conflict','İşlem anahtarı farklı bir istek için kullanılmış.');
        return options.replay?options.replay(q):JSON.parse(this.crypto.open(cached.result_ciphertext,context));
      }
      const result=await work(q);
      await q.query('INSERT INTO idempotency_keys(user_id,key,request_hash,result_ciphertext) VALUES($1,$2,$3,$4)',[actor.id,key,requestHash,this.crypto.seal(JSON.stringify(result??{}),context)]);
      await this.audit(q,actor.id,event);
      return result;
    });
  }
  async user(q:Query,id:string) {
    const [u]=await q.query(`SELECT u.*,p.* FROM users u JOIN profiles p ON p.user_id=u.id WHERE u.id=$1`,[id]);
    if(!u)deny(404,'not_found','Kullanıcı bulunamadı.');return u;
  }
  async catalog(q:Query):Promise<Track[]> {
    return q.query<Track>(`SELECT * FROM music_catalog_items WHERE enabled=true AND (rights_status='licensed' OR $1=true) ORDER BY id`,[this.config.mode==='demo']);
  }
  async taste(q:Query,user:Row,catalog?:Track[]) {
    return tasteProfile(catalog??await this.catalog(q),await q.query('SELECT item_id,action FROM track_swipes WHERE user_id=$1',[user.id]),user as any);
  }
  async eligible(q:Query,a:Row,b:Row) {
    if(a.id===b.id||a.status!=='active'||b.status!=='active'||!a.age_verified||!b.age_verified)return false;
    const aa=ageOn(birthString(a.birth_date)),ba=ageOn(birthString(b.birth_date));
    if(aa<18||ba<18||ba<a.age_min||ba>a.age_max||aa<b.age_min||aa>b.age_max||a.city!==b.city||a.intention!==b.intention)return false;
    const hidden=await q.query(`SELECT 1 FROM blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1)
      UNION ALL SELECT 1 FROM reports WHERE (reporter_id=$1 AND target_user_id=$2) OR (reporter_id=$2 AND target_user_id=$1) LIMIT 1`,[a.id,b.id]);
    return hidden.length===0;
  }
  async activeMatch(q:Query,id:string,userId:string) {
    const [m]=await q.query(`SELECT m.* FROM matches m JOIN users a ON a.id=m.user_a JOIN users b ON b.id=m.user_b
      WHERE m.id=$1 AND (m.user_a=$2 OR m.user_b=$2) AND m.status='active' AND a.status='active' AND b.status='active'
      AND NOT EXISTS(SELECT 1 FROM blocks x WHERE (x.blocker_id=m.user_a AND x.blocked_id=m.user_b) OR (x.blocker_id=m.user_b AND x.blocked_id=m.user_a))
      AND NOT EXISTS(SELECT 1 FROM reports r WHERE (r.reporter_id=m.user_a AND r.target_user_id=m.user_b) OR (r.reporter_id=m.user_b AND r.target_user_id=m.user_a))`,[id,userId]);
    if(!m)deny(404,'match_unavailable','Bu eşleşmeye erişilemiyor.');return m;
  }
  async instagram(q:Query,match:Row,viewer:string) {
    const accounts=await q.query('SELECT user_id,username_ciphertext FROM instagram_accounts WHERE user_id=ANY($1::uuid[])',[[match.user_a,match.user_b]]);
    const consents=await q.query('SELECT user_id,granted FROM instagram_share_consents WHERE match_id=$1',[match.id]);
    const mine=consents.find(c=>c.user_id===viewer); const theirs=consents.find(c=>c.user_id!==viewer);
    const mutual=accounts.length===2&&mine?.granted===true&&theirs?.granted===true;
    const state=mutual?'MUTUAL':consents.some(c=>c.granted===false)?'REVOKED':mine?.granted||theirs?.granted?'REQUESTED':accounts.some(a=>a.user_id===viewer)?'PRIVATE':'NOT_ADDED';
    if(!mutual)return {state,myConsent:mine?.granted===true,peerConsent:theirs?.granted===true};
    await this.audit(q,viewer,'instagram.viewed',match.id);
    return {state,myConsent:true,peerConsent:true,accounts:accounts.map(a=>{
      const username=this.crypto.open(a.username_ciphertext,`instagram:${a.user_id}`);
      return {userId:a.user_id,username,url:`https://www.instagram.com/${username}/`,verified:false};
    })};
  }
  async moderator(req:FastifyRequest,q:Query) {
    const actor=await this.authenticate(req,q);
    if(actor.role!=='moderator')deny(403,'forbidden','Moderatör yetkisi gerekli.');
    if(!actor.mfaUntil||new Date(actor.mfaUntil).getTime()<=Date.now())deny(403,'mfa_required','Güncel doğrulama kodunu gir.');
    return actor;
  }
}
