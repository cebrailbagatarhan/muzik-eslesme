import { createHash,randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Context } from './context.js';
import type { Query,Row } from './db.js';
import type { PlaylistItem } from './engine.js';
import { deny,secret,sha,Problem } from './security.js';
const tokensSchema=z.object({access_token:z.string().min(10),refresh_token:z.string().min(10).optional(),expires_in:z.number().positive(),scope:z.string().optional()});
export class SpotifyAdapter {
  constructor(public ctx:Context,private request:typeof fetch=fetch){}
  allowed(userId:string) {
    if(!this.ctx.config.spotifyEnabled||!this.ctx.config.spotifyAllowlist.includes(userId))deny(403,'feature_disabled','Spotify bağlantısı bu hesap için açık değil.');
  }
  async tokenRequest(parameters:Record<string,string>) {
    let response:Response;
    try{response=await this.request('https://accounts.spotify.com/api/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(parameters),signal:AbortSignal.timeout(15000)});}catch{deny(503,'spotify_unavailable','Spotify bağlantısı kurulamadı.');}
    if(!response!.ok)deny(502,'spotify_auth_failed','Spotify bağlantısını yeniden kurman gerekiyor.');
    return tokensSchema.parse(await response!.json());
  }
  async saveTokens(q:Query,userId:string,tokens:z.infer<typeof tokensSchema>,oldRefresh?:string) {
    const refresh=tokens.refresh_token??oldRefresh;if(!refresh)deny(502,'spotify_auth_failed','Spotify yenileme izni alınamadı.');
    await q.query(`INSERT INTO oauth_connections(user_id,access_ciphertext,refresh_ciphertext,expires_at) VALUES($1,$2,$3,$4)
      ON CONFLICT(user_id) DO UPDATE SET access_ciphertext=EXCLUDED.access_ciphertext,refresh_ciphertext=EXCLUDED.refresh_ciphertext,expires_at=EXCLUDED.expires_at`,
      [userId,this.ctx.crypto.seal(tokens.access_token,`spotify-access:${userId}`),this.ctx.crypto.seal(refresh!,`spotify-refresh:${userId}`),new Date(Date.now()+tokens.expires_in*1000)]);
  }
  async getToken(userId:string) {
    return this.ctx.db.tx(async q=>{
      const [connection]=await q.query('SELECT * FROM oauth_connections WHERE user_id=$1 FOR UPDATE',[userId]);if(!connection)deny(409,'spotify_not_connected','Önce Spotify hesabını bağla.');
      if(new Date(connection.expires_at).getTime()>Date.now()+60000)return this.ctx.crypto.open(connection.access_ciphertext,`spotify-access:${userId}`);
      const refresh=this.ctx.crypto.open(connection.refresh_ciphertext,`spotify-refresh:${userId}`);
      const tokens=await this.tokenRequest({grant_type:'refresh_token',refresh_token:refresh,client_id:this.ctx.config.spotifyClientId});
      await this.saveTokens(q,userId,tokens,refresh);return tokens.access_token;
    });
  }
  async draft(q:Query,id:string,userId:string) {
    const [draft]=await q.query('SELECT * FROM playlist_drafts WHERE id=$1',[id]);if(!draft)deny(404,'not_found','Liste bulunamadı.');
    const match=await this.ctx.activeMatch(q,draft.match_id,userId),a=await this.ctx.user(q,match.user_a),b=await this.ctx.user(q,match.user_b),catalog=await this.ctx.catalog(q);
    const ta=await this.ctx.taste(q,a,catalog),tb=await this.ctx.taste(q,b,catalog),negative=new Set([...ta.negative,...tb.negative]);
    const uris=(draft.items as PlaylistItem[]).map(item=>{
      const t=catalog.find(t=>t.id===item.trackId);
      if(!t||negative.has(t.id)||t.explicit&&!(a.allow_explicit&&b.allow_explicit))deny(409,'playlist_changed','Müzik tercihleri değişmiş. Listeyi yeniden oluştur.');
      if(t!.rights_status!=='licensed'||!t!.spotify_uri||!/^spotify:track:[A-Za-z0-9]{22}$/.test(t!.spotify_uri))deny(409,'export_unavailable','Listedeki parçaların Spotify aktarımı henüz tanımlı değil.');
      return t!.spotify_uri!;
    });return {draft,uris};
  }
  async runOnce() {
    if(!this.ctx.config.spotifyEnabled)return;
    const job=await this.ctx.db.tx(async q=>{
      // A lost create response is not retried: Spotify has no create idempotency key.
      await q.query("UPDATE spotify_exports SET status='uncertain',last_error='create_result_unknown' WHERE status='creating' AND locked_until<now()");
      await q.query("UPDATE spotify_exports SET status='queued',locked_until=NULL WHERE status='filling' AND locked_until<now()");
      const [candidate]=await q.query("SELECT * FROM spotify_exports WHERE status='queued' AND retry_at<=now() ORDER BY retry_at,id FOR UPDATE SKIP LOCKED LIMIT 1");
      if(!candidate)return null;
      await q.query("UPDATE spotify_exports SET status=$2,locked_until=now()+interval '2 minutes' WHERE id=$1",[candidate.id,candidate.playlist_id?'filling':'creating']);return candidate;
    });
    if(!job)return;
    let phase: 'validate'|'create'|'fill'='validate';
    try{
      this.allowed(job.user_id);
      await this.ctx.db.tx(async q=>{
        const {draft,uris}=await this.draft(q,job.draft_id,job.user_id);
        if(draft.revision!==job.revision||JSON.stringify(uris)!==JSON.stringify(job.uris))deny(409,'playlist_changed','Liste değişmiş.');
      });
      const access=await this.getToken(job.user_id);phase=job.playlist_id?'fill':'create';
      const response=await this.request(job.playlist_id?`https://api.spotify.com/v1/playlists/${job.playlist_id}/items`:'https://api.spotify.com/v1/me/playlists',{
        method:job.playlist_id?'PUT':'POST',headers:{Authorization:`Bearer ${access}`,'Content-Type':'application/json'},
        body:JSON.stringify(job.playlist_id?{uris:job.uris}:{name:'Ahenk · Ortak keşif',public:false,description:'Uygulama içindeki açık müzik seçimleriyle oluşturuldu.'}),signal:AbortSignal.timeout(15000),
      });
      if(response.status===429){
        const seconds=Math.max(1,Math.min(3600,Number(response.headers.get('retry-after'))||30));
        await this.ctx.db.query("UPDATE spotify_exports SET status='queued',locked_until=NULL,retry_at=$2,last_error='rate_limited' WHERE id=$1",[job.id,new Date(Date.now()+seconds*1000)]);return;
      }
      if(!response.ok){
        // 4xx means a definite rejection; 5xx during create can hide a successful side effect.
        const uncertain=phase==='create'&&response.status>=500;
        await this.ctx.db.query('UPDATE spotify_exports SET status=$2,last_error=$3,locked_until=NULL WHERE id=$1',[job.id,uncertain?'uncertain':'failed',`spotify_http_${response.status}`]);return;
      }
      if(!job.playlist_id){
        const data=z.object({id:z.string().regex(/^[A-Za-z0-9]{22}$/)}).parse(await response.json());
        await this.ctx.db.query("UPDATE spotify_exports SET playlist_id=$2,playlist_url=$3,status='queued',locked_until=NULL,last_error=NULL,retry_at=now() WHERE id=$1",[job.id,data.id,`https://open.spotify.com/playlist/${data.id}`]);
      }else{
        await this.ctx.db.query("UPDATE spotify_exports SET status='completed',locked_until=NULL,last_error=NULL WHERE id=$1",[job.id]);
        await this.ctx.changed([job.user_id]);
      }
    }catch(error){
      const state=error instanceof Problem?'cancelled':phase==='create'?'uncertain':phase==='fill'?'queued':'failed';
      await this.ctx.db.query("UPDATE spotify_exports SET status=$2,last_error=$3,locked_until=NULL,retry_at=now()+interval '30 seconds' WHERE id=$1",[job.id,state,error instanceof Problem?error.code:'request_result_unknown']);
    }
  }
}
export async function spotifyRoutes(app:FastifyInstance,ctx:Context,adapter:SpotifyAdapter) {
  app.get('/v1/integrations/spotify/status',async req=>({enabled:ctx.config.spotifyEnabled&&ctx.config.spotifyAllowlist.includes(req.actor.id),connected:(await ctx.db.query('SELECT 1 FROM oauth_connections WHERE user_id=$1',[req.actor.id])).length>0}));
  app.post('/v1/integrations/spotify/connect',async req=>{
    adapter.allowed(req.actor.id);
    return ctx.write(req,'spotify.connect_started',async q=>{
      const state=secret(),verifier=secret(),challenge=createHash('sha256').update(verifier).digest('base64url');
      await q.query('INSERT INTO oauth_states(state_hash,user_id,verifier_ciphertext,expires_at) VALUES($1,$2,$3,now()+interval \'10 minutes\')',[sha(state),req.actor.id,ctx.crypto.seal(verifier,`pkce:${sha(state)}`)]);
      const parameters=new URLSearchParams({response_type:'code',client_id:ctx.config.spotifyClientId,redirect_uri:ctx.config.spotifyRedirectUri,scope:'playlist-modify-private',state,code_challenge_method:'S256',code_challenge:challenge});
      return {url:`https://accounts.spotify.com/authorize?${parameters}`};
    });
  });
  app.get('/v1/integrations/spotify/callback',async(req,reply)=>{
    const {state,code,error}=z.object({state:z.string().min(40).max(100),code:z.string().max(2000).optional(),error:z.string().max(100).optional()}).parse(req.query);
    const [pending]=await ctx.db.query('UPDATE oauth_states SET expires_at=now() WHERE state_hash=$1 AND expires_at>now() RETURNING *',[sha(state)]);
    if(!pending)deny(400,'invalid_state','Bağlantı isteğinin süresi dolmuş veya daha önce kullanılmış.');
    adapter.allowed(pending.user_id);
    if(error||!code){await ctx.db.query('DELETE FROM oauth_states WHERE state_hash=$1',[sha(state)]);return reply.type('text/plain; charset=utf-8').send('Spotify bağlantısı iptal edildi. Uygulamaya dönebilirsin.');}
    const tokens=await adapter.tokenRequest({grant_type:'authorization_code',code,client_id:ctx.config.spotifyClientId,redirect_uri:ctx.config.spotifyRedirectUri,code_verifier:ctx.crypto.open(pending.verifier_ciphertext,`pkce:${sha(state)}`)});
    if(!tokens.scope?.split(' ').includes('playlist-modify-private'))deny(403,'scope_missing','Özel çalma listesi izni verilmedi.');
    await ctx.db.tx(async q=>{
      if(!(await q.query('SELECT 1 FROM oauth_states s JOIN users u ON u.id=s.user_id WHERE s.state_hash=$1 AND u.status=\'active\'',[sha(state)])).length)deny(409,'connection_cancelled','Bağlantı isteği iptal edilmiş.');
      await adapter.saveTokens(q,pending.user_id,tokens);await q.query('DELETE FROM oauth_states WHERE state_hash=$1',[sha(state)]);await ctx.audit(q,pending.user_id,'spotify.connected');
    });
    return reply.type('text/plain; charset=utf-8').send('Spotify bağlantısı tamamlandı. Uygulamaya dönüp bağlantı durumunu yenileyebilirsin.');
  });
  app.delete('/v1/integrations/spotify',async req=>ctx.write(req,'spotify.disconnected',async q=>{
    await q.query('DELETE FROM oauth_connections WHERE user_id=$1',[req.actor.id]);await q.query('DELETE FROM oauth_states WHERE user_id=$1',[req.actor.id]);await q.query('DELETE FROM spotify_exports WHERE user_id=$1',[req.actor.id]);return {ok:true};
  }));
  app.post('/v1/playlist-drafts/:id/spotify-export',async req=>{
    adapter.allowed(req.actor.id);const {id}=z.object({id:z.uuid()}).parse(req.params);z.object({confirmed:z.literal(true)}).parse(req.body);
    return ctx.write(req,'spotify.export_requested',async q=>{
      const {draft,uris}=await adapter.draft(q,id,req.actor.id);
      if(!(await q.query('SELECT 1 FROM oauth_connections WHERE user_id=$1',[req.actor.id])).length)deny(409,'spotify_not_connected','Önce Spotify hesabını bağla.');
      const jobId=randomUUID();await q.query("INSERT INTO spotify_exports(id,user_id,draft_id,revision,status,operation_key,uris) VALUES($1,$2,$3,$4,'queued',$5,$6) ON CONFLICT(user_id,draft_id,revision) DO NOTHING",[jobId,req.actor.id,id,draft.revision,req.headers['idempotency-key'],JSON.stringify(uris)]);
      const [job]=await q.query('SELECT id,status FROM spotify_exports WHERE user_id=$1 AND draft_id=$2 AND revision=$3',[req.actor.id,id,draft.revision]);return job;
    },{guard:q=>adapter.draft(q,id,req.actor.id)});
  });
  app.get('/v1/spotify-exports/:id',async req=>ctx.db.tx(async q=>{
    const {id}=z.object({id:z.uuid()}).parse(req.params);const [job]=await q.query('SELECT * FROM spotify_exports WHERE id=$1 AND user_id=$2',[id,req.actor.id]);if(!job)deny(404,'not_found','Aktarım bulunamadı.');
    const [draft]=await q.query('SELECT match_id FROM playlist_drafts WHERE id=$1',[job.draft_id]);await ctx.activeMatch(q,draft.match_id,req.actor.id);
    return {id:job.id,status:job.status,url:job.playlist_url,retryAt:job.retry_at,error:job.last_error};
  }));
}
