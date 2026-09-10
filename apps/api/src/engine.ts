export const ALGORITHM_VERSION='music-v1.0.0';
export type Track={id:string;recording_id:string;title:string;artist:string;genres:string[];decade:string;explicit:boolean;rights_status:string;source:string;link_url?:string;spotify_uri?:string};
export type Taste={artists:Record<string,number>;tracks:Record<string,number>;tags:Record<string,number>;negative:string[];exploration:number;rated:number};
type Swipe={item_id:string;action:string};
const positive=(action:string)=>action==='favorite'?2:action==='like'?1:0;
const bump=(values:Record<string,number>,key:string,n:number)=>{values[key]=(values[key]??0)+n;};
export function tasteProfile(catalog:Track[],swipes:Swipe[],profile:{genres:string[];artists:string[];exploration:number}):Taste {
  const taste:Taste={artists:{},tracks:{},tags:{},negative:[],exploration:profile.exploration,rated:0};
  for(const g of profile.genres)bump(taste.tags,`genre:${g}`,1);
  for(const a of profile.artists)bump(taste.artists,a,1);
  const index=new Map(catalog.map(t=>[t.id,t]));
  for(const s of swipes) {
    const track=index.get(s.item_id); if(!track)continue;
    if(s.action!=='pass')taste.rated++;
    if(s.action==='dislike')taste.negative.push(track.id);
    const n=positive(s.action); if(!n)continue;
    bump(taste.tracks,track.id,n);bump(taste.artists,track.artist,n);
    for(const g of track.genres)bump(taste.tags,`genre:${g}`,n);
    bump(taste.tags,`decade:${track.decade}`,n);
  }
  return taste;
}
export function weightedJaccard(a:Record<string,number>,b:Record<string,number>) {
  let min=0,max=0;for(const k of new Set([...Object.keys(a),...Object.keys(b)])){min+=Math.min(a[k]??0,b[k]??0);max+=Math.max(a[k]??0,b[k]??0);}
  return max?min/max:0;
}
export function compatibility(a:Taste,b:Taste,completeness=1,activity=1) {
  const commonArtists=Object.keys(a.artists).filter(k=>b.artists[k]);
  const commonTracks=Object.keys(a.tracks).filter(k=>b.tracks[k]);
  const commonGenres=Object.keys(a.tags).filter(k=>k.startsWith('genre:')&&b.tags[k]).map(k=>k.slice(6));
  const conflicts=a.negative.filter(k=>b.tracks[k]).length+b.negative.filter(k=>a.tracks[k]).length;
  const denominator=Math.max(1,new Set([...Object.keys(a.tracks),...Object.keys(b.tracks)]).size);
  const components={artist:weightedJaccard(a.artists,b.artists),track:weightedJaccard(a.tracks,b.tracks),tags:weightedJaccard(a.tags,b.tags),exploration:1-Math.abs(a.exploration-b.exploration)};
  const music=Math.max(0,Math.min(100,100*(.4*components.artist+.3*components.track+.2*components.tags+.1*components.exploration)-Math.min(30,100*conflicts/denominator)));
  const rank=.7*music+15*Math.max(0,Math.min(1,completeness))+10*Math.max(0,Math.min(1,activity))+5*Math.min(a.exploration,b.exploration);
  return {version:ALGORITHM_VERSION,musicScore:Math.round(music),rankingScore:Math.round(rank),commonArtists,commonTracks:commonTracks.length,commonGenres,conflicts,
    reasons:[`${commonArtists.length} ortak sanatçı`,`${commonTracks.length} ortak şarkı`,...(commonGenres.length?[`Ortak türler: ${commonGenres.slice(0,3).join(', ')}`]:[])]};
}
export type PlaylistItem={trackId:string;reason:string;source:'a'|'b'|'discovery'|'shared'};
export function createPlaylist(catalog:Track[],a:Taste,b:Taste,allowExplicit:boolean,size=25):PlaylistItem[] {
  const negative=new Set([...a.negative,...b.negative]);
  const available=catalog.filter(t=>!negative.has(t.id)&&(allowExplicit||!t.explicit)).sort((x,y)=>x.id.localeCompare(y.id));
  const aPool=available.filter(t=>a.tracks[t.id]).sort((x,y)=>(a.tracks[y.id]??0)-(a.tracks[x.id]??0)||x.id.localeCompare(y.id));
  const bPool=available.filter(t=>b.tracks[t.id]).sort((x,y)=>(b.tracks[y.id]??0)-(b.tracks[x.id]??0)||x.id.localeCompare(y.id));
  const discovery=available.filter(t=>!a.tracks[t.id]&&!b.tracks[t.id]);
  const used=new Set<string>(); const result:PlaylistItem[]=[];let lastArtist='';
  function take(pool:Track[],source:'a'|'b'|'discovery') {
    const options=pool.filter(t=>!used.has(t.recording_id));
    const t=options.find(t=>t.artist!==lastArtist)??options[0]; if(!t)return false;
    used.add(t.recording_id);lastArtist=t.artist;
    const shared=!!a.tracks[t.id]&&!!b.tracks[t.id];
    result.push({trackId:t.id,source:shared?'shared':source,reason:shared?'İkinizin de beğendiği bir parça':source==='a'?'İlk katılımcının beğenilerinden':source==='b'?'İkinci katılımcının beğenilerinden':'İkiniz için yeni bir keşif'});
    return true;
  }
  // Each five slots aims for 40/40/20; overlap or a small catalog can change the final shares.
  const order=['a','b','a','b','discovery'] as const;
  for(let i=0;i<size;i++) {
    const s=order[i%5];const pool=s==='a'?aPool:s==='b'?bPool:discovery;
    if(!take(pool,s)&&!take(s==='a'?bPool:aPool,s==='a'?'b':'a')&&!take(discovery,'discovery')&&!take(bPool,'b'))break;
  }
  // Move repeated neighboring artists apart where the catalog offers an alternative.
  const tracks=new Map(catalog.map(t=>[t.id,t]));
  for(let i=1;i<result.length;i++)if(tracks.get(result[i].trackId)?.artist===tracks.get(result[i-1].trackId)?.artist){
    const j=result.findIndex((item,j)=>j>i&&tracks.get(item.trackId)?.artist!==tracks.get(result[i-1].trackId)?.artist);
    if(j>i)[result[i],result[j]]=[result[j],result[i]];
  }
  return result;
}
