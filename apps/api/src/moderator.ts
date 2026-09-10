import { readConfig } from './config.js';
import { openDatabase } from './db.js';
import { newTotpSecret,vault } from './security.js';
const email=process.argv[2]?.trim().toLowerCase();if(!email)throw new Error('Kullanım: npm run moderator -- kullanici@ornek.com');
const config=readConfig(),db=await openDatabase(config.databaseUrl,config.dataDir),crypto=vault(config.dataKey);
try{
  const value=newTotpSecret();
  await db.tx(async q=>{
    const [user]=await q.query('SELECT id,role FROM users WHERE email=$1',[email]);if(!user)throw new Error('Önce uygulamada hesap oluştur.');
    if(user.role==='moderator')throw new Error('Moderatör zaten kurulmuş; mevcut MFA anahtarı otomatik değiştirilmedi.');
    await q.query("UPDATE users SET role='moderator',totp_secret=$2,totp_last_step=NULL WHERE id=$1",[user.id,crypto.seal(value,`totp:${user.id}`)]);
    await q.query('DELETE FROM sessions WHERE user_id=$1',[user.id]);
  });
  console.log('Moderatör yetkisi verildi. Tekrar giriş yap. Aşağıdaki TOTP anahtarını güvenli biçimde kimlik doğrulayıcı uygulamana ekle; paylaşma ve depoya kaydetme.');
  console.log(`otpauth://totp/Ahenk:${encodeURIComponent(email)}?secret=${value}&issuer=Ahenk&algorithm=SHA1&digits=6&period=30`);
}finally{await db.close();}
