import React,{useState,useEffect} from 'react';
import { View,Text } from 'react-native';
import { api } from './api';
import { c,s,Title,P,Label,Card,Button,Field,Avatar,ErrorNotice } from './ui';
export function Admin(){
  const [code,setCode]=useState(''),[authorized,setAuthorized]=useState(false),[reports,setReports]=useState<any[]>([]),[photos,setPhotos]=useState<any[]>([]),[selected,setSelected]=useState<any>(null),[note,setNote]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  async function load(){const [r,p]=await Promise.all([api.get('/v1/admin/reports'),api.get('/v1/admin/photos')]);setReports(r.items);setPhotos(p.items);setAuthorized(true);}
  useEffect(()=>{void load().catch(()=>setAuthorized(false));},[]);
  async function run(fn:()=>Promise<unknown>){setBusy(true);setError('');try{await fn();await load();}catch(e:any){if(e.code==='mfa_required')setAuthorized(false);setError(e.message);}finally{setBusy(false);}}
  const categories:any={harassment:'Taciz',threat:'Tehdit',underage:'18 yaş altı',impersonation:'Sahte hesap',nudity:'Çıplaklık',spam:'Spam',fraud:'Dolandırıcılık',other:'Diğer'};
  return <View style={s.section}><View><Label>MODERASYON</Label><Title>Güvenli bir alan.</Title><P muted>Şikâyetleri değerlendir ve bekleyen profil fotoğraflarını incele.</P></View><ErrorNotice message={error}/>
    {!authorized?<Card style={{gap:15,maxWidth:480}}><Title small>İkinci adım doğrulaması</Title><Field label="Kimlik doğrulayıcıdaki 6 haneli kod" value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6}/><Button busy={busy} onPress={()=>void run(async()=>{await api.post('/v1/auth/mfa',{code});setCode('');})}>Güvenli oturumu aç</Button></Card>:<>
      <Button kind="light" onPress={()=>void run(load)}>Kuyruğu yenile</Button>
      <View style={s.row}><ChipNumber n={reports.filter(r=>r.status==='open').length} text="Açık şikâyet"/><ChipNumber n={photos.length} text="Bekleyen fotoğraf"/></View>
      <Label>ŞİKÂYET KUYRUĞU · ACİL VAKALAR ÖNCE</Label>
      {reports.map(r=><Card key={r.id} style={{padding:16}}><View style={[s.row,{justifyContent:'space-between'}]}><View style={{flex:1}}><P>{r.priority===0?'● ACİL · ':''}{categories[r.category]} · {r.target_name??'Silinmiş hesap'}</P><P muted style={{fontSize:11}}>{r.status==='open'?'Açık':'Sonuçlandı'} · {new Date(r.created_at).toLocaleString('tr-TR')}</P></View><Button small kind="light" disabled={busy} onPress={()=>void run(async()=>{setSelected(await api.get(`/v1/admin/reports/${r.id}`));setNote('');})}>İncele</Button></View></Card>)}
      {!reports.length&&<P muted>Şikâyet kuyruğu boş.</P>}
      {selected&&<Card style={{gap:16,backgroundColor:'#FFF9F1'}}><Title small>Vaka ayrıntıları</Title><P>{categories[selected.category]}</P><P muted>Açıklama: {selected.detail||'Ek açıklama yok.'}</P><Label>YETKİLİ ERİŞİM · KANIT</Label><P>{selected.evidence}</P>{selected.targetType==='photo'&&<Avatar name="Fotoğraf" size={160} photoId={selected.targetId}/>}{selected.status==='open'&&<><Field label="Karar gerekçesi" multiline value={note} onChangeText={setNote} maxLength={1000}/><View style={s.wrap}>{[['warn','Uyar'],['remove_content','İçeriği kaldır'],['suspend','Hesabı askıya al'],['dismiss','İşlemsiz kapat']].map(([action,label])=><Button key={action} small kind={action==='suspend'?'danger':'light'} disabled={busy||note.trim().length<5} onPress={()=>void run(async()=>{await api.post(`/v1/admin/reports/${selected.id}/actions`,{action,note});setSelected(null);})}>{label}</Button>)}</View></>}<Button kind="light" onPress={()=>setSelected(null)}>Ayrıntıları kapat</Button></Card>}
      <Label>BEKLEYEN FOTOĞRAFLAR</Label><View style={s.wrap}>{photos.map(photo=><Card key={photo.id} style={{gap:12,width:235,alignItems:'center'}}><Avatar name={photo.name} photoId={photo.id} size={160}/><P>{photo.name}</P><View style={s.wrap}><Button small kind="green" disabled={busy} onPress={()=>void run(()=>api.post(`/v1/admin/photos/${photo.id}/review`,{approved:true}))}>Onayla</Button><Button small kind="danger" disabled={busy} onPress={()=>void run(()=>api.post(`/v1/admin/photos/${photo.id}/review`,{approved:false}))}>Reddet</Button></View></Card>)}</View>{!photos.length&&<P muted>İnceleme bekleyen fotoğraf yok.</P>}
    </>}
  </View>;
}
function ChipNumber({n,text}:{n:number;text:string}){return <Card style={{flex:1,gap:6}}><Text style={{fontSize:30,fontWeight:'700',color:c.green}}>{n}</Text><P muted>{text}</P></Card>;}
