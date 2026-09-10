import type { Query } from './db.js';
import type { Track } from './engine.js';
// Fictional metadata only. There are no recordings, covers, previews or Spotify-derived data.
const artists=['Kıyı Çizgisi','Gece Atlası','Mor Dalga','Kent Işıkları','Uzak Bahçe','Bakır Rota','Yarım Ay','Sakin Akıntı','Yeni Yankı','Kuzey Rüzgârı','Sokak Ritmi','Açık Pencere'];
const genres=['Alternatif','Elektronik','Indie','Caz','Rock','Pop'];
const titles=['Gün Doğarken','Son Tramvay','Küçük Bir Oda','Uzakta Bir Yer','Yolun Başında','Gece Yürüyüşü'];
export const DEMO_CATALOG:Track[]=Array.from({length:72},(_,i)=>({
  id:`00000000-0000-4000-8000-${(i+1).toString().padStart(12,'0')}`,
  recording_id:`fictional-recording-${i+1}`,title:`${titles[Math.floor(i/12)]} ${i%12+1}`,artist:artists[i%12],
  genres:[genres[i%6]],decade:['1990','2000','2010','2020'][i%4],explicit:i%17===0,rights_status:'demo',source:'fictional-demo',
}));
export async function seedCatalog(q:Query) {
  for(const t of DEMO_CATALOG)await q.query(`INSERT INTO music_catalog_items(id,recording_id,title,artist,genres,decade,explicit,rights_status,source)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO NOTHING`,[t.id,t.recording_id,t.title,t.artist,JSON.stringify(t.genres),t.decade,t.explicit,t.rights_status,t.source]);
}
