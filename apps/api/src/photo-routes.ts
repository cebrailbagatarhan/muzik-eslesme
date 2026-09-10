import { createHmac,randomUUID,timingSafeEqual } from 'node:crypto';
import sharp from 'sharp';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Context } from './context.js';
import type { Query } from './db.js';
import { deny } from './security.js';
export async function sanitizePhoto(base64:string,mime:string) {
  if(!/^[A-Za-z0-9+/]+={0,2}$/.test(base64))deny(400,'invalid_photo','Fotoğraf kodlaması geçersiz.');
  const input=Buffer.from(base64,'base64');
  if(input.length>3*1024*1024||input.length<16)deny(400,'photo_size','Fotoğraf en fazla 3 MB olabilir.');
  const png=input.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),jpeg=input[0]===255&&input[1]===216&&input[2]===255;
  if(!(mime==='image/png'&&png||mime==='image/jpeg'&&jpeg))deny(400,'invalid_photo','Yalnızca gerçek JPEG ve PNG dosyaları kabul edilir.');
  try{
    // Decode and re-encode: strip EXIF/location metadata, trailing payloads and animation.
    return await sharp(input,{limitInputPixels:20_000_000,animated:false,failOn:'warning'}).rotate().resize(1024,1024,{fit:'inside',withoutEnlargement:true}).jpeg({quality:82}).toBuffer();
  }catch{deny(400,'invalid_photo','Fotoğraf güvenli biçimde okunamadı.');}
}
export async function photoRoutes(app:FastifyInstance,ctx:Context,request:typeof fetch=fetch) {
  async function permitted(q:Query,id:string,viewer:string,moderator=false) {
    const [photo]=await q.query('SELECT * FROM profile_photos WHERE id=$1',[id]);
    if(!photo||!photo.content_ciphertext)deny(404,'not_found','Fotoğrafa erişilemiyor.');
    if(photo.user_id===viewer||moderator)return photo;
    if(photo.status!=='approved')deny(404,'not_found','Fotoğrafa erişilemiyor.');
    const matches=await q.query("SELECT id FROM matches WHERE status='active' AND ((user_a=$1 AND user_b=$2) OR (user_a=$2 AND user_b=$1))",[viewer,photo.user_id]);
    if(matches.length){await ctx.activeMatch(q,matches[0].id,viewer);return photo;}
    const seen=await q.query("SELECT 1 FROM feed_impressions WHERE viewer_id=$1 AND target_id=$2 AND day>=CURRENT_DATE-1",[viewer,photo.user_id]);
    if(!seen.length||!await ctx.eligible(q,await ctx.user(q,viewer),await ctx.user(q,photo.user_id)))deny(404,'not_found','Fotoğrafa erişilemiyor.');
    return photo;
  }
  app.post('/v1/profile/photos',async req=>{
    const input=z.object({base64:z.string().max(4*1024*1024),mimeType:z.enum(['image/jpeg','image/png'])}).parse(req.body);
    const bytes=await sanitizePhoto(input.base64,input.mimeType);
    if(ctx.config.scannerUrl){
      let result:Response;
      try{result=await request(ctx.config.scannerUrl,{method:'POST',headers:{'Content-Type':'image/jpeg',Authorization:`Bearer ${ctx.config.scannerToken}`},body:new Uint8Array(bytes!),signal:AbortSignal.timeout(15000)});}catch{deny(503,'scan_unavailable','Fotoğraf denetimi şu anda kullanılamıyor.');}
      if(!result!.ok)deny(503,'scan_unavailable','Fotoğraf denetimi tamamlanamadı.');
      const decision=await result!.json() as {clean?:boolean};if(decision.clean!==true)deny(400,'photo_rejected','Fotoğraf güvenlik denetiminden geçemedi.');
    }
    return ctx.write(req,'photo.uploaded',async q=>{
      const [count]=await q.query("SELECT count(*)::int AS n FROM profile_photos WHERE user_id=$1 AND status<>'rejected'",[req.actor.id]);
      if(count.n>=6)deny(409,'photo_limit','En fazla 6 fotoğraf ekleyebilirsin.');
      const id=randomUUID();await q.query('INSERT INTO profile_photos(id,user_id,content_ciphertext,mime_type) VALUES($1,$2,$3,$4)',[id,req.actor.id,ctx.crypto.seal(bytes!.toString('base64'),`photo:${id}`),'image/jpeg']);
      return {id,status:'pending'};
    });
  });
  app.delete('/v1/profile/photos/:id',async req=>{
    const {id}=z.object({id:z.uuid()}).parse(req.params);
    return ctx.write(req,'photo.deleted',async q=>{await q.query('DELETE FROM profile_photos WHERE id=$1 AND user_id=$2',[id,req.actor.id]);return {ok:true};});
  });
  const signature=(id:string,viewer:string,expires:number)=>createHmac('sha256',ctx.config.mediaKey).update(`${id}.${viewer}.${expires}`).digest('hex');
  app.get('/v1/profile/photos/:id/url',async req=>ctx.db.tx(async q=>{
    const {id}=z.object({id:z.uuid()}).parse(req.params);let moderator=false;
    if(req.actor.role==='moderator')try{await ctx.moderator(req,q);moderator=true;}catch{}
    await permitted(q,id,req.actor.id,moderator);const expires=Math.floor(Date.now()/1000)+120;
    return {path:`/v1/media/${id}?expires=${expires}&signature=${signature(id,req.actor.id,expires)}`,expires};
  }));
  app.get('/v1/media/:id',async req=>ctx.db.tx(async q=>{
    const {id}=z.object({id:z.uuid()}).parse(req.params),input=z.object({expires:z.coerce.number().int(),signature:z.string().regex(/^[a-f0-9]{64}$/)}).parse(req.query);
    const expected=signature(id,req.actor.id,input.expires),now=Math.floor(Date.now()/1000);
    if(input.expires<now||input.expires>now+120||!timingSafeEqual(Buffer.from(expected),Buffer.from(input.signature)))deny(403,'invalid_signature','Fotoğraf bağlantısının süresi dolmuş.');
    let moderator=false;if(req.actor.role==='moderator')try{await ctx.moderator(req,q);moderator=true;}catch{}
    const p=await permitted(q,id,req.actor.id,moderator);await ctx.audit(q,req.actor.id,'photo.viewed',id);
    return {dataUrl:`data:${p.mime_type};base64,${ctx.crypto.open(p.content_ciphertext,`photo:${id}`)}`};
  }));
  app.get('/v1/admin/photos',async req=>ctx.db.tx(async q=>{
    await ctx.moderator(req,q);await ctx.audit(q,req.actor.id,'moderation.photos_viewed');
    return {items:await q.query("SELECT ph.id,ph.user_id,p.display_name AS name,ph.created_at FROM profile_photos ph JOIN profiles p ON p.user_id=ph.user_id WHERE ph.status='pending' ORDER BY ph.created_at LIMIT 100")};
  }));
  app.post('/v1/admin/photos/:id/review',async req=>{
    const {id}=z.object({id:z.uuid()}).parse(req.params),{approved}=z.object({approved:z.boolean()}).parse(req.body);
    return ctx.write(req,'photo.reviewed',async q=>{
      await ctx.moderator(req,q);const [p]=await q.query('SELECT user_id FROM profile_photos WHERE id=$1',[id]);
      if(!p)deny(404,'not_found','Fotoğraf bulunamadı.');if(p.user_id===req.actor.id)deny(403,'conflict_of_interest','Kendi fotoğrafını onaylayamazsın.');
      await q.query("UPDATE profile_photos SET status=$2,content_ciphertext=CASE WHEN $3=true THEN content_ciphertext ELSE '' END WHERE id=$1",[id,approved?'approved':'rejected',approved]);
      return {ok:true};
    },{guard:q=>ctx.moderator(req,q)});
  });
}
