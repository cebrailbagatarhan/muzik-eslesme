import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Context } from './context.js';
import { deny } from './security.js';
export const REPORT_CATEGORIES=['harassment','threat','impersonation','underage','nudity','spam','fraud','other'] as const;
export async function moderationRoutes(app:FastifyInstance,ctx:Context) {
  app.post('/v1/blocks',async req=>{
    const {userId}=z.object({userId:z.uuid()}).parse(req.body);
    const result=await ctx.write(req,'user.blocked',async q=>{
      if(userId===req.actor.id)deny(400,'invalid_target','Kendini engelleyemezsin.');
      await ctx.user(q,userId);
      await q.query('INSERT INTO blocks(blocker_id,blocked_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[req.actor.id,userId]);
      await q.query("UPDATE matches SET status='blocked' WHERE (user_a=$1 AND user_b=$2) OR (user_a=$2 AND user_b=$1)",[req.actor.id,userId]);
      await q.query('DELETE FROM instagram_share_consents WHERE match_id IN (SELECT id FROM matches WHERE (user_a=$1 AND user_b=$2) OR (user_a=$2 AND user_b=$1))',[req.actor.id,userId]);
      return {ok:true};
    });await ctx.changed([req.actor.id,userId]);return result;
  });
  app.get('/v1/blocks',async req=>({items:await ctx.db.query('SELECT b.blocked_id AS id,p.display_name AS "displayName" FROM blocks b JOIN profiles p ON p.user_id=b.blocked_id WHERE b.blocker_id=$1 ORDER BY b.created_at DESC',[req.actor.id])}));
  app.delete('/v1/blocks/:id',async req=>{
    const {id}=z.object({id:z.uuid()}).parse(req.params);
    return ctx.write(req,'user.unblocked',async q=>{
      await q.query('DELETE FROM blocks WHERE blocker_id=$1 AND blocked_id=$2',[req.actor.id,id]);
      // Old matches and social consents are intentionally never reactivated.
      return {ok:true};
    });
  });
  app.post('/v1/reports',async req=>{
    const input=z.object({targetType:z.enum(['user','message','photo']),targetId:z.uuid(),category:z.enum(REPORT_CATEGORIES),detail:z.string().trim().max(1500).default('')}).parse(req.body);
    let targetUser='';
    const result=await ctx.write(req,'report.created',async q=>{
      let evidence='';
      if(input.targetType==='user'){
        targetUser=input.targetId;const u=await ctx.user(q,targetUser);
        const seen=await q.query('SELECT 1 FROM feed_impressions WHERE viewer_id=$1 AND target_id=$2 UNION ALL SELECT 1 FROM matches WHERE (user_a=$1 AND user_b=$2) OR (user_a=$2 AND user_b=$1) LIMIT 1',[req.actor.id,targetUser]);
        if(!seen.length)deny(404,'not_found','Bu kullanıcıya erişilemiyor.');
        evidence=JSON.stringify({displayName:u.display_name,bio:u.bio});
      }else if(input.targetType==='message'){
        const [m]=await q.query('SELECT * FROM messages WHERE id=$1',[input.targetId]);if(!m)deny(404,'not_found','Mesaj bulunamadı.');
        await ctx.activeMatch(q,m.match_id,req.actor.id);targetUser=m.sender_id;
        evidence=m.body_ciphertext?ctx.crypto.open(m.body_ciphertext,`message:${m.id}`):'Silinmiş mesaj';
      }else{
        const [p]=await q.query("SELECT user_id FROM profile_photos WHERE id=$1 AND status='approved'",[input.targetId]);if(!p)deny(404,'not_found','Fotoğraf bulunamadı.');
        targetUser=p.user_id;
        const seen=await q.query('SELECT 1 FROM feed_impressions WHERE viewer_id=$1 AND target_id=$2 UNION ALL SELECT 1 FROM matches WHERE (user_a=$1 AND user_b=$2) OR (user_a=$2 AND user_b=$1) LIMIT 1',[req.actor.id,targetUser]);
        if(!seen.length)deny(404,'not_found','Fotoğrafa erişilemiyor.');
        evidence=JSON.stringify({photoId:input.targetId});
      }
      if(targetUser===req.actor.id)deny(400,'invalid_target','Kendini şikâyet edemezsin.');
      const id=randomUUID();
      await q.query(`INSERT INTO reports(id,reporter_id,target_user_id,target_type,target_id,category,detail_ciphertext,evidence_ciphertext,priority)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[id,req.actor.id,targetUser,input.targetType,input.targetId,input.category,ctx.crypto.seal(input.detail,`report:${id}`),ctx.crypto.seal(evidence,`evidence:${id}`),['threat','underage'].includes(input.category)?0:1]);
      await q.query("UPDATE matches SET status='removed' WHERE (user_a=$1 AND user_b=$2) OR (user_a=$2 AND user_b=$1)",[req.actor.id,targetUser]);
      await q.query('DELETE FROM instagram_share_consents WHERE match_id IN (SELECT id FROM matches WHERE (user_a=$1 AND user_b=$2) OR (user_a=$2 AND user_b=$1))',[req.actor.id,targetUser]);
      return {id,status:'open'};
    });await ctx.changed([req.actor.id,targetUser]);return result;
  });
  app.get('/v1/reports',async req=>({items:await ctx.db.query('SELECT id,category,status,created_at FROM reports WHERE reporter_id=$1 ORDER BY created_at DESC',[req.actor.id])}));
  app.get('/v1/notices',async req=>({items:await ctx.db.query(`SELECT a.id,a.action,a.created_at FROM moderation_actions a JOIN reports r ON r.id=a.report_id WHERE r.target_user_id=$1 ORDER BY a.created_at DESC LIMIT 20`,[req.actor.id])}));
  app.get('/v1/admin/reports',async req=>ctx.db.tx(async q=>{
    await ctx.moderator(req,q);await ctx.audit(q,req.actor.id,'moderation.queue_viewed');
    return {items:await q.query(`SELECT r.id,r.category,r.priority,r.status,r.target_type,r.created_at,p.display_name AS target_name
      FROM reports r LEFT JOIN profiles p ON p.user_id=r.target_user_id ORDER BY r.status='open' DESC,r.priority,r.created_at LIMIT 100`)};
  }));
  app.get('/v1/admin/reports/:id',async req=>ctx.db.tx(async q=>{
    await ctx.moderator(req,q);const {id}=z.object({id:z.uuid()}).parse(req.params);
    const [r]=await q.query('SELECT * FROM reports WHERE id=$1',[id]);if(!r)deny(404,'not_found','Rapor bulunamadı.');
    await ctx.audit(q,req.actor.id,'moderation.evidence_viewed',id);
    return {id:r.id,targetUserId:r.target_user_id,targetId:r.target_id,targetType:r.target_type,category:r.category,status:r.status,
      detail:r.detail_ciphertext?ctx.crypto.open(r.detail_ciphertext,`report:${id}`):'',evidence:r.evidence_ciphertext?ctx.crypto.open(r.evidence_ciphertext,`evidence:${id}`):'',
      actions:await q.query('SELECT action,created_at FROM moderation_actions WHERE report_id=$1 ORDER BY created_at',[id])};
  }));
  app.post('/v1/admin/reports/:id/actions',async req=>{
    const {id}=z.object({id:z.uuid()}).parse(req.params),{action,note}=z.object({action:z.enum(['dismiss','warn','suspend','remove_content']),note:z.string().trim().min(5).max(1000)}).parse(req.body);let target='';
    const result=await ctx.write(req,'moderation.action',async q=>{
      await ctx.moderator(req,q);const [r]=await q.query('SELECT * FROM reports WHERE id=$1 FOR UPDATE',[id]);if(!r)deny(404,'not_found','Rapor bulunamadı.');
      if(r.status!=='open')deny(409,'report_closed','Bu rapor daha önce sonuçlandırılmış.');
      if(r.target_user_id===req.actor.id||r.reporter_id===req.actor.id)deny(403,'conflict_of_interest','Kendi taraf olduğun raporu sonuçlandıramazsın.');
      target=r.target_user_id;
      if(action==='suspend'){
        await q.query("UPDATE users SET status='suspended' WHERE id=$1",[target]);
        await q.query('DELETE FROM sessions WHERE user_id=$1',[target]);
        await q.query("UPDATE matches SET status='removed' WHERE user_a=$1 OR user_b=$1",[target]);
        await q.query('DELETE FROM instagram_share_consents WHERE match_id IN (SELECT id FROM matches WHERE user_a=$1 OR user_b=$1)',[target]);
      }
      if(action==='remove_content'){
        if(r.target_type==='message')await q.query('UPDATE messages SET body_ciphertext=NULL,deleted_at=now() WHERE id=$1',[r.target_id]);
        else if(r.target_type==='photo')await q.query("UPDATE profile_photos SET status='rejected',content_ciphertext='' WHERE id=$1",[r.target_id]);
        else await q.query("UPDATE profiles SET bio='' WHERE user_id=$1",[target]);
      }
      const actionId=randomUUID();await q.query('INSERT INTO moderation_actions(id,report_id,actor_id,action,note_ciphertext) VALUES($1,$2,$3,$4,$5)',[actionId,id,req.actor.id,action,ctx.crypto.seal(note,`moderation:${actionId}`)]);
      await q.query("UPDATE reports SET status='resolved' WHERE id=$1",[id]);return {ok:true};
    },{guard:q=>ctx.moderator(req,q)});
    if(action==='suspend')ctx.closeUser(target);await ctx.changed([target]);return result;
  });
}
