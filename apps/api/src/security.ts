import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
export const sha = (v: string) => createHash('sha256').update(v).digest('hex');
export const secret = () => randomBytes(32).toString('base64url');
export class Problem extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export const deny = (status: number, code: string, message: string): never => { throw new Problem(status,code,message); };
function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve,reject) => scrypt(password,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024},(err,key)=>err?reject(err):resolve(key)));
}
export async function passwordHash(password:string) {
  const salt=randomBytes(16).toString('hex'); return `scrypt$${salt}$${(await derive(password,salt)).toString('hex')}`;
}
export async function checkPassword(password:string, encoded:string) {
  const [kind,salt,key]=encoded.split('$');
  if (kind!=='scrypt'||!salt||!key) return false;
  const hash=await derive(password,salt); const expected=Buffer.from(key,'hex');
  return expected.length===hash.length && timingSafeEqual(hash,expected);
}
export function vault(hexKey:string) {
  const key=Buffer.from(hexKey,'hex');
  return {
    seal(value:string,context:string) {
      const iv=randomBytes(12); const cipher=createCipheriv('aes-256-gcm',key,iv);
      cipher.setAAD(Buffer.from(context)); const payload=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
      return ['v1',iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),payload.toString('base64url')].join('.');
    },
    open(value:string,context:string) {
      const [version,iv,tag,payload]=value.split('.'); if(version!=='v1') throw new Error('Bilinmeyen şifreleme sürümü.');
      const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(iv,'base64url'));
      decipher.setAAD(Buffer.from(context)); decipher.setAuthTag(Buffer.from(tag,'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(payload,'base64url')),decipher.final()]).toString('utf8');
    },
  };
}
export function ageOn(date:string,now=new Date()):number {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)) return -1;
  const d=new Date(`${date}T00:00:00Z`); if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==date) return -1;
  let age=now.getUTCFullYear()-d.getUTCFullYear();
  if(now.getUTCMonth()<d.getUTCMonth()||(now.getUTCMonth()===d.getUTCMonth()&&now.getUTCDate()<d.getUTCDate()))age--;
  return age;
}
export const birthString = (v: Date|string) => v instanceof Date?v.toISOString().slice(0,10):v.slice(0,10);
export const instagramName = (input:string) => {
  const name=input.trim().replace(/^@/,'');
  if(!/^[A-Za-z0-9._]{1,30}$/.test(name)) deny(400,'invalid_instagram','Instagram kullanıcı adı geçersiz.');
  return name;
};
const base32='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function newTotpSecret() {
  let bits=''; for(const n of randomBytes(20))bits+=n.toString(2).padStart(8,'0');
  return bits.match(/.{5}/g)!.map(b=>base32[parseInt(b,2)]).join('');
}
function base32Bytes(value:string) {
  if(!/^[A-Z2-7]+$/.test(value))throw new Error('TOTP secret invalid');
  const bits=[...value].map(v=>base32.indexOf(v).toString(2).padStart(5,'0')).join('');
  return Buffer.from(bits.match(/.{8}/g)!.map(b=>parseInt(b,2)));
}
export function totpAt(value:string, step:number, digits=6) {
  const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(step));
  const hash=createHmac('sha1',base32Bytes(value)).update(counter).digest();const offset=hash[19]&15;
  return ((hash.readUInt32BE(offset)&0x7fffffff)%10**digits).toString().padStart(digits,'0');
}
export function verifyTotp(value:string,code:string,lastStep:number,now=Date.now()) {
  if(!/^\d{6}$/.test(code))return null;
  const step=Math.floor(now/30000);
  for(const candidate of [step,step-1,step+1]) if(candidate>lastStep&&timingSafeEqual(Buffer.from(code),Buffer.from(totpAt(value,candidate))))return candidate;
  return null;
}
