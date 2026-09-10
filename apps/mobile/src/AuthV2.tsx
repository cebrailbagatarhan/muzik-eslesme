import React,{useState} from 'react';
import { View,Text,ScrollView,Pressable,StatusBar,SafeAreaView,useWindowDimensions } from 'react-native';
import { api,saveSession,type Session } from './api';
import { c,s,Title,P,Label,Card,Button,Field,Chip,ErrorNotice } from './ui';

type Mode='login'|'register'|'verify'|'forgot'|'reset'|'appeal';
export function AuthV2({config,connectionError,retryConfig}:{config:any;connectionError:string;retryConfig:()=>void}){
  const [mode,setMode]=useState<Mode>('login'),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[name,setName]=useState(''),[city,setCity]=useState('İstanbul'),[birth,setBirth]=useState(''),[accepted,setAccepted]=useState(false),[token,setToken]=useState(''),[newPassword,setNewPassword]=useState(''),[appeal,setAppeal]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const {width}=useWindowDimensions(),wide=width>=850;
  function switchMode(next:Mode){setMode(next);setError('');setNotice('');setToken('');}
  async function run(fn:()=>Promise<void>){setBusy(true);setError('');setNotice('');try{await fn();}catch(e:any){setError(e.message);}finally{setBusy(false);}}
  async function login(demo?:string){
    const data=await api.post<Session>('/v1/auth/login',demo?{email:`${demo}@demo.local`,password:'AhenkDemo!2026'}:{email,password});await saveSession(data);
  }
  async function register(){
    const data=await api.post<any>('/v1/auth/register',{email,password,displayName:name,city,birthDate:birth,acceptedTerms:accepted});
    if(data.verificationRequired){setEmail(data.email??email);if(data.debugToken)setToken(data.debugToken);setMode('verify');setNotice('Hesabın oluşturuldu. E-posta doğrulamasını tamamla.');return;}
    await saveSession(data as Session);
  }
  async function requestVerification(){const data=await api.post<any>('/v1/auth/email-verification/request',{email});if(data.debugToken)setToken(data.debugToken);setNotice('Doğrulama e-postası gönderildiyse gelen bağlantıdaki kodu aşağıya yapıştır.');}
  async function confirmVerification(){await api.post('/v1/auth/email-verification/confirm',{token});setNotice('E-posta doğrulandı. Şimdi giriş yapabilirsin.');setMode('login');}
  async function requestReset(){const data=await api.post<any>('/v1/auth/password-reset/request',{email});if(data.debugToken)setToken(data.debugToken);setMode('reset');setNotice('Parola yenileme e-postası gönderildiyse gelen kodu aşağıya yapıştır.');}
  async function confirmReset(){await api.post('/v1/auth/password-reset/confirm',{token,newPassword});setPassword('');setNewPassword('');setMode('login');setNotice('Parolan yenilendi. Yeni parolanla giriş yapabilirsin.');}
  async function submitAppeal(){await api.post('/v1/moderation/appeals',{email,password,body:appeal});setNotice('İtirazın inceleme kuyruğuna alındı.');setAppeal('');}
  const heading=mode==='register'?'Aramıza katıl.':mode==='verify'?'E-postanı doğrula.':mode==='forgot'||mode==='reset'?'Hesabını geri al.':mode==='appeal'?'Askı kararına itiraz et.':'Yeniden merhaba.';
  return <SafeAreaView style={s.page}><StatusBar barStyle="dark-content"/><ScrollView contentContainerStyle={{flexGrow:1,justifyContent:'center',padding:wide?55:22}} keyboardShouldPersistTaps="handled"><View style={{flexDirection:wide?'row':'column',maxWidth:1110,width:'100%',alignSelf:'center',gap:wide?80:30,alignItems:'center'}}>
    <View style={{flex:1,width:'100%',gap:25}}><Brand/><View><Label>ORTAK BİR ŞARKIDAN FAZLASI</Label><Text style={{fontSize:wide?68:46,lineHeight:wide?74:52,color:c.ink,fontWeight:'700',letterSpacing:-3}}>Aynı şarkıda{'\n'}buluşalım.</Text></View><P muted style={{maxWidth:400,fontSize:17,lineHeight:27}}>Müzik zevkini paylaşan insanları keşfet. Birlikte bir liste, belki de güzel bir hikâye başlat.</P><View style={s.wrap}><Chip>18+</Chip><Chip>Ortak müzik zevki</Chip><Chip>Karşılıklı eşleşme</Chip></View></View>
    <Card style={{width:wide?420:'100%',padding:28,gap:12}}><Label>KENDİ RİTMİNDE TANIŞ</Label><Title small>{heading}</Title><ErrorNotice message={connectionError||error}/>{notice?<Card style={{backgroundColor:c.lightGreen,padding:12}}><P>{notice}</P></Card>:null}{connectionError&&<Button small kind="light" onPress={retryConfig}>Bağlantıyı yeniden dene</Button>}
      {mode==='register'&&<><Field label="Görünen ad" value={name} onChangeText={setName} maxLength={40}/><Field label="Şehir" value={city} onChangeText={setCity} maxLength={60}/><Field label="Doğum tarihi (YYYY-AA-GG)" value={birth} onChangeText={setBirth} placeholder="1998-06-15" maxLength={10}/></>}
      {['login','register','verify','forgot','appeal'].includes(mode)&&<Field label="E-posta" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" placeholder="sen@ornek.com"/>}
      {['login','register','appeal'].includes(mode)&&<Field label="Parola" value={password} onChangeText={setPassword} secureTextEntry maxLength={128}/>} 
      {mode==='register'&&<Pressable accessibilityRole="checkbox" accessibilityState={{checked:accepted}} onPress={()=>setAccepted(!accepted)} style={[s.row,{alignItems:'flex-start'}]}><Text style={{fontSize:23,color:c.green}}>{accepted?'☑':'☐'}</Text><P style={{flex:1,fontSize:12,lineHeight:19}}>18 yaşından büyüğüm; zorunlu kullanım şartları ve gizlilik bilgilendirmesini okudum.</P></Pressable>}
      {mode==='verify'&&<><Field label="Doğrulama kodu" value={token} onChangeText={setToken} autoCapitalize="none"/><Button busy={busy} disabled={token.length<40} onPress={()=>void run(confirmVerification)}>E-postayı doğrula</Button><Button kind="light" busy={busy} onPress={()=>void run(requestVerification)}>Yeni doğrulama e-postası iste</Button></>}
      {mode==='forgot'&&<Button busy={busy} disabled={!email} onPress={()=>void run(requestReset)}>Parola yenileme e-postası iste</Button>}
      {mode==='reset'&&<><Field label="Parola yenileme kodu" value={token} onChangeText={setToken} autoCapitalize="none"/><Field label="Yeni parola (en az 12 karakter)" value={newPassword} onChangeText={setNewPassword} secureTextEntry maxLength={128}/><Button busy={busy} disabled={token.length<40||newPassword.length<12} onPress={()=>void run(confirmReset)}>Parolayı yenile</Button></>}
      {mode==='appeal'&&<><Field label="İtiraz açıklaması" value={appeal} onChangeText={setAppeal} multiline maxLength={2000}/><Button busy={busy} disabled={appeal.trim().length<20} onPress={()=>void run(submitAppeal)}>İtirazı gönder</Button></>}
      {mode==='login'&&<><Button busy={busy} disabled={!config} onPress={()=>void run(()=>login())}>Giriş yap →</Button><Button small kind="light" onPress={()=>switchMode('forgot')}>Parolamı unuttum</Button><Button small kind="light" onPress={()=>switchMode('verify')}>E-postamı doğrula</Button><Button small kind="light" onPress={()=>switchMode('appeal')}>Hesabım askıda</Button></>}
      {mode==='register'&&<Button busy={busy} disabled={!accepted||!config} onPress={()=>void run(register)}>Hesap oluştur →</Button>}
      {mode!=='login'&&<Button small kind="light" onPress={()=>switchMode('login')}>Giriş ekranına dön</Button>}
      {mode==='login'&&<Button small kind="light" onPress={()=>switchMode('register')}>Yeni misin? Hesap oluştur</Button>}
      {mode==='login'&&config?.mode==='demo'&&<View style={{borderTopWidth:1,borderColor:c.line,paddingTop:20,gap:10}}><Label>ÖRNEK HESAPLA DENE</Label><View style={s.row}><Button style={{flex:1}} kind="accent" disabled={busy} onPress={()=>void run(()=>login('ada'))}>Ada olarak gir</Button><Button style={{flex:1}} kind="light" disabled={busy} onPress={()=>void run(()=>login('deniz'))}>Deniz olarak gir</Button></View></View>}
    </Card>
  </View></ScrollView></SafeAreaView>;
}
function Brand(){return <View style={s.row}><View style={{flexDirection:'row',alignItems:'center',gap:3,height:28}}>{[12,23,17,28].map((height,i)=><View key={i} style={{height,width:4,borderRadius:3,backgroundColor:c.orange}}/>)}</View><Text style={{fontSize:30,fontWeight:'800',letterSpacing:-1.4,color:c.ink}}>ahenk</Text><Text style={{fontSize:12,alignSelf:'flex-start',color:c.green}}>✳</Text></View>;}
