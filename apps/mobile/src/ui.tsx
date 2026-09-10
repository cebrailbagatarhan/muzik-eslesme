import React from 'react';
import { Pressable,Text,View,TextInput,StyleSheet,ActivityIndicator,Platform,type TextInputProps,type ViewStyle,Image } from 'react-native';
import { api } from './api';
export const c={bg:'#F6F4ED',paper:'#FFFFFF',ink:'#202522',muted:'#6D756E',line:'#DFE3DA',orange:'#F37455',peach:'#F7DAC4',green:'#365A47',lightGreen:'#EAF0E4',red:'#AF392E'};
export function Label({children}:{children:React.ReactNode}){return <Text style={s.label}>{children}</Text>;}
export function Title({children,small=false}:{children:React.ReactNode;small?:boolean}){return <Text style={[s.title,small&&{fontSize:28}]}>{children}</Text>;}
export function P({children,muted=false,style}:{children:React.ReactNode;muted?:boolean;style?:any}){return <Text style={[s.p,muted&&{color:c.muted},style]}>{children}</Text>;}
export function Button({children,onPress,kind='dark',busy=false,disabled=false,style,small=false}:{children:React.ReactNode;onPress:()=>void;kind?:'dark'|'light'|'accent'|'danger'|'green';busy?:boolean;disabled?:boolean;style?:ViewStyle;small?:boolean}){
  return <Pressable accessibilityRole="button" disabled={disabled||busy} onPress={onPress} style={({pressed})=>[s.button,small&&{paddingVertical:9,paddingHorizontal:13,minHeight:38},kind==='light'&&{backgroundColor:c.paper,borderColor:c.line,borderWidth:1},kind==='accent'&&{backgroundColor:c.orange},kind==='danger'&&{backgroundColor:'#FFF1EC',borderWidth:1,borderColor:'#EFCDC3'},kind==='green'&&{backgroundColor:c.green},(disabled||busy)&&{opacity:.5},pressed&&{opacity:.75},style]}>
    {busy?<ActivityIndicator color={kind==='dark'||kind==='green'?'white':c.ink}/>:<Text style={[s.buttonText,(kind==='light'||kind==='accent')&&{color:c.ink},kind==='danger'&&{color:c.red}]}>{children}</Text>}
  </Pressable>;
}
export function Field({label,...props}:TextInputProps&{label:string}){return <View style={{gap:7,marginBottom:15}}><Text style={s.fieldLabel}>{label}</Text><TextInput accessibilityLabel={label} placeholderTextColor="#929A91" {...props} style={[s.input,props.multiline&&{minHeight:95,textAlignVertical:'top'},props.style]}/></View>;}
export function Chip({children,selected=false,onPress}:{children:React.ReactNode;selected?:boolean;onPress?:()=>void}){
  return <Pressable accessibilityRole={onPress?'button':undefined} accessibilityState={{selected}} onPress={onPress} style={[s.chip,selected&&{backgroundColor:c.ink,borderColor:c.ink}]}><Text style={{color:selected?'white':c.ink,fontSize:12,fontWeight:'600'}}>{children}</Text></Pressable>;
}
export function Card({children,style}:{children:React.ReactNode;style?:ViewStyle}){return <View style={[s.card,style]}>{children}</View>;}
export function ErrorNotice({message}:{message:string}){return message?<View accessibilityRole="alert" style={{padding:14,backgroundColor:'#FFF1EC',borderRadius:12,marginVertical:8}}><Text style={{color:c.red,lineHeight:21}}>{message}</Text></View>:null;}
export function Empty({icon='♪',title,text,children}:{icon?:string;title:string;text:string;children?:React.ReactNode}){return <Card style={{padding:30,alignItems:'center',gap:15}}><Text style={{fontSize:44,color:c.green}}>{icon}</Text><Title small>{title}</Title><P muted style={{textAlign:'center',maxWidth:460}}>{text}</P>{children}</Card>;}
export function Avatar({name,size=52,photoId}:{name:string;size?:number;photoId?:string|null}){
  const [uri,setUri]=React.useState<string|null>(null);
  React.useEffect(()=>{let current=true;setUri(null);if(photoId)void api.get(`/v1/profile/photos/${photoId}/url`).then(data=>api.get(data.path)).then(photo=>{if(current)setUri(photo.dataUrl);}).catch(()=>{});return()=>{current=false;};},[photoId]);
  return <View style={{width:size,height:size,borderRadius:size/2,backgroundColor:c.peach,alignItems:'center',justifyContent:'center',overflow:'hidden'}}>{uri?<Image source={{uri}} style={{width:size,height:size}}/>:<Text style={{fontSize:size*.36,fontWeight:'700',color:'#6B4933'}}>{name.slice(0,2).toLocaleUpperCase('tr')}</Text>}</View>;
}
export const s=StyleSheet.create({
  page:{flex:1,backgroundColor:c.bg},row:{flexDirection:'row',alignItems:'center',gap:10},wrap:{flexDirection:'row',flexWrap:'wrap',gap:8},
  label:{fontSize:10,fontWeight:'700',letterSpacing:2,color:c.green,marginBottom:12},title:{fontSize:42,lineHeight:47,fontWeight:'700',letterSpacing:-1.5,color:c.ink,marginBottom:12},
  p:{fontSize:15,lineHeight:23,color:c.ink},fieldLabel:{fontSize:12,fontWeight:'600',color:c.ink},
  input:{borderColor:c.line,borderWidth:1,borderRadius:12,backgroundColor:'white',paddingHorizontal:14,paddingVertical:12,fontSize:15,color:c.ink,minHeight:47,...(Platform.OS==='web'?{outlineStyle:'none' as any}:{})},
  button:{minHeight:47,paddingVertical:13,paddingHorizontal:20,borderRadius:13,backgroundColor:c.ink,alignItems:'center',justifyContent:'center'},buttonText:{fontSize:13,fontWeight:'600',color:'white'},
  chip:{paddingVertical:8,paddingHorizontal:12,borderRadius:30,borderColor:c.line,borderWidth:1,backgroundColor:c.paper},
  card:{padding:22,borderRadius:22,backgroundColor:c.paper,borderColor:c.line,borderWidth:1},section:{gap:20,marginBottom:28},
});
