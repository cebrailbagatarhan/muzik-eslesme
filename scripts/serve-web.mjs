import { createServer } from 'node:http';
import { readFile,stat } from 'node:fs/promises';
import { resolve,extname,sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(fileURLToPath(new URL('../apps/mobile/dist/',import.meta.url))),port=Number(process.env.DEMO_WEB_PORT??8081);
const types={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.svg':'image/svg+xml'};
const server=createServer(async(req,res)=>{
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
  try{
    const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname),file=resolve(root,`.${path==='/'?'/index.html':path}`);
    if(!file.startsWith(root+sep)){res.writeHead(403);res.end();return;}
    if(!(await stat(file)).isFile()){res.writeHead(404);res.end();return;}
    const bytes=await readFile(file);res.writeHead(200,{'Content-Type':types[extname(file)]??'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:bytes);
  }catch{res.writeHead(404);res.end('Not found');}
});
server.on('error',()=>{console.error(`${port} portu açılamadı. Bu portu kullanan uygulamayı durdur.`);process.exitCode=1;});
server.listen(port,'127.0.0.1',()=>console.log(`Ahenk: http://127.0.0.1:${port}`));
process.on('SIGINT',()=>server.close());process.on('SIGTERM',()=>server.close());
