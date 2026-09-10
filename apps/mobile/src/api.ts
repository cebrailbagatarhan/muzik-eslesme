import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
export const API_URL=(process.env.EXPO_PUBLIC_API_URL??'http://localhost:4000').replace(/\/$/,'');
export type Session={accessToken:string;refreshToken:string;userId:string;expiresIn:number};
export class ApiError extends Error {constructor(public code:string,message:string,public status:number){super(message);}}
let session:Session|null=null,refreshing:Promise<void>|null=null;
const listeners=new Set<()=>void>();
export const onSessionChanged=(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn);};};
export const hasSession=()=>!!session;
export const currentUserId=()=>session?.userId;
export async function saveSession(value:Session|null){
  session=value;
  if(Platform.OS!=='web'){
    if(value)await SecureStore.setItemAsync('ahenk-session',JSON.stringify(value),{keychainAccessible:SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY});
    else await SecureStore.deleteItemAsync('ahenk-session');
  }
  // Web credentials are memory-only, never localStorage or a readable cookie.
  listeners.forEach(fn=>fn());
}
export async function restoreSession(){
  if(Platform.OS==='web')return;
  const value=await SecureStore.getItemAsync('ahenk-session');if(value)try{session=JSON.parse(value);await refresh();}catch{await saveSession(null);}
}
async function refresh(){
  if(refreshing)return refreshing;
  refreshing=(async()=>{
    if(!session)throw new ApiError('unauthorized','Tekrar giriş yap.',401);
    const response=await fetch(`${API_URL}/v1/auth/refresh`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({refreshToken:session.refreshToken}),signal:AbortSignal.timeout(15000)});
    if(!response.ok){await saveSession(null);throw new ApiError('unauthorized','Oturum sona erdi. Tekrar giriş yap.',401);}
    await saveSession(await response.json());
  })();
  try{await refreshing;}finally{refreshing=null;}
}
async function call<T>(path:string,method='GET',body?:unknown,options:{key?:string;retryAuth?:boolean}={}):Promise<T>{
  const key=method==='GET'?undefined:options.key??Crypto.randomUUID();
  let response:Response;
  try{response=await fetch(`${API_URL}${path}`,{method,headers:{'Content-Type':'application/json',...(session?{Authorization:`Bearer ${session.accessToken}`} :{}),...(key?{'Idempotency-Key':key}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});}
  catch{throw new ApiError('connection_failed','Bağlantı kurulamadı. Durumu yenileyip tekrar dene.',0);}
  if(response.status===401&&session&&options.retryAuth!==false&&!path.startsWith('/v1/auth/')){
    await refresh();return call<T>(path,method,body,{key,retryAuth:false});
  }
  const data=await response.json();
  if(!response.ok)throw new ApiError(data.error?.code??'request_failed',data.error?.message??'İşlem tamamlanamadı.',response.status);
  return data;
}
export const api={get:<T=any>(path:string)=>call<T>(path),post:<T=any>(path:string,body:unknown={})=>call<T>(path,'POST',body),put:<T=any>(path:string,body:unknown)=>call<T>(path,'PUT',body),delete:<T=any>(path:string,body?:unknown)=>call<T>(path,'DELETE',body)};
export async function connectEvents(onRefresh:()=>void):Promise<()=>void>{
  let socket:WebSocket|null=null,disposed=false,reconnect:ReturnType<typeof setTimeout>|undefined;
  async function open(){
    if(disposed||!session)return;
    try{
      const {ticket}=await api.post<{ticket:string}>('/v1/events/ticket');if(disposed)return;
      socket=new WebSocket(`${API_URL.replace(/^http/,'ws')}/v1/events`);
      socket.onopen=()=>socket?.send(JSON.stringify({ticket}));
      socket.onmessage=event=>{try{if(JSON.parse(event.data).type==='refresh')onRefresh();}catch{}};
      socket.onclose=()=>{if(!disposed)reconnect=setTimeout(()=>void open(),3000);};
      socket.onerror=()=>socket?.close();
    }catch{if(!disposed)reconnect=setTimeout(()=>void open(),5000);}
  }
  void open();
  return ()=>{disposed=true;if(reconnect)clearTimeout(reconnect);socket?.close();};
}
