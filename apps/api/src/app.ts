import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import websocket from '@fastify/websocket';
import { createClient } from 'redis';
import { z } from 'zod';
import type { WebSocket } from 'ws';
import type { Config } from './config.js';
import type { Database } from './db.js';
import { Context } from './context.js';
import { Problem,deny,sha,secret } from './security.js';
import { authRoutes } from './auth.js';
import { coreRoutes } from './core-routes.js';
import { socialRoutes } from './social-routes.js';
import { moderationRoutes } from './moderation-routes.js';
import { privacyRoutes } from './privacy-routes.js';
import { photoRoutes } from './photo-routes.js';
import { SpotifyAdapter,spotifyRoutes } from './spotify.js';
export async function buildApp(config:Config,db:Database,options:{request?:typeof fetch;logger?:boolean}={}) {
  const app=Fastify({bodyLimit:4*1024*1024+2048,requestTimeout:30000,trustProxy:false,logger:options.logger?{
    redact:['req.headers.authorization','req.headers.cookie','req.body','res.headers.set-cookie'],
    serializers:{req:(req:any)=>({method:req.method,url:req.url?.split('?')[0]})},
  }:false});
  const ctx=new Context(db,config),spotify=new SpotifyAdapter(ctx,options.request);
  const redis=config.redisUrl?createClient({url:config.redisUrl,socket:{connectTimeout:5000,reconnectStrategy:attempt=>attempt<3?250: false}}):undefined;
  redis?.on('error',()=>{});if(redis)await redis.connect();
  const subscriber=redis?.duplicate();subscriber?.on('error',()=>{});if(subscriber)await subscriber.connect();
  await app.register(cors,{origin:config.origins,methods:['GET','POST','PUT','DELETE','OPTIONS'],allowedHeaders:['Content-Type','Authorization','Idempotency-Key'],credentials:false});
  await app.register(helmet,{contentSecurityPolicy:{directives:{defaultSrc:["'none'"],frameAncestors:["'none'"]}}});
  await app.register(websocket,{options:{maxPayload:2048}});
  const memory=new Map<string,{n:number;until:number}>();
  async function rate(key:string,limit:number,window=60000) {
    const now=Date.now();let n:number;
    if(redis){
      if(!redis.isReady)deny(503,'temporarily_unavailable','Servis kısa süreliğine kullanılamıyor.');
      n=Number(await redis.eval("local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('PEXPIRE',KEYS[1],ARGV[1]); end; return n",{keys:[`ahenk:rate:${sha(key)}`],arguments:[String(window)]}));
    }else{
      let entry=memory.get(key);if(!entry||entry.until<=now){entry={n:0,until:now+window};memory.set(key,entry);}n=++entry.n;
      if(memory.size>10000){for(const [key,value] of memory)if(value.until<=now)memory.delete(key);}
      if(memory.size>20000)deny(503,'temporarily_unavailable','Servis kısa süreliğine kullanılamıyor.');
    }
    if(n>limit*config.rateMultiplier)deny(429,'rate_limited','Çok hızlı işlem yapıyorsun. Biraz sonra tekrar dene.');
  }
  const publicRoutes=new Set(['/health','/v1/config','/v1/auth/register','/v1/auth/login','/v1/auth/refresh','/v1/auth/email-verification/request','/v1/auth/email-verification/confirm','/v1/auth/password-reset/request','/v1/auth/password-reset/confirm','/v1/moderation/appeals','/v1/verification/age','/v1/integrations/spotify/callback','/v1/events']);
  const sensitivePublic=new Set(['/v1/auth/register','/v1/auth/login','/v1/auth/refresh','/v1/auth/email-verification/request','/v1/auth/email-verification/confirm','/v1/auth/password-reset/request','/v1/auth/password-reset/confirm','/v1/moderation/appeals']);
  app.decorateRequest('actor',null as unknown as import('./context.js').Actor);
  app.addHook('onRequest',async(req,reply)=>{
    reply.header('Cache-Control','no-store');
    if(req.method==='OPTIONS')return;
    await rate(`ip:${req.ip}`,600);
    if(sensitivePublic.has(req.routeOptions.url??''))await rate(`auth:${req.ip}`,15,300000);
  });
  app.addHook('preHandler',async req=>{
    if(req.method==='OPTIONS'||publicRoutes.has(req.routeOptions.url??''))return;
    req.actor=await ctx.authenticate(req);await rate(`user:${req.actor.id}`,600);
    if(req.method!=='GET'){
      const route=req.routeOptions.url??'';
      await rate(`write:${req.actor.id}`,150);
      if(route.endsWith('/messages'))await rate(`messages:${req.actor.id}`,30);
      if(route==='/v1/reports')await rate(`reports:${req.actor.id}`,5,600000);
      if(route==='/v1/auth/mfa')await rate(`mfa:${req.actor.id}`,5);
    }
  });
  app.setErrorHandler((error,req,reply)=>{
    if(error instanceof Problem){if(error.status===429)reply.header('Retry-After','60');return reply.code(error.status).send({error:{code:error.code,message:error.message}});}
    if(error instanceof z.ZodError)return reply.code(400).send({error:{code:'validation_error',message:'Gönderilen bilgileri kontrol et.',fields:error.issues.map(i=>i.path.join('.'))}});
    if((error as any).code==='23505')return reply.code(409).send({error:{code:'conflict',message:'Bu işlem daha önce yapılmış. Durumu yenile.'}});
    if((error as any).statusCode===413)return reply.code(413).send({error:{code:'payload_too_large',message:'Gönderilen dosya çok büyük.'}});
    req.log.error({event:'request.failed',requestId:req.id},'İşlem tamamlanamadı');
    return reply.code(500).send({error:{code:'internal_error',message:'İşlem tamamlanamadı. Tekrar dene.'}});
  });
  const clients=new Map<WebSocket,{userId:string;sessionId:string}>();
  async function validSession(id:string) {return (await db.query("SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=$1 AND s.access_expires_at>now() AND s.rotated=false AND u.status='active'",[id])).length>0;}
  async function invalidate(ids:string[]) {
    for(const [socket,client] of clients)if(ids.includes(client.userId)){
      if(!await validSession(client.sessionId)){socket.close(4001,'Oturum sona erdi');continue;}
      if(socket.readyState===1)socket.send(JSON.stringify({type:'refresh'}));
    }
  }
  ctx.changed=async ids=>{
    const unique=[...new Set(ids.filter(Boolean))];await invalidate(unique);
    if(redis?.isReady)try{await redis.publish('ahenk:events',JSON.stringify(unique));}catch{}
  };
  ctx.closeUser=id=>{for(const [socket,client]of clients)if(client.userId===id)socket.close(4001,'Oturum sona erdi');};
  if(subscriber)await subscriber.subscribe('ahenk:events',message=>{try{const ids=z.array(z.uuid()).max(1000).parse(JSON.parse(message));void invalidate(ids).catch(()=>{});}catch{}});
  app.post('/v1/events/ticket',async req=>ctx.write(req,'events.ticket',async q=>{
    const ticket=secret();await q.query("INSERT INTO ws_tickets(ticket_hash,session_id,expires_at) VALUES($1,$2,now()+interval '30 seconds')",[sha(ticket),req.actor.sessionId]);return {ticket};
  }));
  app.get('/v1/events',{websocket:true},(socket,req)=>{
    if(req.headers.origin&&!config.origins.includes(req.headers.origin)){socket.close(1008,'Origin reddedildi');return;}
    let authenticating=false,authenticated=false;
    const timeout=setTimeout(()=>socket.close(1008,'Yetkilendirme gerekli'),5000);timeout.unref();
    socket.on('message',async raw=>{
      if(authenticating||authenticated){socket.close(1008,'Geçersiz ileti');return;}authenticating=true;
      try{
        const {ticket}=z.object({ticket:z.string().min(40).max(100)}).parse(JSON.parse(raw.toString()));
        const session=await db.tx(async q=>{
          const [t]=await q.query('DELETE FROM ws_tickets WHERE ticket_hash=$1 AND expires_at>now() RETURNING session_id',[sha(ticket)]);if(!t)return null;
          const [s]=await q.query("SELECT s.id,s.user_id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=$1 AND s.access_expires_at>now() AND s.rotated=false AND u.status='active'",[t.session_id]);return s;
        });
        if(!session){socket.close(4001,'Oturum sona erdi');return;}
        authenticated=true;clearTimeout(timeout);clients.set(socket,{userId:session.user_id,sessionId:session.id});socket.send(JSON.stringify({type:'ready'}));
      }catch{socket.close(1008,'Yetkilendirme başarısız');}
    });
    socket.on('close',()=>{clearTimeout(timeout);clients.delete(socket);});
  });
  const heartbeat=setInterval(()=>{void Promise.all([...clients].map(async([socket,client])=>{
    try{if(!await validSession(client.sessionId)){socket.close(4001,'Oturum sona erdi');return;}socket.ping();}catch{socket.close(1011,'Servis kullanılamıyor');}
  }));},30000);heartbeat.unref();
  app.addHook('onClose',async()=>{clearInterval(heartbeat);for(const socket of clients.keys())socket.close(1001);await subscriber?.close();await redis?.close();});
  app.get('/health',async()=>{await db.query('SELECT 1');if(redis)await redis.ping();return {status:'ok'};});
  app.get('/v1/config',async()=>({name:'Ahenk',mode:config.mode,minRatings:config.minRatings,spotifyEnabled:config.spotifyEnabled,termsVersion:'2026-09-demo',catalogIsDemo:config.mode==='demo'}));
  await authRoutes(app,ctx);await coreRoutes(app,ctx);await socialRoutes(app,ctx);await moderationRoutes(app,ctx);await privacyRoutes(app,ctx);await photoRoutes(app,ctx,options.request);await spotifyRoutes(app,ctx,spotify);
  await app.ready();return {app,ctx,spotify};
}
