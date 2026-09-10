import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Context } from './context.js';
import { checkPassword,deny } from './security.js';
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

  // Suspended users cannot hold an authenticated session, so appeals use fresh credentials and a strict public rate limit.
  app.post('/v1/moderation/appeals',async req=>{
    const {email,password,body}=z.object({email:z.email().max(254).transform(v=>v.trim().toLowerCase()),password:z.string().max(128),body:z.string().trim().min(20).max(2000)}).parse(req.body);
    const [u]=await ctx.db.query('SELECT * FROM users WHERE email=$1',[email]);
    if(!u||!await checkPassword(password,u.password_hash))deny(401,'invalid_credentials','E-posta veya parola yanlış.');
    if(u.status!=='suspended')deny(409,'not_suspended','Bu hesap şu anda askıda değil.');
    const result=await ctx.db.tx(async q=>{
      const [existing]=await q.query("SELECT id FROM moderation_appeals WHERE user_id=$1 AND status='open' ORDER BY created_at DESC LIMIT 1",[u.id]);
      if(existing)return {id:existing.id,status:'open'};
      const [action]=await q.query("SELECT id FROM moderation_actions WHERE action='suspend' AND report_id IN (SELECT id FROM reports WHERE target_user_id=$1) ORDER BY created_at DESC LIMIT 1",[u.id]);
      const id=randomUUID();await q.query('INSERT INTO moderation_appeals(id,user_id,action_id,body_ciphertext) VALUES($1,$2,$3,$4)',[id,u.id,action?.id??null,ctx.crypto.seal(body,`appeal:${id}`)]);
      await ctx.audit(q,u.id,'moderation.appeal_created',id);return {id,status:'open'};
    });
    return result;
  });

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
    const {id}=z.object({id:z.uuid()}).parse(req.params),{action,note,suspendDays}=z.object({action:z.enum(['dismiss','warn','suspend','remove_content']),note:z.string().trim().min(5).max(1000),suspendDays:z.number().int().min(1).max(90).default(7)}).parse(req.body);let target='';
    const result=await ctx.write(req,'moderation.action',async q=>{
      await ctx.moderator(req,q);const [r]=await q.query('SELECT * FROM reports WHERE id=$1 FOR UPDATE',[id]);if(!r)deny(404,'not_found','Rapor bulunamadı.');
      if(r.status!=='open')deny(409,'report_closed','Bu rapor daha önce sonuçlandırılmış.');
      if(r.target_user_id===req.actor.id||r.reporter_id===req.actor.id)deny(403,'conflict_of_interest','Kendi taraf olduğun raporu sonuçlandıramazsın.');
      target=r.target_user_id;
      if(action==='suspend'){
        await q.query("UPDATE users SET status='suspended',suspended_until=now()+($2::text || ' days')::interval,suspension_reason_ciphertext=$3 WHERE id=$1",[target,suspendDays,ctx.crypto.seal(note,`suspension:${target}`)]);
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
      await q.query("UPDATE reports SET status='resolved' WHERE id=$1",[id]);return {ok:true,suspendedUntil:action==='suspend'?new Date(Date.now()+suspendDays*86400000).toISOString():null};
    },{guard:q=>ctx.moderator(req,q)});
    if(action==='suspend')ctx.closeUser(target);await ctx.changed([target]);return result;
  });

  app.get('/v1/admin/appeals',async req=>ctx.db.tx(async q=>{
    await ctx.moderator(req,q);await ctx.audit(q,req.actor.id,'moderation.appeals_viewed');
    const rows=await q.query(`SELECT a.id,a.user_id,a.body_ciphertext,a.status,a.created_at,p.display_name,u.suspended_until
      FROM moderation_appeals a JOIN users u ON u.id=a.user_id JOIN profiles p ON p.user_id=a.user_id
      ORDER BY a.status='open' DESC,a.created_at LIMIT 100`);
    return {items:rows.map(a=>({id:a.id,userId:a.user_id,displayName:a.display_name,status:a.status,createdAt:a.created_at,suspendedUntil:a.suspended_until,body:ctx.crypto.open(a.body_ciphertext,`appeal:${a.id}`)}))};
  }));
  app.post('/v1/admin/appeals/:id/actions',async req=>{
    const {id}=z.object({id:z.uuid()}).parse(req.params),{decision,note}=z.object({decision:z.enum(['accept','reject']),note:z.string().trim().min(5).max(1000)}).parse(req.body);let target='';
    const result=await ctx.write(req,'moderation.appeal_decided',async q=>{
      await ctx.moderator(req,q);const [appeal]=await q.query('SELECT * FROM moderation_appeals WHERE id=$1 FOR UPDATE',[id]);if(!appeal)deny(404,'not_found','İtiraz bulunamadı.');
      if(appeal.status!=='open')deny(409,'appeal_closed','Bu itiraz daha önce sonuçlandırılmış.');target=appeal.user_id;
      if(decision==='accept')await q.query("UPDATE users SET status='active',suspended_until=NULL,suspension_reason_ciphertext=NULL WHERE id=$1",[target]);
      await q.query("UPDATE moderation_appeals SET status=$2,reviewed_by=$3,review_note_ciphertext=$4,reviewed_at=now() WHERE id=$1",[id,decision==='accept'?'accepted':'rejected',req.actor.id,ctx.crypto.seal(note,`appeal-review:${id}`)]);
      await ctx.audit(q,req.actor.id,decision==='accept'?'moderation.appeal_accepted':'moderation.appeal_rejected',id);return {ok:true};
    },{guard:q=>ctx.moderator(req,q)});
    await ctx.changed([target]);return result;
  });
}
