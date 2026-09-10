import { readConfig } from './config.js';
import { openDatabase } from './db.js';
import { buildApp } from './app.js';
const config=readConfig(),db=await openDatabase(config.databaseUrl,config.dataDir);
const {app,spotify}=await buildApp(config,db,{logger:true});
let working=false;
const worker=setInterval(async()=>{if(working)return;working=true;try{await spotify.runOnce();}catch{app.log.error({event:'spotify.worker_failed'});}finally{working=false;}},2000);worker.unref();
const maintenance=setInterval(()=>{void db.tx(async q=>{
  await q.query("DELETE FROM idempotency_keys WHERE created_at<now()-interval '24 hours'");
  await q.query('DELETE FROM ws_tickets WHERE expires_at<now()');
  await q.query("DELETE FROM oauth_states WHERE expires_at<now()-interval '1 day'");
  await q.query('DELETE FROM sessions WHERE refresh_expires_at<now()');
  await q.query("DELETE FROM auth_action_tokens WHERE expires_at<now()-interval '1 day' OR used_at<now()-interval '7 days'");
  await q.query("DELETE FROM verification_events WHERE created_at<now()-interval '7 days'");
  await q.query('DELETE FROM feed_impressions WHERE day<CURRENT_DATE-30');
}).catch(()=>app.log.error({event:'maintenance.failed'}));},3600000);maintenance.unref();
await app.listen({host:config.host,port:config.port});
let closing=false;
async function shutdown(){if(closing)return;closing=true;clearInterval(worker);clearInterval(maintenance);await app.close();await db.close();}
process.on('SIGINT',()=>void shutdown());process.on('SIGTERM',()=>void shutdown());
