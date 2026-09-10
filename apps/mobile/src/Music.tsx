import React,{useState,useEffect} from 'react';
import { View,Text,useWindowDimensions } from 'react-native';
import { api } from './api';
import { c,s,Title,P,Label,Card,Button,Chip,ErrorNotice,Empty,Avatar } from './ui';
type ScreenProps={me:any;reload:()=>Promise<void>;go:(tab:string)=>void;revision:number};
export function Music({me,reload,go}:ScreenProps){
  const [cards,setCards]=useState<any[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const {width}=useWindowDimensions(),wide=width>1050;
  async function load(){try{setCards((await api.get('/v1/music/cards')).items);}catch(e:any){setError(e.message);}}
  useEffect(()=>{void load();},[]);
  async function swipe(action:string){if(!cards[0]||busy)return;setBusy(true);setError('');try{await api.post('/v1/music/swipes',{itemId:cards[0].id,action});await Promise.all([load(),reload()]);}catch(e:any){setError(e.message);}finally{setBusy(false);}}
  async function undo(){setBusy(true);try{await api.post('/v1/music/swipes/undo');await Promise.all([load(),reload()]);setError('');}catch(e:any){setError(e.message);}finally{setBusy(false);}}
  const track=cards[0];
  return <View style={s.section}>
    <View><Label>MÜZİĞİN BULUŞTUĞU YER</Label><Title>Bir şarkıyla başlar.</Title><P muted>Sevdiğin sesleri seç. Ortak bir ritim yakaladığın insanlarla tanış.</P></View>
    <View style={{flexDirection:wide?'row':'column',gap:22,alignItems:'stretch'}}>
      <View style={{flex:1,gap:14}}>
        {track?<Card style={{padding:0,overflow:'hidden'}}>
          <View style={{height:wide?284:240,backgroundColor:c.peach,alignItems:'center',justifyContent:'center',overflow:'hidden'}}>
            <Text style={{position:'absolute',left:22,top:20,fontSize:10,letterSpacing:2,color:'#664939'}}>AHENK / SEÇKİ {track.id.slice(-2)}</Text>
            <View style={{width:215,height:215,borderRadius:108,backgroundColor:c.ink,alignItems:'center',justifyContent:'center',transform:[{rotate:'-18deg'}]}}>
              {[194,174,154,134].map(size=><View key={size} style={{position:'absolute',width:size,height:size,borderRadius:size/2,borderColor:'#3D443E',borderWidth:1}}/>)}
              <View style={{width:95,height:95,borderRadius:48,backgroundColor:c.orange,alignItems:'center',justifyContent:'center'}}><Text style={{fontSize:32,color:c.ink}}>♪</Text><Text style={{fontSize:9,letterSpacing:1}}>AHENK</Text></View>
            </View>
            <Text style={{position:'absolute',right:20,bottom:20,fontSize:11,color:'#664939'}}>Senin sesin, senin seçimin.</Text>
          </View>
          <View style={{padding:23,gap:7}}><View style={[s.row,{justifyContent:'space-between'}]}><Text style={{color:c.muted,fontSize:11,letterSpacing:1}}>BUGÜNÜN KEŞFİ</Text><Text style={{color:c.muted,fontSize:11}}>{track.decade}'lar</Text></View><Text style={{fontSize:26,fontWeight:'700',color:c.ink}}>{track.title}</Text><P muted>{track.artist}</P><View style={[s.wrap,{marginTop:6}]}>{track.genres.map((g:string)=><Chip key={g}>{g}</Chip>)}{track.rights_status==='demo'&&<Chip>Örnek kart · ses içermez</Chip>}</View></View>
        </Card>:<Empty title="Seçkiyi tamamladın" text="Müzik imzan hazır. Şimdi ortak zevklerin olan insanları keşfedebilirsin."><Button onPress={()=>go('people')}>İnsanları keşfet →</Button></Empty>}
        {track&&<View style={[s.row,{gap:9}]}><Button style={{flex:1}} kind="light" disabled={busy} onPress={()=>void swipe('dislike')}>× Beğenmedim</Button><Button kind="light" disabled={busy} onPress={()=>void swipe('pass')}>Geç</Button><Button kind="accent" disabled={busy} onPress={()=>void swipe('favorite')}>✦ Favori</Button><Button style={{flex:1}} kind="green" disabled={busy} onPress={()=>void swipe('like')}>♥ Beğendim</Button></View>}
        <View style={[s.row,{justifyContent:'space-between'}]}><Button small kind="light" disabled={busy} onPress={()=>void undo()}>↶ Son seçimi geri al</Button>{busy&&<P muted>Kaydediliyor…</P>}</View>
        <ErrorNotice message={error}/>
      </View>
      <View style={{width:wide?265:undefined,gap:18}}>
        <Card style={{backgroundColor:c.green,borderColor:c.green,gap:14}}><Text style={{color:'#DCE8D6',fontSize:10,letterSpacing:2}}>MÜZİK İMZAN</Text><Text style={{color:'white',fontSize:36,fontWeight:'700'}}>{me.rated}<Text style={{fontSize:17,color:'#DCE8D6'}}> / {me.requiredRatings}</Text></Text><View style={{height:5,backgroundColor:'#527561',borderRadius:5}}><View style={{width:`${Math.min(100,me.rated/me.requiredRatings*100)}%`,height:5,backgroundColor:'#DEEBA0',borderRadius:5}}/></View><P style={{color:'#E1E9DE',fontSize:13}}>{me.onboardingComplete?'İmzan oluştu. Her yeni seçim onu biraz daha sana benzetir.':`Başlamak için ${Math.max(0,me.requiredRatings-me.rated)} parçayı daha değerlendir. Geçtiğin kartlar bu sayıya dahil edilmez.`}</P><Button kind="light" onPress={()=>go('people')}>Uyumunu keşfet ↗</Button></Card>
        <Card style={{gap:12}}><Label>KÜÇÜK BİR NOT</Label><Text style={{fontSize:26,color:c.orange}}>“</Text><P>İlk mesajın konusu hazır olsun.</P><P muted style={{fontSize:13}}>Ortak sanatçılar, sevdiğiniz parçalar ve birlikte keşfedeceğiniz bir çalma listesi.</P></Card>
        <P muted style={{fontSize:11}}>Müzik zevkin, bu uygulamadaki seçimlerinden oluşur.</P>
      </View>
    </View>
  </View>;
}
export function People({me,go,revision}:ScreenProps){
  const [items,setItems]=useState<any[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[loading,setLoading]=useState(true);
  async function load(){if(!me.onboardingComplete){setLoading(false);return;}try{setItems((await api.get('/v1/people/feed')).items);setError('');}catch(e:any){setError(e.message);}finally{setLoading(false);}}
  useEffect(()=>{void load();},[me.onboardingComplete,revision]);
  async function swipe(action:string){if(!items[0])return;setBusy(true);try{const result=await api.post(`/v1/people/${items[0].id}/swipes`,{action});if(result.matched)setNotice('Aynı ritimdesiniz! Eşleşmeniz sohbetlerde seni bekliyor.');await load();}catch(e:any){setError(e.message);}finally{setBusy(false);}}
  if(!me.onboardingComplete)return <Empty title="Önce senin müziğini tanıyalım" text={me.ageVerified?`En az ${me.requiredRatings} parçayı değerlendirerek müzik imzanı oluştur.`:'Kişi önerilerini açmak için yaş doğrulamanın tamamlanması gerekiyor.'}><Button onPress={()=>go('music')}>Müzik kartlarına dön →</Button></Empty>;
  const person=items[0];
  return <View style={s.section}><View><Label>ORTAK SESLER, YENİ HİKÂYELER</Label><Title>Aynı ritimde.</Title><P muted>Şehrindeki insanlarla, müziğin açtığı bir kapıdan tanış.</P></View>
    {notice&&<Card style={{backgroundColor:c.lightGreen,gap:12}}><P>{notice}</P><Button onPress={()=>go('chat')}>Sohbetlere git →</Button></Card>}
    <ErrorNotice message={error}/>
    {loading?<P muted>Önerilerin hazırlanıyor…</P>:person?<Card style={{gap:23,maxWidth:720}}>
      <View style={{backgroundColor:c.lightGreen,minHeight:160,borderRadius:16,alignItems:'center',justifyContent:'center',gap:12}}><Avatar name={person.displayName} size={100} photoId={person.photoId}/><View style={s.wrap}>{person.commonGenres.slice(0,3).map((g:string)=><Chip key={g}>{g}</Chip>)}</View></View>
      <View style={[s.row,{justifyContent:'space-between'}]}><View><Text style={{fontSize:29,fontWeight:'700',color:c.ink}}>{person.displayName}, {person.age}</Text><P muted>{person.city} · {person.intention==='dating'?'Tanışma':'Arkadaşlık'}</P></View><View style={{alignItems:'center',backgroundColor:c.peach,padding:14,borderRadius:16}}><Text style={{fontSize:26,fontWeight:'700',color:c.ink}}>{person.musicScore}</Text><Text style={{fontSize:10,color:c.ink}}>MÜZİK PUANI</Text></View></View>
      <P>{person.bio||'Bir şarkı önerisiyle sohbete başlayabilirsin.'}</P>
      <View style={{borderTopWidth:1,borderColor:c.line,paddingTop:20,gap:12}}><Label>NEDEN BİR ARADASINIZ?</Label>{person.reasons.map((reason:string)=><P key={reason}>✦  {reason}</P>)}{person.hasInstagram&&<P muted style={{fontSize:12}}>Instagram ekli · yalnızca karşılıklı izinle paylaşılır</P>}</View>
      <View style={s.row}><Button style={{flex:1}} kind="light" disabled={busy} onPress={()=>void swipe('pass')}>Şimdilik geç</Button><Button style={{flex:1}} kind="accent" disabled={busy} onPress={()=>void swipe('like')}>♥ Tanışmak isterim</Button></View>
      <P muted style={{fontSize:11}}>Puan, ortak müzik seçimlerinizi özetler.</P>
    </Card>:<Empty title="Yeni seslere biraz alan açalım" text="Şu an tercihlerine uygun yeni bir öneri yok. Şehrini ve yaş aralığını gözden geçirebilir ya da daha sonra tekrar bakabilirsin."><Button kind="light" onPress={()=>go('profile')}>Tercihlerimi düzenle</Button></Empty>}
  </View>;
}
