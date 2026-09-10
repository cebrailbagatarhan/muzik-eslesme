import React,{useEffect,useState,useCallback} from 'react';
import { View,Text,ScrollView,Pressable,StatusBar,SafeAreaView,useWindowDimensions,ActivityIndicator,Platform } from 'react-native';
import { api,saveSession,restoreSession,hasSession,onSessionChanged,connectEvents } from './api';
import { c,s,Card,Button,Chip,Avatar,ErrorNotice } from './ui';
import { Music,People } from './Music';
import { Chat } from './Chat';
import { Profile } from './Profile';
import { Admin } from './Admin';
import { AuthV2 } from './AuthV2';
export default function App(){
  const [authenticated,setAuthenticated]=useState(hasSession()),[me,setMe]=useState<any>(null),[notices,setNotices]=useState<any[]>([]),[config,setConfig]=useState<any>(null),[tab,setTab]=useState('music'),[error,setError]=useState(''),[revision,setRevision]=useState(0),[ready,setReady]=useState(false);
  const {width}=useWindowDimensions(),desktop=width>=850;
  useEffect(()=>onSessionChanged(()=>{setAuthenticated(hasSession());if(!hasSession()){setMe(null);setNotices([]);setTab('music');}}),[]);
  useEffect(()=>{void restoreSession().finally(()=>{setAuthenticated(hasSession());setReady(true);});void api.get('/v1/config').then(setConfig).catch(e=>setError(e.message));},[]);
  const reload=useCallback(async()=>{if(!hasSession())return;try{const [profile,noticeData]=await Promise.all([api.get('/v1/me'),api.get('/v1/notices')]);setMe(profile);setNotices(noticeData.items??[]);setError('');}catch(e:any){setError(e.message);}},[]);
  useEffect(()=>{if(!authenticated)return;void reload();let dispose:(()=>void)|undefined,done=false;
    void connectEvents(()=>{setRevision(r=>r+1);void reload();}).then(fn=>{if(done)fn();else dispose=fn;});
    const timer=setInterval(()=>{setRevision(r=>r+1);},15000);
    return()=>{done=true;dispose?.();clearInterval(timer);};
  },[authenticated,reload]);
  async function logout(){try{await api.post('/v1/auth/logout');}finally{await saveSession(null);}}
  if(!ready)return <View style={[s.page,{justifyContent:'center'}]}><ActivityIndicator color={c.green}/></View>;
  if(!authenticated)return <AuthV2 config={config} connectionError={error} retryConfig={()=>void api.get('/v1/config').then(v=>{setConfig(v);setError('');}).catch(e=>setError(e.message))}/>;
  const tabs=[['music','♪','Müzik keşfet'],['people','✦','İnsanları keşfet'],['chat','↗','Sohbetler'],['profile','○','Profilim'],...(me?.role==='moderator'?[['admin','◈','Moderasyon']]:[])];
  function nav(compact=false){return tabs.map(([key,icon,label])=><Pressable key={key} accessibilityRole="button" accessibilityState={{selected:tab===key}} onPress={()=>{setTab(key);setError('');}} style={{flex:compact?1:undefined,flexDirection:compact?'column':'row',alignItems:'center',gap:compact?4:13,paddingVertical:compact?9:14,paddingHorizontal:compact?4:16,borderRadius:14,backgroundColor:tab===key?c.lightGreen:'transparent'}}><Text style={{fontSize:21,color:tab===key?c.green:c.muted}}>{icon}</Text><Text style={{fontSize:compact?9:13,fontWeight:tab===key?'700':'500',color:tab===key?c.green:c.muted}}>{label}</Text></Pressable>);}
  const visibleNotices=notices.filter(n=>n.action==='warn').slice(0,2);
  return <SafeAreaView style={s.page}><StatusBar barStyle="dark-content" backgroundColor={c.bg}/><View style={{flex:1,flexDirection:'row'}}>
    {desktop&&<View style={{width:230,padding:25,borderRightWidth:1,borderColor:c.line,gap:35}}><Brand/><View style={{gap:6}}>{nav()}</View><View style={{flex:1}}/>{me&&<View style={{gap:14}}><View style={s.row}><Avatar name={me.displayName} size={38}/><View><Text style={{fontSize:13,fontWeight:'700',color:c.ink}}>{me.displayName}</Text><Text style={{fontSize:11,color:c.muted}}>Kendi ritminde.</Text></View></View><Button small kind="light" onPress={()=>void logout()}>Çıkış yap</Button><Text style={{fontSize:10,color:c.muted}}>AHENK © 2026</Text></View>}</View>}
    <View style={{flex:1,minWidth:0}}><View style={{paddingHorizontal:desktop?38:20,paddingVertical:18,borderBottomWidth:1,borderColor:c.line,flexDirection:'row',justifyContent:'space-between',alignItems:'center'}}>{desktop?<Text style={{fontSize:12,color:c.muted}}>Merhaba {me?.displayName??''}, bugün ne dinliyoruz?</Text>:<Brand small/>}<View style={s.row}>{config?.mode==='demo'&&<Chip>DEMO · Örnek veriler</Chip>}{!desktop&&<Button small kind="light" onPress={()=>void logout()}>Çıkış</Button>}</View></View>
      <ScrollView style={{flex:1}} contentContainerStyle={{padding:desktop?38:20,width:'100%',maxWidth:1200,alignSelf:'center',paddingBottom:60}} keyboardShouldPersistTaps="handled">
        <ErrorNotice message={error}/>{visibleNotices.map(n=><Card key={n.id} style={{padding:14,marginBottom:12,backgroundColor:'#FFF1EC',borderColor:'#EFCDC3'}}><Text style={{fontSize:12,fontWeight:'700',color:c.red,marginBottom:5}}>MODERASYON UYARISI</Text><Text style={{fontSize:14,lineHeight:21,color:c.ink}}>{n.note}</Text><Text style={{fontSize:10,color:c.muted,marginTop:6}}>{new Date(n.createdAt).toLocaleString('tr-TR')}</Text></Card>)}{!me?<ActivityIndicator color={c.green}/>:tab==='music'?<Music me={me} reload={reload} go={setTab} revision={revision}/>:tab==='people'?<People me={me} reload={reload} go={setTab} revision={revision}/>:tab==='chat'?<Chat me={me} revision={revision}/>:tab==='profile'?<Profile me={me} reload={reload}/>:me.role==='moderator'?<Admin/>:null}
      </ScrollView>{!desktop&&<View style={{flexDirection:'row',paddingHorizontal:8,paddingTop:8,paddingBottom:Platform.OS==='android'?12:4,borderTopWidth:1,borderColor:c.line,backgroundColor:c.bg}}>{nav(true)}</View>}
    </View>
  </View></SafeAreaView>;
}
function Brand({small=false}:{small?:boolean}){return <View style={s.row}><View style={{flexDirection:'row',alignItems:'center',gap:3,height:28}}>{[12,23,17,28].map((height,i)=><View key={i} style={{height,width:4,borderRadius:3,backgroundColor:c.orange}}/>)}</View><Text style={{fontSize:small?23:30,fontWeight:'800',letterSpacing:-1.4,color:c.ink}}>ahenk</Text><Text style={{fontSize:12,alignSelf:'flex-start',color:c.green}}>✳</Text></View>;}
