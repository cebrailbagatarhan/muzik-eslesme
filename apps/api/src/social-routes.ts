import { randomUUID } from 'node:crypto';
import type { FastifyInstance,FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Context } from './context.js';
import type { Query,Row } from './db.js';
import { ALGORITHM_VERSION,createPlaylist,type PlaylistItem } from './engine.js';
import { deny,ageOn,birthString } from './security.js';
const matchId=(req:FastifyRequest)=>z.object({id:z.uuid()}).parse(req.params).id;
export function messageAllowed(body:string) {
  // This starter filter limits contact spam; human moderation remains necessary.
  return !/(https?:\/\/|www\.|@[a-z0-9_.]{2,}|(?:\+?\d[\s().-]*){10,})/i.test(body);
}
export async function socialRoutes(app:FastifyInstance,ctx:Context) {
  app.get('/v1/matches',async req=>ctx.db.tx(async q=>{
    const rows=await q.query("SELECT * FROM matches WHERE (user_a=$1 OR user_b=$1) AND status='active' ORDER BY matched_at DESC",[req.actor.id]);
    const items=[];
    for(const m of rows){
      try{await ctx.activeMatch(q,m.id,req.actor.id);}catch{continue;}
      const peer=await ctx.user(q,m.user_a===req.actor.id?m.user_b:m.user_a);
      const [count]=await q.query('SELECT count(*)::int AS n FROM messages WHERE match_id=$1 AND sender_id<>$2 AND read_at IS NULL AND deleted_at IS NULL',[m.id,req.actor.id]);
      items.push({id:m.id,matchedAt:m.matched_at,unread:count.n,peer:{id:peer.id,displayName:peer.display_name,age:ageOn(birthString(peer.birth_date)),city:peer.city,bio:peer.bio}});
    }
    return {items};
  }));
  app.delete('/v1/matches/:id',async req=>{
    const id=matchId(req);let peers:string[]=[];
    const result=await ctx.write(req,'match.removed',async q=>{
      const m=await ctx.activeMatch(q,id,req.actor.id);peers=[m.user_a,m.user_b];
      await q.query("UPDATE matches SET status='removed' WHERE id=$1",[id]);
      await q.query('DELETE FROM instagram_share_consents WHERE match_id=$1',[id]);
      return {ok:true};
    });await ctx.changed(peers);return result;
  });
  app.get('/v1/matches/:id/messages',async req=>ctx.db.tx(async q=>{
    const id=matchId(req);await ctx.activeMatch(q,id,req.actor.id);
    const {before}=z.object({before:z.uuid().optional()}).parse(req.query);
    let cursor:Row|undefined;
    if(before){[cursor]=await q.query('SELECT created_at,id FROM messages WHERE id=$1 AND match_id=$2',[before,id]);if(!cursor)deny(400,'invalid_cursor','Sayfalama işareti geçersiz.');}
    const rows=cursor?await q.query('SELECT * FROM messages WHERE match_id=$1 AND (created_at,id)<($2,$3::uuid) ORDER BY created_at DESC,id DESC LIMIT 50',[id,cursor.created_at,cursor.id]):await q.query('SELECT * FROM messages WHERE match_id=$1 ORDER BY created_at DESC,id DESC LIMIT 50',[id]);
    const nextBefore=rows.length===50?rows[rows.length-1].id:null;
    return {items:rows.reverse().map(m=>({id:m.id,senderId:m.sender_id,body:m.body_ciphertext?ctx.crypto.open(m.body_ciphertext,`message:${m.id}`):null,createdAt:m.created_at,readAt:m.read_at,deletedAt:m.deleted_at})),nextBefore};
  }));
  app.post('/v1/matches/:id/messages',async req=>{
    const id=matchId(req),{body}=z.object({body:z.string().trim().min(1).max(2000)}).parse(req.body);let peers:string[]=[];
    if(!messageAllowed(body))deny(400,'contact_spam','Bağlantı, telefon ve sosyal hesap paylaşımı yerine karşılıklı Instagram paylaşımını kullan.');
    const result=await ctx.write(req,'message.sent',async q=>{
      const m=await ctx.activeMatch(q,id,req.actor.id);peers=[m.user_a,m.user_b];
      const last=await q.query("SELECT id,body_ciphertext FROM messages WHERE sender_id=$1 AND created_at>now()-interval '1 minute' AND body_ciphertext IS NOT NULL ORDER BY created_at DESC LIMIT 5",[req.actor.id]);
      if(last.filter(v=>ctx.crypto.open(v.body_ciphertext,`message:${v.id}`)===body).length>=2)deny(429,'repeated_message','Aynı mesajı çok sık gönderiyorsun.');
      const messageId=randomUUID();
      const [inserted]=await q.query('INSERT INTO messages(id,match_id,sender_id,body_ciphertext) VALUES($1,$2,$3,$4) RETURNING created_at',[messageId,id,req.actor.id,ctx.crypto.seal(body,`message:${messageId}`)]);
      return {id:messageId,createdAt:inserted.created_at};
    },{guard:q=>ctx.activeMatch(q,id,req.actor.id)});
    await ctx.changed(peers);return result;
  });
  app.post('/v1/matches/:id/read',async req=>{
    const id=matchId(req),{messageId}=z.object({messageId:z.uuid()}).parse(req.body);let peers:string[]=[];
    const result=await ctx.write(req,'messages.read',async q=>{
      const m=await ctx.activeMatch(q,id,req.actor.id);peers=[m.user_a,m.user_b];
      const [message]=await q.query('SELECT id,created_at FROM messages WHERE id=$1 AND match_id=$2',[messageId,id]);if(!message)deny(404,'not_found','Mesaj bulunamadı.');
      await q.query('UPDATE messages SET read_at=COALESCE(read_at,now()) WHERE match_id=$1 AND sender_id<>$2 AND (created_at,id)<=($3,$4::uuid)',[id,req.actor.id,message.created_at,message.id]);
      return {ok:true};
    },{guard:q=>ctx.activeMatch(q,id,req.actor.id)});await ctx.changed(peers);return result;
  });
  app.delete('/v1/matches/:id/messages/:messageId',async req=>{
    const {id,messageId}=z.object({id:z.uuid(),messageId:z.uuid()}).parse(req.params);let peers:string[]=[];
    const result=await ctx.write(req,'message.deleted',async q=>{
      const m=await ctx.activeMatch(q,id,req.actor.id);peers=[m.user_a,m.user_b];
      const rows=await q.query('UPDATE messages SET body_ciphertext=NULL,deleted_at=COALESCE(deleted_at,now()) WHERE id=$1 AND match_id=$2 AND sender_id=$3 RETURNING id',[messageId,id,req.actor.id]);
      if(!rows.length)deny(404,'not_found','Mesaj bulunamadı.');return {ok:true};
    },{guard:q=>ctx.activeMatch(q,id,req.actor.id)});await ctx.changed(peers);return result;
  });
  app.get('/v1/matches/:id/instagram-share',async req=>ctx.db.tx(async q=>{
    const m=await ctx.activeMatch(q,matchId(req),req.actor.id);return ctx.instagram(q,m,req.actor.id);
  }));
  for(const method of ['POST','DELETE'] as const)app.route({method,url:'/v1/matches/:id/instagram-share',handler:async req=>{
    const id=matchId(req);let peers:string[]=[];
    if(method==='POST')z.object({acknowledgedRisk:z.literal(true)}).parse(req.body);
    const current=async(q:Query)=>ctx.instagram(q,await ctx.activeMatch(q,id,req.actor.id),req.actor.id);
    const result=await ctx.write(req,method==='POST'?'instagram.consent_granted':'instagram.consent_revoked',async q=>{
      const m=await ctx.activeMatch(q,id,req.actor.id);peers=[m.user_a,m.user_b];
      if(method==='POST'&&!(await q.query('SELECT 1 FROM instagram_accounts WHERE user_id=$1',[req.actor.id])).length)deny(409,'instagram_required','Önce profilinde Instagram kullanıcı adını ekle.');
      if(method==='DELETE')await q.query('DELETE FROM instagram_share_consents WHERE match_id=$1',[id]);
      await q.query(`INSERT INTO instagram_share_consents(match_id,user_id,granted) VALUES($1,$2,$3)
        ON CONFLICT(match_id,user_id) DO UPDATE SET granted=EXCLUDED.granted,decided_at=now()`,[id,req.actor.id,method==='POST']);
      return current(q);
    },{guard:q=>ctx.activeMatch(q,id,req.actor.id),replay:current});
    await ctx.changed(peers);return result;
  }});
  async function draftView(q:Query,draft:Row,userId:string) {
    const m=await ctx.activeMatch(q,draft.match_id,userId),a=await ctx.user(q,m.user_a),b=await ctx.user(q,m.user_b),catalog=await ctx.catalog(q);
    const ta=await ctx.taste(q,a,catalog),tb=await ctx.taste(q,b,catalog),negative=new Set([...ta.negative,...tb.negative]);
    const items=(draft.items as PlaylistItem[]).flatMap(item=>{
      const track=catalog.find(t=>t.id===item.trackId);
      if(!track||negative.has(track.id)||track.explicit&&!(a.allow_explicit&&b.allow_explicit))return [];
      const {spotify_uri,...publicTrack}=track;return [{...item,track:publicTrack}];
    });
    return {id:draft.id,matchId:m.id,algorithmVersion:draft.algorithm_version,revision:draft.revision,items,removedSinceCreation:draft.items.length-items.length};
  }
  app.post('/v1/matches/:id/playlist-drafts',async req=>{
    const id=matchId(req);let peers:string[]=[];
    const result=await ctx.write(req,'playlist.created',async q=>{
      const m=await ctx.activeMatch(q,id,req.actor.id);peers=[m.user_a,m.user_b];
      const catalog=await ctx.catalog(q),a=await ctx.user(q,m.user_a),b=await ctx.user(q,m.user_b);
      const items=createPlaylist(catalog,await ctx.taste(q,a,catalog),await ctx.taste(q,b,catalog),a.allow_explicit&&b.allow_explicit);
      if(!items.length)deny(409,'empty_playlist','Uygun parça bulunamadı. Müzik seçimlerinizi artırın.');
      const draftId=randomUUID();await q.query('INSERT INTO playlist_drafts(id,match_id,algorithm_version,items) VALUES($1,$2,$3,$4)',[draftId,id,ALGORITHM_VERSION,JSON.stringify(items)]);
      return {id:draftId};
    },{guard:q=>ctx.activeMatch(q,id,req.actor.id)});await ctx.changed(peers);return result;
  });
  app.get('/v1/matches/:id/playlist-drafts',async req=>ctx.db.tx(async q=>{
    const id=matchId(req);await ctx.activeMatch(q,id,req.actor.id);
    return {items:await q.query('SELECT id,revision,created_at FROM playlist_drafts WHERE match_id=$1 ORDER BY created_at DESC LIMIT 10',[id])};
  }));
  app.get('/v1/playlist-drafts/:id',async req=>ctx.db.tx(async q=>{
    const [draft]=await q.query('SELECT * FROM playlist_drafts WHERE id=$1',[matchId(req)]);if(!draft)deny(404,'not_found','Liste bulunamadı.');
    return draftView(q,draft,req.actor.id);
  }));
  app.put('/v1/playlist-drafts/:id',async req=>{
    const id=matchId(req),input=z.object({revision:z.number().int().positive(),trackIds:z.array(z.uuid()).min(1).max(30)}).parse(req.body);
    return ctx.write(req,'playlist.updated',async q=>{
      const [draft]=await q.query('SELECT * FROM playlist_drafts WHERE id=$1 FOR UPDATE',[id]);if(!draft)deny(404,'not_found','Liste bulunamadı.');
      const view=await draftView(q,draft,req.actor.id);
      if(draft.revision!==input.revision)deny(409,'revision_conflict','Liste değişti. Son sürümü açıp tekrar dene.');
      if(new Set(input.trackIds).size!==input.trackIds.length||input.trackIds.some(id=>!view.items.some(i=>i.trackId===id)))deny(400,'invalid_playlist','Yalnızca listedeki uygun parçaları sıralayabilir veya çıkarabilirsin.');
      const items=input.trackIds.map(id=>(draft.items as PlaylistItem[]).find(t=>t.trackId===id));
      await q.query('UPDATE playlist_drafts SET items=$2,revision=revision+1 WHERE id=$1',[id,JSON.stringify(items)]);
      return {ok:true,revision:input.revision+1};
    },{guard:async q=>{const [d]=await q.query('SELECT match_id FROM playlist_drafts WHERE id=$1',[id]);if(!d)deny(404,'not_found','Liste bulunamadı.');await ctx.activeMatch(q,d.match_id,req.actor.id);}});
  });
}
