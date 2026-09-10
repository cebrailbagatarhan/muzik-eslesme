import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
const destination = new URL('../apps/api/.env', import.meta.url);
if (existsSync(destination)) { console.log('Mevcut API .env korundu.'); }
else {
  const source = readFileSync(new URL('../.env.example', import.meta.url), 'utf8')
    .replace('DATA_ENCRYPTION_KEY=\n', `DATA_ENCRYPTION_KEY=${randomBytes(32).toString('hex')}\n`)
    .replace('MEDIA_SIGNING_KEY=\n', `MEDIA_SIGNING_KEY=${randomBytes(32).toString('hex')}\n`);
  writeFileSync(destination, source, { mode: 0o600 });
  console.log('API ayarları ve şifreleme anahtarları oluşturuldu.');
}
console.log('Sırayla: npm run seed, npm run dev. İkinci terminal: npm run web veya npm run mobile.');
