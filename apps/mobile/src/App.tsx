import React,{useEffect,useState,useCallback} from 'react';
import { View,Text,ScrollView,Pressable,StatusBar,SafeAreaView,useWindowDimensions,ActivityIndicator,Platform } from 'react-native';
import { api,saveSession,restoreSession,hasSession,onSessionChanged,connectEvents,type Session } from './api';
import { c,s,Title,P,Label,Card,Button,Field,Chip,Avatar,ErrorNotice } from './ui';
import { Music,People } from './Music';
import { Chat } from './Chat';
import { Profile } from './Profile';
import { Admin } from './Admin';
export default function App(){
  const [authenticated,setAuthenticated]=useState(hasSession()),[me,setMe]=useState<any>(null),[config,setConfig]=useState<any>(null),[tab,setTab]=useState('music'),[error,setError]=useState(''),[revision,setRevision]=useState(0),[ready,setReady]=useState(false);
  const {width}=useWindowDimensions(),desktop=width>=850;
  useEffect(()=>onSessionChanged(()=>{setAuthenticated(hasSession());if(!hasSession()){setMe(null);setTab('music');}}),[]);
  useEffect(()=>{void restoreSession().finally(()=>{setAuthenticated(hasSession());setReady(true);});void api.get('/v1/config').then(setConfig).catch(e=>setError(e.message));},[]);
  const reload=useCallback(async()=>{if(!hasSession())return;try{setMe(await api.get('/v1/me'));setError('');}catch(e:any){setError(e.message);}},[]);
  useEffect(()=>{if(!authenticated)return;void reload();let dispose:(()=>void)|undefined,done=false;
    void connectEvents(()=>{setRevision(r=>r+1);void reload();}).then(fn=>{if(done)fn();else dispose=fn;});
    // Polling recovers missed events after temporary disconnects.
    const timer=setInterval(()=>{setRevision(r=>r+1);},15000);
    return()=>{done=true;dispose?.();clearInterval(timer);};
  },[authenticated,reload]);
  async function logout(){try{await api.post('/v1/auth/logout');}finally{await saveSession(null);}}
  if(!ready)return <View style={[s.page,{justifyContent:'center'}]}><ActivityIndicator color={c.green}/></View>;
  if(!authenticated)return <Auth config={config} connectionError={error} retryConfig={()=>void api.get('/v1/config').then(v=>{setConfig(v);setError('');}).catch(e=>setError(e.message))}/>;
  const tabs=[['music','♪','Müzik keşfet'],['people','✦','İnsanları keşfet'],['chat','↗','Sohbetler'],['profile','○','Profilim'],...(me?.role==='moderator'?[['admin','◈','Moderasyon']]:[])];
  function nav(compact=false){return tabs.map(([key,icon,label])=><Pressable key={key} accessibilityRole="button" accessibilityState={{selected:tab===key}} onPress={()=>{setTab(key);setError('');}} style={{flex:compact?1:undefined,flexDirection:compact?'column':'row',alignItems:'center',gap:compact?4:13,paddingVertical:compact?9:14,paddingHorizontal:compact?4:16,borderRadius:14,backgroundColor:tab===key?c.lightGreen:'transparent'}}><Text style={{fontSize:21,color:tab===key?c.green:c.muted}}>{icon}</Text><Text style={{fontSize:compact?9:13,fontWeight:tab===key?'700':'500',color:tab===key?c.green:c.muted}}>{label}</Text></Pressable>);}
  return <SafeAreaView style={s.page}><StatusBar barStyle="dark-content" backgroundColor={c.bg}/><View style={{flex:1,flexDirection:'row'}}>
    {desktop&&<View style={{width:230,padding:25,borderRightWidth:1,borderColor:c.line,gap:35}}><Brand/><View style={{gap:6}}>{nav()}</View><View style={{flex:1}}/>{me&&<View style={{gap:14}}><View style={s.row}><Avatar name={me.displayName} size={38}/><View><Text style={{fontSize:13,fontWeight:'700',color:c.ink}}>{me.displayName}</Text><Text style={{fontSize:11,color:c.muted}}>Kendi ritminde.</Text></View></View><Button small kind="light" onPress={()=>void logout()}>Çıkış yap</Button><Text style={{fontSize:10,color:c.muted}}>AHENK © 2026</Text></View>}</View>}
    <View style={{flex:1,minWidth:0}}><View style={{paddingHorizontal:desktop?38:20,paddingVertical:18,borderBottomWidth:1,borderColor:c.line,flexDirection:'row',justifyContent:'space-between',alignItems:'center'}}>{desktop?<Text style={{fontSize:12,color:c.muted}}>Merhaba {me?.displayName??''}, bugün ne dinliyoruz?</Text>:<Brand small/>}<View style={s.row}>{config?.mode==='demo'&&<Chip>DEMO · Örnek veriler</Chip>}{!desktop&&<Button small kind="light" onPress={()=>void logout()}>Çıkış</Button>}</View></View>
      <ScrollView style={{flex:1}} contentContainerStyle={{padding:desktop?38:20,width:'100%',maxWidth:1200,alignSelf:'center',paddingBottom:60}} keyboardShouldPersistTaps="handled">
        <ErrorNotice message={error}/>{!me?<ActivityIndicator color={c.green}/>:tab==='music'?<Music me={me} reload={reload} go={setTab} revision={revision}/>:tab==='people'?<People me={me} reload={reload} go={setTab} revision={revision}/>:tab==='chat'?<Chat me={me} revision={revision}/>:tab==='profile'?<Profile me={me} reload={reload}/>:me.role==='moderator'?<Admin/>:null}
      </ScrollView>{!desktop&&<View style={{flexDirection:'row',paddingHorizontal:8,paddingTop:8,paddingBottom:Platform.OS==='android'?12:4,borderTopWidth:1,borderColor:c.line,backgroundColor:c.bg}}>{nav(true)}</View>}
    </View>
  </View></SafeAreaView>;
}
function Brand({small=false}:{small?:boolean}){return <View style={s.row}><View style={{flexDirection:'row',alignItems:'center',gap:3,height:28}}>{[12,23,17,28].map((height,i)=><View key={i} style={{height,width:4,borderRadius:3,backgroundColor:c.orange}}/>)}</View><Text style={{fontSize:small?23:30,fontWeight:'800',letterSpacing:-1.4,color:c.ink}}>ahenk</Text><Text style={{fontSize:12,alignSelf:'flex-start',color:c.green}}>✳</Text></View>;}
function Auth({config,connectionError,retryConfig}:{config:any;connectionError:string;retryConfig:()=>void}){
  const [register,setRegister]=useState(false),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[name,setName]=useState(''),[city,setCity]=useState('İstanbul'),[birth,setBirth]=useState(''),[accepted,setAccepted]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const {width}=useWindowDimensions(),wide=width>=850;
  async function submit(demo?:string){setBusy(true);setError('');try{
    const data=await api.post<Session>(register&&!demo?'/v1/auth/register':'/v1/auth/login',demo?{email:`${demo}@demo.local`,password:'AhenkDemo!2026'}:register?{email,password,displayName:name,city,birthDate:birth,acceptedTerms:accepted}:{email,password});
    await saveSession(data);
  }catch(e:any){setError(e.message);}finally{setBusy(false);}}
  return <SafeAreaView style={s.page}><StatusBar barStyle="dark-content"/><ScrollView contentContainerStyle={{flexGrow:1,justifyContent:'center',padding:wide?55:22}} keyboardShouldPersistTaps="handled"><View style={{flexDirection:wide?'row':'column',maxWidth:1110,width:'100%',alignSelf:'center',gap:wide?80:30,alignItems:'center'}}>
    <View style={{flex:1,width:'100%',gap:25}}><Brand/><View><Label>ORTAK BİR ŞARKIDAN FAZLASI</Label><Text style={{fontSize:wide?68:46,lineHeight:wide?74:52,color:c.ink,fontWeight:'700',letterSpacing:-3}}>Aynı şarkıda{ '\n' }buluşalım.</Text></View><P muted style={{maxWidth:400,fontSize:17,lineHeight:27}}>Müzik zevkini paylaşan insanları keşfet. Birlikte bir liste, belki de güzel bir hikâye başlat.</P><View style={{flexDirection:'row',gap:7,marginVertical:10}}>{[50,90,125,80,115,60,95,45,80,120,65,95].map((height,i)=><View key={i} style={{width:wide?15:11,height,borderRadius:9,backgroundColor:i%3===0?c.orange:i%3===1?c.green:c.peach,alignSelf:'center'}}/>)}</View><View style={s.wrap}><Chip>18+</Chip><Chip>Ortak müzik zevki</Chip><Chip>Karşılıklı eşleşme</Chip></View></View>
    <Card style={{width:wide?420:'100%',padding:28,gap:12}}><Label>KENDİ RİTMİNDE TANIŞ</Label><Title small>{register?'Aramıza katıl.':'Yeniden merhaba.'}</Title><P muted>{register?'Profilini oluştur, müzik imzanı keşfet.':'Müziğin kaldığı yerden devam edelim.'}</P><ErrorNotice message={connectionError||error}/>{connectionError&&<Button small kind="light" onPress={retryConfig}>Bağlantıyı yeniden dene</Button>}
    <View style={{marginTop:10}}>{register&&<><Field label="Görünen ad" value={name} onChangeText={setName} maxLength={40}/><Field label="Şehir" value={city} onChangeText={setCity}/><Field label="Doğum tarihi (YYYY-AA-GG)" value={birth} onChangeText={setBirth} placeholder="1998-06-15" maxLength={10}/></>}<Field label="E-posta" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" placeholder="sen@ornek.com"/><Field label="Parola (en az 12 karakter)" value={password} onChangeText={setPassword} secureTextEntry maxLength={128}/>
    {register&&<Pressable accessibilityRole="checkbox" accessibilityState={{checked:accepted}} onPress={()=>setAccepted(!accepted)} style={[s.row,{alignItems:'flex-start',marginBottom:15}]}><Text style={{fontSize:23,color:c.green}}>{accepted?'☑':'☐'}</Text><P style={{flex:1,fontSize:12,lineHeight:19}}>18 yaşından büyüğüm. Verilerimin hesap, müzik önerisi, eşleşme ve güvenlik işlevleri için kullanılacağını okudum. {config?.mode==='demo'?'Bu bir deneme ortamıdır; gerçek kişisel veri kullanmamalıyım.':''}</P></Pressable>}
    <Button busy={busy} disabled={register&&!accepted||!config} onPress={()=>void submit()}>{register?'Hesap oluştur →':'Giriş yap →'}</Button></View>
    <Button small kind="light" onPress={()=>{setRegister(!register);setError('');}}>{register?'Zaten hesabım var':'Yeni misin? Hesap oluştur'}</Button>
    {config?.mode==='demo'&&<View style={{borderTopWidth:1,borderColor:c.line,paddingTop:20,gap:10,marginTop:6}}><Label>ÖRNEK HESAPLA DENE</Label><View style={s.row}><Button style={{flex:1}} kind="accent" disabled={busy} onPress={()=>void submit('ada')}>Ada olarak gir</Button><Button style={{flex:1}} kind="light" disabled={busy} onPress={()=>void submit('deniz')}>Deniz olarak gir</Button></View><P muted style={{fontSize:11}}>Örnek profiller ve kurmaca müzik kartları içerir. Ses kaydı çalınmaz.</P></View>}
    </Card>
  </View></ScrollView></SafeAreaView>;
}
