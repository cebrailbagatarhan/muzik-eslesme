import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Context } from './context.js';
import { ALGORITHM_VERSION,compatibility,tasteProfile } from './engine.js';
import { ageOn,birthString,deny,instagramName,checkPassword } from './security.js';
const profileSchema=z.object({
  displayName:z.string().trim().min(2).max(40),bio:z.string().trim().max(280),city:z.string().trim().min(2).max(60),
  ageMin:z.number().int().min(18).max(99),ageMax:z.number().int().min(18).max(99),
  intention:z.enum(['friendship','dating']),exploration:z.number().min(0).max(1),allowExplicit:z.boolean(),
  genres:z.array(z.string().max(60)).max(8),artists:z.array(z.string().max(120)).max(15),
}).refine(p=>p.ageMin<=p.ageMax,{message:'Yaş aralığı geçersiz.'});
export async function coreRoutes(app:FastifyInstance,ctx:Context) {
  app.get('/v1/me',async req=>ctx.db.tx(async q=>{
    const u=await ctx.user(q,req.actor.id),taste=await ctx.taste(q,u);
    const [ig]=await q.query('SELECT username_ciphertext FROM instagram_accounts WHERE user_id=$1',[u.id]);
    const photos=await q.query('SELECT id,status FROM profile_photos WHERE user_id=$1 ORDER BY created_at DESC',[u.id]);
    return {id:u.id,email:u.email,displayName:u.display_name,bio:u.bio,city:u.city,age:ageOn(birthString(u.birth_date)),
      ageVerified:u.age_verified,role:u.role,ageMin:u.age_min,ageMax:u.age_max,intention:u.intention,exploration:u.exploration,allowExplicit:u.allow_explicit,
      genres:u.genres,artists:u.artists,instagram:ig?ctx.crypto.open(ig.username_ciphertext,`instagram:${u.id}`):'',photos,
      rated:taste.rated,requiredRatings:ctx.config.minRatings,onboardingComplete:u.age_verified&&taste.rated>=ctx.config.minRatings};
  }));
  app.post('/v1/onboarding/age-check',async req=>ctx.write(req,'age.checked',async q=>{
    const u=await ctx.user(q,req.actor.id);
    return {ageVerified:u.age_verified,method:ctx.config.mode==='demo'?'self-declaration-demo':'external-provider',age:ageOn(birthString(u.birth_date))};
  }));
  app.put('/v1/profile',async req=>{
    const p=profileSchema.parse(req.body);
    return ctx.write(req,'profile.updated',async q=>{
      const catalog=await ctx.catalog(q),genres=new Set(catalog.flatMap(t=>t.genres)),artists=new Set(catalog.map(t=>t.artist));
      if(p.genres.some(g=>!genres.has(g))||p.artists.some(a=>!artists.has(a)))deny(400,'invalid_selection','Katalogdaki tür ve sanatçılardan seçim yap.');
      await q.query(`UPDATE profiles SET display_name=$2,bio=$3,city=$4,age_min=$5,age_max=$6,intention=$7,exploration=$8,allow_explicit=$9,genres=$10,artists=$11 WHERE user_id=$1`,
        [req.actor.id,p.displayName,p.bio,p.city.normalize('NFC').toLocaleLowerCase('tr-TR'),p.ageMin,p.ageMax,p.intention,p.exploration,p.allowExplicit,JSON.stringify([...new Set(p.genres)]),JSON.stringify([...new Set(p.artists)])]);
      return {ok:true};
    });
  });
  async function notifyPeers(id:string) {
    const peers=await ctx.db.query('SELECT user_a,user_b FROM matches WHERE user_a=$1 OR user_b=$1',[id]);
    await ctx.changed([...new Set(peers.flatMap(p=>[p.user_a,p.user_b]))]);
  }
  app.put('/v1/profile/instagram',async req=>{
    const {username}=z.object({username:z.string().max(31)}).parse(req.body),name=instagramName(username);
    const result=await ctx.write(req,'instagram.updated',async q=>{
      await q.query(`INSERT INTO instagram_accounts(user_id,username_ciphertext) VALUES($1,$2)
        ON CONFLICT(user_id) DO UPDATE SET username_ciphertext=EXCLUDED.username_ciphertext`,[req.actor.id,ctx.crypto.seal(name,`instagram:${req.actor.id}`)]);
      await q.query('DELETE FROM instagram_share_consents WHERE match_id IN (SELECT id FROM matches WHERE user_a=$1 OR user_b=$1)',[req.actor.id]);
      return {ok:true};
    });
    await notifyPeers(req.actor.id);return result;
  });
  app.delete('/v1/profile/instagram',async req=>{
    const result=await ctx.write(req,'instagram.deleted',async q=>{
      await q.query('DELETE FROM instagram_accounts WHERE user_id=$1',[req.actor.id]);
      await q.query('DELETE FROM instagram_share_consents WHERE match_id IN (SELECT id FROM matches WHERE user_a=$1 OR user_b=$1)',[req.actor.id]);
      return {ok:true};
    });
    await notifyPeers(req.actor.id);return result;
  });
  app.get('/v1/music/options',async()=>ctx.db.tx(async q=>{
    const catalog=await ctx.catalog(q);return {genres:[...new Set(catalog.flatMap(t=>t.genres))],artists:[...new Set(catalog.map(t=>t.artist))]};
  }));
  app.get('/v1/music/cards',async req=>ctx.db.tx(async q=>{
    const u=await ctx.user(q,req.actor.id),catalog=await ctx.catalog(q);
    const swipes=await q.query('SELECT item_id FROM track_swipes WHERE user_id=$1',[u.id]),used=new Set(swipes.map(s=>s.item_id));
    return {items:catalog.filter(t=>!used.has(t.id)&&(u.allow_explicit||!t.explicit)).slice(0,20).map(({spotify_uri,...t})=>t),total:catalog.length};
  }));
  app.post('/v1/music/swipes',async req=>{
    const {itemId,action}=z.object({itemId:z.uuid(),action:z.enum(['like','dislike','favorite','pass'])}).parse(req.body);
    return ctx.write(req,'music.swiped',async q=>{
      const catalog=await ctx.catalog(q),u=await ctx.user(q,req.actor.id),track=catalog.find(t=>t.id===itemId);
      if(!track||track.explicit&&!u.allow_explicit)deny(404,'track_unavailable','Bu parça kullanılamıyor.');
      const [old]=await q.query('SELECT action FROM track_swipes WHERE user_id=$1 AND item_id=$2',[u.id,itemId]);
      await q.query('INSERT INTO track_swipe_history(id,user_id,item_id,action,previous_action) VALUES($1,$2,$3,$4,$5)',[randomUUID(),u.id,itemId,action,old?.action??null]);
      await q.query(`INSERT INTO track_swipes(user_id,item_id,action) VALUES($1,$2,$3)
        ON CONFLICT(user_id,item_id) DO UPDATE SET action=EXCLUDED.action,occurred_at=now()`,[u.id,itemId,action]);
      const taste=await ctx.taste(q,u,catalog);return {rated:taste.rated,requiredRatings:ctx.config.minRatings,complete:taste.rated>=ctx.config.minRatings};
    });
  });
  app.post('/v1/music/swipes/undo',async req=>ctx.write(req,'music.undo',async q=>{
    const [last]=await q.query('SELECT * FROM track_swipe_history WHERE user_id=$1 AND undone=false ORDER BY occurred_at DESC,id DESC LIMIT 1',[req.actor.id]);
    if(!last)deny(409,'nothing_to_undo','Geri alınacak seçim yok.');
    if(last.previous_action)await q.query('UPDATE track_swipes SET action=$3,occurred_at=now() WHERE user_id=$1 AND item_id=$2',[req.actor.id,last.item_id,last.previous_action]);
    else await q.query('DELETE FROM track_swipes WHERE user_id=$1 AND item_id=$2',[req.actor.id,last.item_id]);
    await q.query('UPDATE track_swipe_history SET undone=true WHERE id=$1',[last.id]);return {itemId:last.item_id};
  }));
  app.get('/v1/taste-profile',async req=>ctx.db.tx(async q=>{
    const u=await ctx.user(q,req.actor.id),taste=await ctx.taste(q,u);
    return {version:ALGORITHM_VERSION,rated:taste.rated,requiredRatings:ctx.config.minRatings,complete:taste.rated>=ctx.config.minRatings,
      favoriteArtists:Object.entries(taste.artists).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([name,weight])=>({name,weight})),
      favoriteGenres:Object.entries(taste.tags).filter(([tag])=>tag.startsWith('genre:')).sort((a,b)=>b[1]-a[1]).map(([name,weight])=>({name:name.slice(6),weight})),exploration:taste.exploration};
  }));
  app.get('/v1/people/feed',async req=>ctx.db.tx(async q=>{
    const me=await ctx.user(q,req.actor.id),catalog=await ctx.catalog(q),myTaste=await ctx.taste(q,me,catalog);
    if(!me.age_verified||ageOn(birthString(me.birth_date))<18)deny(403,'age_verification_required','Kişileri keşfetmek için yaş doğrulaması gerekli.');
    if(myTaste.rated<ctx.config.minRatings)deny(403,'onboarding_required',`Önce en az ${ctx.config.minRatings} parçayı değerlendir.`);
    const [count]=await q.query('SELECT count(*)::int AS n FROM feed_impressions WHERE viewer_id=$1 AND day=CURRENT_DATE',[me.id]);
    const rows=await q.query(`SELECT u.*,p.* FROM users u JOIN profiles p ON p.user_id=u.id WHERE u.id<>$1 AND u.status='active' AND u.age_verified=true AND p.city=$2 AND p.intention=$3
      AND NOT EXISTS(SELECT 1 FROM matches m WHERE (m.user_a=$1 AND m.user_b=u.id) OR (m.user_b=$1 AND m.user_a=u.id))
      AND NOT EXISTS(SELECT 1 FROM person_swipes s WHERE s.actor_id=$1 AND s.target_id=u.id AND (s.action='like' OR s.created_at>now()-interval '7 days'))
      ORDER BY u.last_active_at DESC,u.id LIMIT 200`,[me.id,me.city,me.intention]);
    const impressions=await q.query('SELECT target_id FROM feed_impressions WHERE viewer_id=$1 AND day=CURRENT_DATE',[me.id]),seen=new Set(impressions.map(i=>i.target_id));
    const allSwipes=await q.query('SELECT user_id,item_id,action FROM track_swipes WHERE user_id=ANY($1::uuid[])',[rows.map(r=>r.id)]);
    const candidates=[];
    for(const u of rows){
      if(!await ctx.eligible(q,me,u))continue;
      const taste=tasteProfile(catalog,allSwipes.filter(s=>s.user_id===u.id) as any,u as any);if(taste.rated<ctx.config.minRatings)continue;
      const complete=(u.bio?0.5:0)+0.5,active=Math.max(0,1-(Date.now()-new Date(u.last_active_at).getTime())/(30*86400000));
      candidates.push({u,score:compatibility(myTaste,taste,complete,active)});
    }
    candidates.sort((a,b)=>b.score.rankingScore-a.score.rankingScore||a.u.id.localeCompare(b.u.id));
    const result=[];let added=0;
    for(const {u,score} of candidates){
      if(!seen.has(u.id)&&count.n+added>=100)continue;if(!seen.has(u.id))added++;
      const photos=await q.query("SELECT id FROM profile_photos WHERE user_id=$1 AND status='approved' ORDER BY created_at LIMIT 1",[u.id]);
      const hasInstagram=(await q.query('SELECT 1 FROM instagram_accounts WHERE user_id=$1',[u.id])).length>0;
      result.push({id:u.id,displayName:u.display_name,bio:u.bio,city:u.city,age:ageOn(birthString(u.birth_date)),intention:u.intention,hasInstagram,photoId:photos[0]?.id??null,...score});
      await q.query('INSERT INTO feed_impressions(viewer_id,target_id,algorithm_version) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[me.id,u.id,ALGORITHM_VERSION]);
      if(result.length>=20)break;
    }
    await q.query('UPDATE users SET last_active_at=now() WHERE id=$1',[me.id]);
    return {items:result,algorithmVersion:ALGORITHM_VERSION,dailyRemaining:Math.max(0,100-count.n-added)};
  }));
  app.post('/v1/people/:id/swipes',async req=>{
    const {id}=z.object({id:z.uuid()}).parse(req.params),{action}=z.object({action:z.enum(['like','pass'])}).parse(req.body);
    const result=await ctx.write(req,'person.swiped',async q=>{
      const me=await ctx.user(q,req.actor.id),other=await ctx.user(q,id);
      if(!await ctx.eligible(q,me,other))deny(404,'person_unavailable','Bu kişi önerilerinde yer almıyor.');
      if((await ctx.taste(q,me)).rated<ctx.config.minRatings||(await ctx.taste(q,other)).rated<ctx.config.minRatings)deny(403,'onboarding_required','Müzik seçimlerini tamamla.');
      if(!(await q.query('SELECT 1 FROM feed_impressions WHERE viewer_id=$1 AND target_id=$2',[me.id,id])).length)deny(404,'person_unavailable','Bu kişi önerilerinde yer almıyor.');
      await q.query(`INSERT INTO person_swipes(actor_id,target_id,action) VALUES($1,$2,$3) ON CONFLICT(actor_id,target_id) DO UPDATE SET action=EXCLUDED.action,created_at=now()`,[me.id,id,action]);
      const reciprocal=(await q.query("SELECT 1 FROM person_swipes WHERE actor_id=$1 AND target_id=$2 AND action='like'",[id,me.id])).length;
      if(action==='like'&&reciprocal){
        const [a,b]=[me.id,id].sort();
        await q.query('INSERT INTO matches(id,user_a,user_b,algorithm_version) VALUES($1,$2,$3,$4) ON CONFLICT(user_a,user_b) DO NOTHING',[randomUUID(),a,b,ALGORITHM_VERSION]);
        const [m]=await q.query("SELECT id FROM matches WHERE user_a=$1 AND user_b=$2 AND status='active'",[a,b]);
        return {matched:!!m,matchId:m?.id??null};
      }
      return {matched:false,matchId:null};
    });
    await ctx.changed([req.actor.id,id]);return result;
  });
  app.get('/v1/account/export',async req=>ctx.db.tx(async q=>{
    const u=await ctx.user(q,req.actor.id);
    const profile={displayName:u.display_name,city:u.city,bio:u.bio,birthDate:birthString(u.birth_date),genres:u.genres,artists:u.artists,intention:u.intention,ageMin:u.age_min,ageMax:u.age_max,allowExplicit:u.allow_explicit,exploration:u.exploration,ageVerified:u.age_verified,emailVerified:u.email_verified};
    const swipes=await q.query('SELECT item_id,action,occurred_at FROM track_swipes WHERE user_id=$1',[u.id]);
    const personSwipes=await q.query('SELECT target_id,action,created_at FROM person_swipes WHERE actor_id=$1 ORDER BY created_at',[u.id]);
    const matches=await q.query('SELECT id,user_a,user_b,status,matched_at,algorithm_version FROM matches WHERE user_a=$1 OR user_b=$1 ORDER BY matched_at',[u.id]);
    const messages=await q.query('SELECT id,match_id,body_ciphertext,created_at,read_at,deleted_at FROM messages WHERE sender_id=$1 ORDER BY created_at',[u.id]);
    const consents=await q.query('SELECT kind,version,granted_at,revoked_at FROM consents WHERE user_id=$1 ORDER BY granted_at',[u.id]);
    const blocks=await q.query('SELECT blocked_id,created_at FROM blocks WHERE blocker_id=$1 ORDER BY created_at',[u.id]);
    const reports=await q.query('SELECT id,target_user_id,target_type,target_id,category,status,priority,created_at FROM reports WHERE reporter_id=$1 ORDER BY created_at',[u.id]);
    const photos=await q.query('SELECT id,mime_type,status,created_at FROM profile_photos WHERE user_id=$1 ORDER BY created_at',[u.id]);
    const playlists=await q.query('SELECT id,match_id,algorithm_version,revision,items,created_at FROM playlist_drafts WHERE match_id=ANY($1::uuid[]) ORDER BY created_at',[matches.map(m=>m.id)]);
    const appeals=await q.query('SELECT id,action_id,status,body_ciphertext,review_note_ciphertext,created_at,reviewed_at FROM moderation_appeals WHERE user_id=$1 ORDER BY created_at',[u.id]);
    const spotifyExports=await q.query('SELECT id,draft_id,revision,status,playlist_id,playlist_url,retry_at,last_error FROM spotify_exports WHERE user_id=$1 ORDER BY id',[u.id]);
    const audit=await q.query('SELECT event_type,subject_id,created_at FROM audit_events WHERE actor_id=$1 ORDER BY created_at',[u.id]);
    const notices=await q.query('SELECT a.id,a.action,a.note_ciphertext,a.created_at FROM moderation_actions a JOIN reports r ON r.id=a.report_id WHERE r.target_user_id=$1 ORDER BY a.created_at',[u.id]);
    const [ig]=await q.query('SELECT username_ciphertext FROM instagram_accounts WHERE user_id=$1',[u.id]);
    const [spotifyConnection]=await q.query('SELECT expires_at FROM oauth_connections WHERE user_id=$1',[u.id]);
    await ctx.audit(q,u.id,'account.exported');
    return {email:u.email,profile,swipes,personSwipes,matches,blocks,reports,photos,consents,instagram:ig?ctx.crypto.open(ig.username_ciphertext,`instagram:${u.id}`):null,
      spotifyConnection:spotifyConnection?{connected:true,accessExpiresAt:spotifyConnection.expires_at}:{connected:false},spotifyExports,audit,
      appeals:appeals.map(a=>({id:a.id,actionId:a.action_id,status:a.status,body:ctx.crypto.open(a.body_ciphertext,`appeal:${a.id}`),reviewNote:a.review_note_ciphertext?ctx.crypto.open(a.review_note_ciphertext,`appeal-review:${a.id}`):null,createdAt:a.created_at,reviewedAt:a.reviewed_at})),
      notices:notices.map(n=>({id:n.id,action:n.action,note:ctx.crypto.open(n.note_ciphertext,`moderation:${n.id}`),createdAt:n.created_at})),
      playlistDrafts:playlists,
      messages:messages.map(m=>({id:m.id,matchId:m.match_id,body:m.body_ciphertext?ctx.crypto.open(m.body_ciphertext,`message:${m.id}`):null,createdAt:m.created_at,readAt:m.read_at,deletedAt:m.deleted_at}))};
  }));
  app.delete('/v1/account',async req=>{
    const {password}=z.object({password:z.string().max(128)}).parse(req.body);
    const peers=await ctx.db.tx(async q=>{
      const actor=await ctx.authenticate(req,q),u=await ctx.user(q,actor.id);
      if(!await checkPassword(password,u.password_hash))deny(401,'invalid_credentials','Hesabı silmek için parolanı doğrula.');
      const matches=await q.query('SELECT id,user_a,user_b FROM matches WHERE user_a=$1 OR user_b=$1',[u.id]);
      await q.query('DELETE FROM reports WHERE reporter_id=$1 OR target_user_id=$1',[u.id]);
      await q.query('DELETE FROM audit_events WHERE actor_id=$1 OR subject_id=$1 OR subject_id=ANY($2::uuid[])',[u.id,matches.map(m=>m.id)]);
      await q.query('DELETE FROM users WHERE id=$1',[u.id]);
      await ctx.audit(q,null,'account.deleted');return matches.flatMap(m=>[m.user_a,m.user_b]);
    });
    ctx.closeUser(req.actor.id);await ctx.changed(peers);return {ok:true};
  });
}
