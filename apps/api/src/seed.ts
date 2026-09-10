import { randomUUID } from 'node:crypto';
import { readConfig } from './config.js';
import { openDatabase } from './db.js';
import { passwordHash } from './security.js';
import { seedCatalog,DEMO_CATALOG } from './catalog.js';
import { ALGORITHM_VERSION } from './engine.js';
const config=readConfig();if(config.mode!=='demo')throw new Error('Örnek veriler sadece APP_MODE=demo ortamına eklenebilir.');
const db=await openDatabase(config.databaseUrl,config.dataDir),password=await passwordHash('AhenkDemo!2026');
const people=[['Ada','ada','1999-04-12','Konser çıkışında uzun yürüyüşler. Yeni bir ses, yeni bir hikâye.'],['Deniz','deniz','1998-07-21','Plak dükkânları ve küçük konserler. Bir sonraki keşfimiz ne olsun?'],['Ege','ege','1997-02-10','Elektronikten caza, iyi bir ritmin peşindeyim.'],['Lalin','lalin','2000-10-24','Her yolculuğa ayrı bir çalma listesi yaparım.'],['Mert','mert','1996-06-03','Alternatif sahne, hafta sonu konserleri ve kahve.']];
try{
  await db.tx(async q=>{
    await seedCatalog(q);
    const ids:string[]=[];
    for(const [index,[name,login,birth,bio]] of people.entries()){
      const email=`${login}@demo.local`;const [existing]=await q.query('SELECT id FROM users WHERE email=$1',[email]);
      if(existing){ids.push(existing.id);continue;}
      const id=randomUUID();ids.push(id);
      await q.query('INSERT INTO users(id,email,password_hash,birth_date,age_verified) VALUES($1,$2,$3,$4,true)',[id,email,password,birth]);
      await q.query('INSERT INTO profiles(user_id,display_name,bio,city,genres,artists,exploration) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,name,bio,'istanbul',JSON.stringify(['Alternatif','Indie','Elektronik']),JSON.stringify(['Kıyı Çizgisi','Gece Atlası']),.5+index*.08]);
      await q.query('INSERT INTO consents(id,user_id,kind,version) VALUES($1,$2,$3,$4)',[randomUUID(),id,'demo-fixture','2026-09-demo']);
      const tracks=DEMO_CATALOG.filter(t=>!t.explicit).slice(index*3,index*3+26);
      for(const [j,t]of tracks.entries())await q.query('INSERT INTO track_swipes(user_id,item_id,action) VALUES($1,$2,$3)',[id,t.id,j%8===0?'favorite':j%9===0?'dislike':'like']);
    }
    const [a,b]=[ids[0],ids[1]].sort();
    for(const [x,y]of [[a,b],[b,a]])await q.query("INSERT INTO person_swipes(actor_id,target_id,action) VALUES($1,$2,'like') ON CONFLICT DO NOTHING",[x,y]);
    await q.query('INSERT INTO matches(id,user_a,user_b,algorithm_version) VALUES($1,$2,$3,$4) ON CONFLICT(user_a,user_b) DO NOTHING',[randomUUID(),a,b,ALGORITHM_VERSION]);
  });
  console.log('72 kurmaca müzik kartı ve 5 örnek profil hazır.');
  console.log('Demo girişleri: ada@demo.local, deniz@demo.local, ege@demo.local, lalin@demo.local, mert@demo.local');
  console.log('Yalnızca yerel demo parolası: AhenkDemo!2026');
}finally{await db.close();}
