import { after,before,test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture,pair,call,type Fixture,type User } from './helpers.js';
let f:Fixture,mode='ok';const requests:{url:string;method:string;body:any}[]=[];
const request:typeof fetch=async(input,init)=>{
  const url=String(input),method=init?.method??'GET';requests.push({url,method,body:init?.body?String(init.body):null});
  if(url.includes('/api/token'))return Response.json({access_token:'mock-access-token-12345',refresh_token:'mock-refresh-token-12345',expires_in:3600,scope:'playlist-modify-private'});
  if(url.endsWith('/me/playlists')){
    if(mode==='rate')return new Response('',{status:429,headers:{'Retry-After':'120'}});
    if(mode==='timeout')throw new TypeError('simulated lost response');
    return Response.json({id:'A'.repeat(22)});
  }
  if(url.includes('/items'))return Response.json({snapshot_id:'test-snapshot'});
  throw new Error('Unexpected Spotify endpoint');
};
before(async()=>{f=await fixture(request);});after(async()=>{await f?.app.close();await f?.db.close();});
async function enabledPair(){
  const p=await pair(f);f.config.spotifyEnabled=true;f.config.spotifyClientId='mock-client';f.config.spotifyRedirectUri='https://api.example.test/v1/integrations/spotify/callback';f.config.spotifyAllowlist.push(p.a.id);
  await f.db.query("UPDATE music_catalog_items SET rights_status='licensed',rights_reference='test-fixture-only',spotify_uri='spotify:track:' || lpad(right(id::text,12),22,'0')");
  await f.db.tx(q=>f.spotify.saveTokens(q,p.a.id,{access_token:'mock-access-token-12345',refresh_token:'mock-refresh-token-12345',expires_in:3600}));
  const response=await call(f,p.a,'POST',`/v1/matches/${p.id}/playlist-drafts`,{});assert.equal(response.statusCode,200,response.body);return {...p,draftId:response.json().id};
}
async function exportJob(a:User,draftId:string){const response=await call(f,a,'POST',`/v1/playlist-drafts/${draftId}/spotify-export`,{confirmed:true});assert.equal(response.statusCode,200,response.body);return response.json();}
test('Spotify is disabled by default and still guarded by an explicit user allowlist',async()=>{
  const p=await pair(f);assert.equal((await call(f,p.a,'POST','/v1/integrations/spotify/connect',{})).statusCode,403);f.config.spotifyEnabled=true;assert.equal((await call(f,p.a,'POST','/v1/integrations/spotify/connect',{})).statusCode,403);
});
test('PKCE requests minimum scope, consumes OAuth state once and encrypts both token types',async()=>{
  const p=await enabledPair(),connect=await call(f,p.a,'POST','/v1/integrations/spotify/connect',{});assert.equal(connect.statusCode,200,connect.body);
  const url=new URL(connect.json().url);assert.equal(url.searchParams.get('scope'),'playlist-modify-private');assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.equal(url.searchParams.get('code_challenge')?.length,43);
  const callback=`/v1/integrations/spotify/callback?state=${url.searchParams.get('state')}&code=mock-code`;
  const done=await call(f,null,'GET',callback);assert.equal(done.statusCode,200,done.body);assert(!done.body.includes('mock-access-token'));assert.equal((await call(f,null,'GET',callback)).statusCode,400);
  const [row]=await f.db.query('SELECT * FROM oauth_connections WHERE user_id=$1',[p.a.id]);assert(!JSON.stringify(row).includes('mock-refresh-token'));assert(!JSON.stringify(row).includes('mock-access-token'));
  await call(f,p.a,'DELETE','/v1/integrations/spotify');assert.equal((await f.db.query('SELECT 1 FROM oauth_connections WHERE user_id=$1',[p.a.id])).length,0);
});
test('retrying an export creates one private playlist and replaces items idempotently',async()=>{
  const p=await enabledPair(),start=requests.length,job=await exportJob(p.a,p.draftId),duplicate=await exportJob(p.a,p.draftId);assert.equal(job.id,duplicate.id);
  await f.spotify.runOnce();await f.spotify.runOnce();await f.spotify.runOnce();
  const result=await call(f,p.a,'GET',`/v1/spotify-exports/${job.id}`);assert.equal(result.json().status,'completed',result.body);
  const calls=requests.slice(start);assert.equal(calls.filter(r=>r.url.endsWith('/me/playlists')).length,1);assert.equal(JSON.parse(calls.find(r=>r.url.endsWith('/me/playlists'))!.body).public,false);assert(calls.some(r=>r.url.endsWith('/items')&&r.method==='PUT'));assert(calls.every(r=>!r.url.includes('/top')&&!r.url.includes('recently-played')));
});
test('429 respects Retry-After without immediate retries or duplicate playlists',async()=>{
  mode='rate';const p=await enabledPair(),job=await exportJob(p.a,p.draftId),start=requests.length;await f.spotify.runOnce();await f.spotify.runOnce();
  assert.equal(requests.length-start,1);const [row]=await f.db.query('SELECT status,retry_at FROM spotify_exports WHERE id=$1',[job.id]);assert.equal(row.status,'queued');assert(new Date(row.retry_at).getTime()>Date.now()+110000);
  await f.db.query("UPDATE spotify_exports SET status='cancelled' WHERE id=$1",[job.id]);mode='ok';
});
test('a lost create response is marked uncertain and is never automatically replayed',async()=>{
  mode='timeout';const p=await enabledPair(),job=await exportJob(p.a,p.draftId),start=requests.length;await f.spotify.runOnce();await f.spotify.runOnce();
  assert.equal(requests.length-start,1);assert.equal((await call(f,p.a,'GET',`/v1/spotify-exports/${job.id}`)).json().status,'uncertain');assert.equal((await exportJob(p.a,p.draftId)).id,job.id);mode='ok';
});
test('disconnecting removes OAuth state, encrypted tokens and queued exports',async()=>{
  const p=await enabledPair();await exportJob(p.a,p.draftId);await call(f,p.a,'POST','/v1/integrations/spotify/connect',{});await call(f,p.a,'DELETE','/v1/integrations/spotify');
  for(const table of ['oauth_connections','oauth_states','spotify_exports'])assert.equal((await f.db.query(`SELECT 1 FROM ${table} WHERE user_id=$1`,[p.a.id])).length,0);
});
