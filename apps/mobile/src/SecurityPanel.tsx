import React,{useEffect,useState} from 'react';
import { View,Switch } from 'react-native';
import { api } from './api';
import { c,s,Title,P,Label,Card,Button,Field,ErrorNotice } from './ui';

export function SecurityPanel(){
  const [currentPassword,setCurrentPassword]=useState(''),[newPassword,setNewPassword]=useState(''),[consents,setConsents]=useState<any[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  async function load(){const data=await api.get<any>('/v1/consents');setConsents(data.optional??[]);}
  useEffect(()=>{void load().catch(e=>setError(e.message));},[]);
  async function run(fn:()=>Promise<unknown>,message:string){setBusy(true);setError('');setNotice('');try{await fn();setNotice(message);}catch(e:any){setError(e.message);}finally{setBusy(false);}}
  async function changePassword(){await api.post('/v1/auth/password/change',{currentPassword,newPassword});setCurrentPassword('');setNewPassword('');}
  async function setConsent(kind:string,granted:boolean){await api.put(`/v1/consents/${kind}`,{granted});await load();}
  const names:Record<string,{title:string;detail:string}>={
    'product-analytics':{title:'Ürün analitiği',detail:'Hangi ekranların işe yaradığını anlamak için kimlikten ayrıştırılmış kullanım ölçümleri.'},
    'research-contact':{title:'Araştırma iletişimi',detail:'Ürün araştırması ve gönüllü kullanıcı görüşmeleri için iletişim izni.'},
  };
  return <Card style={{gap:16}}><Title small>Hesap güvenliği ve izinler</Title><ErrorNotice message={error}/>{notice&&<Card style={{backgroundColor:c.lightGreen,padding:12}}><P>{notice}</P></Card>}
    <Label>PAROLANI DEĞİŞTİR</Label><Field label="Mevcut parola" secureTextEntry value={currentPassword} onChangeText={setCurrentPassword}/><Field label="Yeni parola (en az 12 karakter)" secureTextEntry value={newPassword} onChangeText={setNewPassword}/><Button kind="light" busy={busy} disabled={!currentPassword||newPassword.length<12} onPress={()=>void run(changePassword,'Parolan güncellendi. Diğer cihazlardaki oturumlar kapatıldı.')}>Parolayı değiştir</Button>
    <Label>İSTEĞE BAĞLI İZİNLER</Label><P muted style={{fontSize:12}}>Zorunlu hizmet şartlarından ayrı tutulur ve istediğin zaman geri alınabilir.</P>
    {consents.map(item=><View key={item.kind} style={[s.row,{justifyContent:'space-between',alignItems:'flex-start'}]}><View style={{flex:1,paddingRight:12}}><P>{names[item.kind]?.title??item.kind}</P><P muted style={{fontSize:11}}>{names[item.kind]?.detail}</P></View><Switch accessibilityLabel={names[item.kind]?.title??item.kind} value={!!item.granted} disabled={busy} onValueChange={value=>void run(()=>setConsent(item.kind,value),value?'İzin verildi.':'İzin geri alındı.')} trackColor={{true:c.green}}/></View>)}
  </Card>;
}
