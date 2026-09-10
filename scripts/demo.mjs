import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),apiDir=fileURLToPath(new URL('../apps/api/',import.meta.url)),mobileDir=fileURLToPath(new URL('../apps/mobile/',import.meta.url));
function run(args,cwd=root){return new Promise((resolve,reject)=>{const p=spawn(process.execPath,args,{cwd,stdio:'inherit',env:process.env});p.on('error',reject);p.on('exit',code=>code===0?resolve():reject(new Error(`Komut tamamlanamadı (kod ${code}).`)));});}
if(!existsSync(new URL('../node_modules/tsx/package.json',import.meta.url))){console.error('Önce proje klasöründe npm ci çalıştır.');process.exit(1);}
await run(['scripts/setup.mjs']);process.loadEnvFile(fileURLToPath(new URL('../apps/api/.env',import.meta.url)));
if(process.env.APP_MODE!=='demo'||process.env.DATABASE_URL){console.error('npm run demo yalnızca yerel PGlite demo içindir. Uzak veritabanı için README adımlarını kullan.');process.exit(1);}
await run(['--env-file=.env','--import','tsx','src/seed.ts'],apiDir);
await run(['node_modules/typescript/bin/tsc','-p','apps/api/tsconfig.json']);
if(!existsSync(new URL('../apps/mobile/dist/index.html',import.meta.url))){
  process.env.EXPO_PUBLIC_API_URL=`http://127.0.0.1:${process.env.PORT??4000}`;process.env.CI='1';
  await run(['../../node_modules/expo/bin/cli','export','--platform','web','--output-dir','dist'],mobileDir);
}
const children=[];
function start(args,cwd){const p=spawn(process.execPath,args,{cwd,stdio:'inherit',env:process.env});children.push(p);p.on('error',()=>shutdown());return p;}
const api=start(['--env-file=.env','dist/src/server.js'],apiDir);let stopped=false;
function shutdown(){if(stopped)return;stopped=true;for(const p of children)p.kill('SIGTERM');}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
let healthy=false;
for(let i=0;i<30;i++){
  if(api.exitCode!==null)break;
  try{const r=await fetch(`http://127.0.0.1:${process.env.PORT??4000}/health`);if(r.ok){healthy=true;break;}}catch{}
  await new Promise(resolve=>setTimeout(resolve,500));
}
if(!healthy){shutdown();console.error('API başlatılamadı. Yukarıdaki hatayı kontrol et.');process.exitCode=1;}
else {start(['scripts/serve-web.mjs'],root);console.log('Tarayıcıda http://127.0.0.1:8081 adresini aç. Durdurmak için Ctrl+C.');}
for(const child of children)child.on('exit',()=>shutdown());
