import React,{useState,useEffect,useRef} from 'react';
import { View,Text,ScrollView,Modal,Linking,useWindowDimensions } from 'react-native';
import { api,ApiError } from './api';
import { c,s,Title,P,Label,Card,Button,Field,Chip,Avatar,Empty,ErrorNotice } from './ui';
export function Chat({me,revision}:{me:any;revision:number}){
  const [matches,setMatches]=useState<any[]>([]),[selected,setSelected]=useState<any>(null),[messages,setMessages]=useState<any[]>([]),[sharing,setSharing]=useState<any>(null),[body,setBody]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[playlist,setPlaylist]=useState(false),[safety,setSafety]=useState(false),[shareRisk,setShareRisk]=useState(false),[messageTarget,setMessageTarget]=useState<string|null>(null),[before,setBefore]=useState<string|null>(null);
  const {width}=useWindowDimensions(),wide=width>1050,readRef=useRef<string|null>(null),scroll=useRef<ScrollView>(null);
  async function loadMatches(){try{setMatches((await api.get('/v1/matches')).items);}catch(e:any){setError(e.message);}}
  useEffect(()=>{void loadMatches();},[revision]);
  useEffect(()=>{
    if(!selected)return;let current=true;
    async function load(){
      try{
        const [list,social]=await Promise.all([api.get(`/v1/matches/${selected.id}/messages`),api.get(`/v1/matches/${selected.id}/instagram-share`)]);
        if(!current)return;setMessages(list.items);setBefore(list.nextBefore);setSharing(social);setError('');
        const unread=[...list.items].reverse().find((m:any)=>m.senderId!==me.id&&!m.readAt);
        if(unread&&readRef.current!==unread.id){readRef.current=unread.id;await api.post(`/v1/matches/${selected.id}/read`,{messageId:unread.id});}
      }catch(e:any){if(!current)return;if(e.code==='match_unavailable'){setSelected(null);setSharing(null);setMessages([]);setPlaylist(false);setError('Bu eşleşme artık kullanılamıyor.');void loadMatches();}else setError(e.message);}
    }
    void load();return()=>{current=false;};
  },[selected?.id,revision]);
  async function reloadConversation(){if(!selected)return;const list=await api.get(`/v1/matches/${selected.id}/messages`);setMessages(list.items);setBefore(list.nextBefore);setSharing(await api.get(`/v1/matches/${selected.id}/instagram-share`));}
  async function send(){if(!body.trim()||busy)return;setBusy(true);setError('');try{await api.post(`/v1/matches/${selected.id}/messages`,{body});setBody('');await reloadConversation();}catch(e:any){setError(e.message);}finally{setBusy(false);}}
  async function share(grant:boolean){setBusy(true);try{if(grant)await api.post(`/v1/matches/${selected.id}/instagram-share`,{acknowledgedRisk:true});else await api.delete(`/v1/matches/${selected.id}/instagram-share`);setShareRisk(false);await reloadConversation();}catch(e:any){setError(e.message);}finally{setBusy(false);}}
  async function removeMessage(id:string){setBusy(true);try{await api.delete(`/v1/matches/${selected.id}/messages/${id}`);await reloadConversation();}catch(e:any){setError(e.message);}finally{setBusy(false);}}
  async function older(){if(!before)return;try{const list=await api.get(`/v1/matches/${selected.id}/messages?before=${before}`);setMessages([...list.items,...messages]);setBefore(list.nextBefore);}catch(e:any){setError(e.message);}}
  function closeMatch(){setSelected(null);setSharing(null);setMessages([]);setSafety(false);setMessageTarget(null);void loadMatches();}
  return <View style={s.section}><View><Label>ORTAK BİR RİTİM BULDUK</Label><Title>Sohbetler.</Title><P muted>Bir şarkı önerisi, güzel bir başlangıç olabilir.</P></View><ErrorNotice message={error}/>
    <View style={{flexDirection:wide?'row':'column',gap:20,alignItems:'stretch'}}>
      {(wide||!selected)&&<View style={{width:wide?245:undefined,gap:10}}>{matches.length?matches.map(m=><Button key={m.id} kind={selected?.id===m.id?'dark':'light'} style={{alignItems:'flex-start'}} onPress={()=>{setSelected(m);setMessages([]);setSharing(null);readRef.current=null;}}>{m.peer.displayName}  {m.unread?`· ${m.unread} yeni`:'↗'}</Button>):<Empty title="İlk sohbetin burada" text="Karşılıklı beğeni olduğunda sohbet açılır."/>}</View>}
      {selected?<Card style={{flex:1,gap:17,padding:20}}>
        <View style={[s.row,{justifyContent:'space-between'}]}><View style={s.row}><Avatar name={selected.peer.displayName} size={42}/><View><Text style={{fontSize:18,fontWeight:'700',color:c.ink}}>{selected.peer.displayName}</Text><P muted style={{fontSize:11}}>Sadece ikinizin sohbeti</P></View></View><Button small kind="light" onPress={()=>{setMessageTarget(null);setSafety(true);}}>Güvenlik</Button></View>
        {!wide&&<Button small kind="light" onPress={()=>setSelected(null)}>← Tüm sohbetler</Button>}
        <View style={[s.wrap,{paddingBottom:12,borderBottomWidth:1,borderColor:c.line}]}><Button small kind="accent" onPress={()=>setPlaylist(true)}>♪ Ortak listemiz</Button><Button small kind="light" disabled={busy} onPress={()=>sharing?.myConsent?void share(false):setShareRisk(true)}>{sharing?.myConsent?'Paylaşım iznimi geri al':'Instagram’ımı paylaş'}</Button></View>
        {sharing?.state==='REQUESTED'&&<P muted style={{fontSize:12}}>{sharing.myConsent?'Paylaşım isteğin iletildi. Karşı taraf da kabul ettiğinde hesaplar görünür.':'Karşı taraf Instagram paylaşımını kabul etti. İstersen sen de izin verebilirsin.'}</P>}
        {sharing?.state==='MUTUAL'&&<View style={{padding:13,backgroundColor:c.lightGreen,borderRadius:12,gap:8}}><P style={{fontSize:12}}>İkiniz de paylaşımı kabul ettiniz.</P>{sharing.accounts.filter((a:any)=>a.userId!==me.id).map((a:any)=><Button key={a.userId} small kind="light" onPress={()=>void Linking.openURL(a.url)}>@{a.username} ↗</Button>)}<P muted style={{fontSize:11}}>Kullanıcının eklediği hesap; doğrulanmış değildir.</P></View>}
        <ScrollView ref={scroll} style={{height:330,maxHeight:440}} contentContainerStyle={{gap:12,paddingVertical:10}} onContentSizeChange={()=>{if(!before)scroll.current?.scrollToEnd({animated:false});}}>
          {before&&<Button small kind="light" onPress={()=>void older()}>Önceki mesajlar</Button>}
          {!messages.length&&<View style={{paddingVertical:35}}><P muted style={{textAlign:'center'}}>“Son günlerde tekrar tekrar dinlediğin şarkı hangisi?”</P></View>}
          {messages.map(m=><View key={m.id} style={{alignItems:m.senderId===me.id?'flex-end':'flex-start'}}><View style={{maxWidth:'85%',padding:13,borderRadius:15,backgroundColor:m.senderId===me.id?c.green:c.lightGreen}}><Text style={{color:m.senderId===me.id?'white':c.ink,fontSize:14,lineHeight:21}}>{m.body??'Bu mesaj silindi.'}</Text><Text style={{color:m.senderId===me.id?'#DAE6D9':c.muted,fontSize:10,marginTop:6}}>{new Date(m.createdAt).toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'})}{m.senderId===me.id?(m.readAt?' · Okundu':' · İletildi'):''}</Text></View>{m.body&&<Button small kind="light" disabled={busy} style={{marginTop:4,minHeight:30,paddingVertical:4,borderWidth:0,backgroundColor:'transparent'}} onPress={()=>m.senderId===me.id?void removeMessage(m.id):(setMessageTarget(m.id),setSafety(true))}>{m.senderId===me.id?'Sil':'Şikâyet et'}</Button>}</View>)}
        </ScrollView>
        <Field label="Mesajın" value={body} onChangeText={setBody} placeholder="Bir şarkıdan başlayalım…" multiline maxLength={2000}/><Button kind="green" busy={busy} disabled={!body.trim()} onPress={()=>void send()}>Mesaj gönder →</Button>
      </Card>:wide&&<View style={{flex:1}}><Empty title="Konuşmaya yer aç" text="Bir eşleşmeni seçerek sohbeti açabilir ve birlikte bir liste hazırlayabilirsin."/></View>}
    </View>
    <Modal visible={shareRisk} transparent animationType="fade" onRequestClose={()=>setShareRisk(false)}><View style={{flex:1,backgroundColor:'#0007',justifyContent:'center',padding:24}}><Card style={{maxWidth:500,width:'100%',alignSelf:'center',gap:17}}><Title small>Instagram’ını paylaş</Title><P>Kullanıcı adın yalnızca bu eşleşmede ve iki taraf da izin verdiğinde açılır. Uygulama dışındaki konuşmaları burada denetleyemeyiz. İznini geri almak, daha önce görülmüş bilgiyi geri alamaz.</P><Button kind="accent" busy={busy} onPress={()=>void share(true)}>Anladım, bu eşleşmede paylaş</Button><Button kind="light" onPress={()=>setShareRisk(false)}>Vazgeç</Button></Card></View></Modal>
    {selected&&<Playlist visible={playlist} close={()=>setPlaylist(false)} matchId={selected.id}/>}
    {selected&&<Safety visible={safety} close={()=>setSafety(false)} match={selected} messageId={messageTarget} after={closeMatch}/>}
  </View>;
}
function Safety({visible,close,match,messageId,after}:{visible:boolean;close:()=>void;match:any;messageId:string|null;after:()=>void}){
  const [category,setCategory]=useState('harassment'),[detail,setDetail]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  async function act(type:string){setBusy(true);setError('');try{
    if(type==='report')await api.post('/v1/reports',{targetType:messageId?'message':'user',targetId:messageId??match.peer.id,category,detail});
    if(type==='block')await api.post('/v1/blocks',{userId:match.peer.id});
    if(type==='unmatch')await api.delete(`/v1/matches/${match.id}`);after();
  }catch(e:any){setError(e.message);}finally{setBusy(false);}}
  const categories:any={harassment:'Taciz',threat:'Tehdit',underage:'18 yaş altı',impersonation:'Sahte hesap',nudity:'Çıplaklık',spam:'Spam',fraud:'Dolandırıcılık',other:'Diğer'};
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={close}><View style={{flex:1,backgroundColor:'#0007',justifyContent:'center',padding:20}}><ScrollView contentContainerStyle={{maxWidth:520,width:'100%',alignSelf:'center'}}><Card style={{gap:15}}><Title small>Güvenliğin önce gelir.</Title><P muted>{match.peer.displayName} ile {messageId?'bu mesajı':'eşleşmeni'} bildir. Rapor gönderildiğinde birbirinizi göremezsiniz ve sohbet kapanır.</P><View style={s.wrap}>{Object.entries(categories).map(([key,value])=><Chip key={key} selected={category===key} onPress={()=>setCategory(key)}>{value as string}</Chip>)}</View><Field label="Açıklama (isteğe bağlı)" value={detail} onChangeText={setDetail} multiline maxLength={1500}/><ErrorNotice message={error}/><Button busy={busy} kind="danger" onPress={()=>void act('report')}>Şikâyeti gönder</Button><Button disabled={busy} kind="danger" onPress={()=>void act('block')}>Kullanıcıyı engelle</Button><Button disabled={busy} kind="light" onPress={()=>void act('unmatch')}>Eşleşmeyi kaldır</Button><Button kind="light" onPress={close}>Vazgeç</Button></Card></ScrollView></View></Modal>;
}
function Playlist({visible,close,matchId}:{visible:boolean;close:()=>void;matchId:string}){
  const [draft,setDraft]=useState<any>(null),[items,setItems]=useState<any[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[spotify,setSpotify]=useState<any>(null),[job,setJob]=useState<any>(null),[notice,setNotice]=useState('');
  async function load(id:string){const data=await api.get(`/v1/playlist-drafts/${id}`);setDraft(data);setItems(data.items);}
  useEffect(()=>{if(!visible)return;let current=true;setError('');setJob(null);setNotice('');setBusy(true);(async()=>{try{
    const [list,status]=await Promise.all([api.get(`/v1/matches/${matchId}/playlist-drafts`),api.get('/v1/integrations/spotify/status')]);if(!current)return;setSpotify(status);
    const first=list.items[0]??await api.post(`/v1/matches/${matchId}/playlist-drafts`);if(current)await load(first.id);
  }catch(e:any){if(current)setError(e.message);}finally{if(current)setBusy(false);}})();return()=>{current=false;};},[visible,matchId]);
  useEffect(()=>{if(!visible||!job?.id||['completed','failed','uncertain','cancelled'].includes(job.status))return;const timer=setInterval(()=>{void api.get(`/v1/spotify-exports/${job.id}`).then(setJob).catch((e:ApiError)=>setError(e.message));},2500);return()=>clearInterval(timer);},[visible,job?.id,job?.status]);
  function move(i:number,delta:number){const next=[...items],target=i+delta;if(target<0||target>=next.length)return;[next[i],next[target]]=[next[target],next[i]];setItems(next);setNotice('');}
  async function save(){setBusy(true);try{await api.put(`/v1/playlist-drafts/${draft.id}`,{revision:draft.revision,trackIds:items.map(i=>i.trackId)});await load(draft.id);setNotice('Sıralama kaydedildi.');setError('');}catch(e:any){setError(e.message);}finally{setBusy(false);}}
  async function regenerate(){setBusy(true);try{await load((await api.post(`/v1/matches/${matchId}/playlist-drafts`)).id);setError('');setJob(null);}catch(e:any){setError(e.message);}finally{setBusy(false);}}
  async function exportSpotify(){setBusy(true);try{setJob(await api.post(`/v1/playlist-drafts/${draft.id}/spotify-export`,{confirmed:true}));}catch(e:any){setError(e.message);}finally{setBusy(false);}}
  return <Modal visible={visible} animationType="slide" onRequestClose={close}><View style={{flex:1,backgroundColor:c.bg,padding:24}}><View style={{width:'100%',maxWidth:850,alignSelf:'center',flex:1,gap:15}}><View style={[s.row,{justifyContent:'space-between'}]}><View><Label>İKİ KİŞİ, TEK SEÇKİ</Label><Title small>Ortak listemiz.</Title></View><Button kind="light" onPress={close}>Kapat ×</Button></View><P muted>Ortak beğeniler ve yeni keşifler. Parçaları sıralayabilir ya da çıkarabilirsin.</P><ErrorNotice message={error}/>{notice&&<P>{notice}</P>}
    <ScrollView contentContainerStyle={{gap:9,paddingBottom:20}}>{items.map((item,i)=><Card key={item.trackId} style={{padding:14}}><View style={[s.row,{alignItems:'flex-start'}]}><Text style={{color:c.muted,width:22,fontSize:12,marginTop:3}}>{String(i+1).padStart(2,'0')}</Text><View style={{flex:1,gap:3}}><Text style={{fontSize:14,fontWeight:'700',color:c.ink}}>{item.track.title}</Text><P muted style={{fontSize:12}}>{item.track.artist}</P><P muted style={{fontSize:11}}>{item.reason}</P></View><View style={{gap:4}}><Button small kind="light" disabled={i===0||busy} onPress={()=>move(i,-1)}>↑</Button><Button small kind="light" disabled={i===items.length-1||busy} onPress={()=>move(i,1)}>↓</Button><Button small kind="light" disabled={busy||items.length<=1} onPress={()=>setItems(items.filter((_,j)=>j!==i))}>×</Button></View></View></Card>)}</ScrollView>
    {job&&<Card style={{padding:12,gap:8}}><P>Aktarım: {({queued:'Sırada',creating:'Liste oluşturuluyor',filling:'Parçalar ekleniyor',completed:'Tamamlandı',uncertain:'Sonuç doğrulanamadı; tekrar liste oluşturulmadı.',failed:'Tamamlanamadı',cancelled:'İptal edildi'} as any)[job.status]??job.status}</P>{job.url&&<Button small kind="light" onPress={()=>void Linking.openURL(job.url)}>Spotify’da aç ↗</Button>}</Card>}
    <View style={s.wrap}><Button busy={busy} disabled={!draft||!items.length} onPress={()=>void save()}>Düzenlemeyi kaydet</Button><Button kind="light" disabled={busy} onPress={()=>void regenerate()}>Yeni seçki oluştur</Button>{spotify?.enabled&&spotify?.connected&&<Button kind="green" disabled={busy||JSON.stringify(items.map(i=>i.trackId))!==JSON.stringify(draft?.items.map((i:any)=>i.trackId))} onPress={()=>void exportSpotify()}>Bu listeyi Spotify’a aktar</Button>}</View>
    </View></View></Modal>;
}
