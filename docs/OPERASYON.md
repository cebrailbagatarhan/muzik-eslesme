# Ahenk operasyon rehberi

Bu rehber depodaki demo, beta adaptörleri ve dağıtım temelinin nasıl çalıştırılacağını açıklar. Sunucu, alan adı veya dış servis hesabı oluşturmaz. Üretim için kalan işler [KAPSAM.md](KAPSAM.md) dosyasındadır.

## Yerel çalıştırma

Node.js 24 ile proje kökünde:

```bash
npm ci
npm run demo
```

Web adresi `http://127.0.0.1:8081`, API adresi `http://127.0.0.1:4000` olur. Demo komutu `APP_MODE=demo` ve boş `DATABASE_URL` ile gömülü PGlite kullanır.

Web çıktısını elle üretmek için:

```bash
EXPO_PUBLIC_API_URL=http://127.0.0.1:4000 npm run export:web -w @ahenk/mobile
```

Expo API adresini build içine gömer; API adresi değişirse web çıktısını yeniden oluştur.

## Ortam ayarları

API ayarları `apps/api/.env` içindedir. Kök `.env.example` başlangıç şablonudur; `npm run setup` şablondan yerel dosyayı oluşturur. Mobil istemci için `apps/mobile/.env.example` kullanılır.

| Ayar | Davranış |
| --- | --- |
| `APP_MODE` | `demo` veya `beta`. |
| `HOST`, `PORT` | API dinleme adresi ve portu. |
| `DATABASE_URL` | Boşsa PGlite, doluysa PostgreSQL. |
| `PGLITE_DATA_DIR` | Yerel veri dizini. |
| `REDIS_URL` | Ortak rate-limit sayaçları ve sunucular arası yenileme olayları; betada zorunlu. |
| `ALLOWED_ORIGINS` | İzin verilen web origin'leri; beta değerleri HTTPS olmalıdır. |
| `DATA_ENCRYPTION_KEY` | 32 bayt / 64 hex veri şifreleme anahtarı. |
| `MEDIA_SIGNING_KEY` | 32 bayt / 64 hex medya imza anahtarı. |
| `MIN_MUSIC_RATINGS` | En az 20. `pass` değerlendirme sayısına girmez. |
| `AGE_WEBHOOK_SECRET` | Yaş sağlayıcısı HMAC anahtarı; betada en az 32 karakter. |
| `PHOTO_SCANNER_URL` | Temizlenmiş JPEG alan tarama servisi; betada HTTPS. |
| `PHOTO_SCANNER_TOKEN` | Fotoğraf tarayıcısı bearer tokenı. |
| `AUTH_DELIVERY_URL` | E-posta doğrulama / parola reset teslim webhooku; betada HTTPS. |
| `AUTH_DELIVERY_TOKEN` | Teslim webhooku bearer tokenı. |
| `SPOTIFY_ENABLED` | Varsayılan `false`. |
| `SPOTIFY_CLIENT_ID` | Spotify istemci kimliği. |
| `SPOTIFY_REDIRECT_URI` | HTTPS callback; `/v1/integrations/spotify/callback` ile biter. |
| `SPOTIFY_ALLOWED_USER_IDS` | Spotify özelliği açılacak Ahenk kullanıcı UUID'leri. |
| `EXPO_PUBLIC_API_URL` | İstemcinin gömülü API adresi; gizli bilgi değildir. |

Gerçek `.env`, oturum tokenları ve TOTP sırları depoya eklenmez. `DATA_ENCRYPTION_KEY` kaybolursa şifreli mesaj, fotoğraf, bağlantı tokenı ve TOTP sırları okunamaz. Bu sürüm otomatik anahtar rotasyonu yapmaz.

## Beta altyapısı

`APP_MODE=beta` için PostgreSQL, Redis, HTTPS origin, yaş webhook anahtarı, fotoğraf tarayıcısı ve kimlik e-postası teslim webhooku zorunludur. Demo veritabanını beta ortamında kullanma; örnek hesap parolaları herkese açıktır.

```bash
npm ci
npm run build
npm run start -w @ahenk/api
```

API açılışta `apps/api/migrations` altındaki migration'ları sırasıyla uygular. PostgreSQL tarafında advisory lock ve transaction kullanılır. `npm run seed` beta modunda çalışmaz.

API reverse proxy arkasında çalışabilir; `/v1/events` için WebSocket upgrade iletilmelidir. `trustProxy:false` olduğu için proxy arkasında gerçek istemci IP çözümlemesi dağıtım ortamında ayrıca ele alınmalıdır.

## Docker

API için çok aşamalı image vardır:

```bash
docker build -t ahenk-api .
```

Builder katmanı geliştirme bağımlılıklarıyla TypeScript'i derler. Runtime katmanı `npm ci --omit=dev` ile yalnızca production bağımlılıklarını, derlenmiş `dist` çıktısını ve SQL migration'larını içerir.

Container'ı çalıştırırken gerekli ortam değişkenlerini ayrıca geçir:

```bash
docker run --rm -p 4000:4000 --env-file apps/api/.env ahenk-api
```

`GET /health` veritabanını ve varsa Redis'i kontrol eder.

## CI

GitHub Actions her PR ve `main` push'unda şunları çalıştırır:

1. `npm ci`
2. `npm run check` — workspace typecheck, API testleri ve API build
3. Expo web export
4. API Docker image build

Bu nedenle Docker veya web export kırıkları da PR aşamasında görünür.

## Yaş doğrulama servis sözleşmesi

Beta sağlayıcısı `POST /v1/verification/age` adresine şu yapıda JSON gönderir:

```json
{
  "eventId": "saglayici-olay-000001",
  "userId": "00000000-0000-4000-8000-000000000001",
  "verified": true,
  "birthDate": "1998-06-15",
  "timestamp": 0
}
```

`verified:true` için `birthDate` zorunludur. Başarılı doğrulamada sağlayıcının imzaladığı doğum tarihi, kullanıcının kayıt sırasında beyan ettiği tarihin yerine yazılır; yaş ve yaş filtreleri bu doğrulanmış değerden hesaplanır.

İmza metni:

```text
eventId.userId.verified.birthDate.timestamp
```

Bu metin `AGE_WEBHOOK_SECRET` ile HMAC-SHA256 hex olarak imzalanır ve `x-verification-signature` başlığına yazılır. `verified:false` sonucunda `birthDate` gönderilmeyebilir; bu durumda imza metninde ilgili alan boş kalır. Zaman toleransı 300 saniyedir ve `eventId` tekrar işlenmez.

Olumsuz doğrulama `age_verified=false` yapar, aktif eşleşmeleri kapatır ve mevcut oturumları sonlandırır. Demo modu eski test payload'ını geriye dönük uyumluluk için kabul eder; beta kabul etmez.

## Fotoğraf denetimi ve rapor kanıtı

İstemci JPEG veya PNG gönderir. API görüntüyü decode edip yeniden JPEG'e çevirir; EXIF/konum metadata'sı ve trailing payload temizlenir. Yapılandırılmış fotoğraf tarayıcısına `Content-Type: image/jpeg` ve bearer token ile gönderilir. Servis `{ "clean": true }` dönmelidir.

Otomatik denetimi geçen fotoğraf yine `pending` kalır; moderatör onayından sonra diğer kullanıcılara açılır. Normal medya bağlantıları 120 saniye geçerlidir ve her erişimde oturum/izin tekrar kontrol edilir.

Bir kullanıcı onaylı fotoğrafı şikâyet ettiğinde fotoğrafın o andaki yeniden kodlanmış JPEG içeriği raporun şifreli evidence alanına snapshot olarak alınır. Kullanıcı daha sonra fotoğrafı silse veya moderatör orijinali reddetse bile vaka kanıtı kaybolmaz.

## Moderasyon ve itiraz

Normal bir kullanıcı hesabı oluştur, API'yi durdur ve:

```bash
npm run moderator -- moderasyon@ornek.com
```

çıktısındaki `otpauth://` URI'yi kendi authenticator uygulamana ekle. API'yi tekrar açıp giriş yap. Moderasyon ekranı 6 haneli TOTP ile 10 dakikalık yetkili oturum açar.

Moderatör raporu uyarı, içerik kaldırma, süreli askı veya işlemsiz kapatma ile sonuçlandırabilir. Kendi taraf olduğu raporu veya kendi fotoğrafını sonuçlandıramaz. `warn` kararı hedef kullanıcıya uygulama içinde görünür.

Askılar 1–90 gün süreli olabilir. Hesap askıdayken kullanıcı e-posta/parolasıyla itiraz gönderebilir. Her somut `suspend` moderasyon aksiyonu için yalnızca tek itiraz kaydı tutulur; reddedilen aynı askı için yeni kayıt açılamaz. Kabul edilen itiraz hesabı erken açar. Süre dolmuş askı bir sonraki girişte otomatik açılır.

Kalıcı ban kararı, vardiya/destek operasyonu ve SLA otomasyonu hâlâ yoktur.

## Rıza ve hesap verisi

`product-analytics` ve `research-contact` opsiyonel rızaları zorunlu hizmet şartlarından ayrıdır ve ayrı ayrı geri alınabilir. Doküman sürümünü mobil istemci belirlemez; API kendi sabit sürümünü kaydeder. Eski istemcilerin gönderdiği `version` alanı geriye dönük uyumluluk için yok sayılır.

`GET /v1/account/export` profil, müzik swipe'ları, kişi swipe'ları, eşleşmeler, gönderilen mesajlar, bloklar, raporlar, fotoğraf metadata'sı, rızalar, playlist taslakları, itirazlar, moderasyon bildirimleri, Spotify bağlantı metadata'sı/aktarım geçmişi ve kullanıcı audit olaylarını dışa aktarır. Parola hash'i, access/refresh tokenları, Spotify OAuth tokenları ve TOTP sırrı export edilmez.

## Spotify aktarımı

Spotify çekirdek eşleşme için kullanılmaz. Adaptör yalnızca allowlist'teki kullanıcılara açılır ve `playlist-modify-private` scope'u ister. Lisanslı katalog kayıtlarında gerçek `spotify_uri` eşlemeleri olmadan aktarım yapılamaz.

Kuyruk durumları `queued`, `creating`, `filling`, `completed`, `failed`, `uncertain` olabilir. 429 yanıtında `Retry-After` uygulanır. Liste oluşturma yanıtının sonucu belirsizse iş `uncertain` olur ve otomatik ikinci playlist oluşturulmaz.

## Bakım ve saklama

Saatlik bakım şu kayıtları temizler:

- idempotency kayıtları: 24 saat
- süresi geçmiş WebSocket ticket'ları
- eski OAuth state kayıtları
- süresi dolmuş session kayıtları
- süresi geçmiş auth action tokenları ve eski kullanılmış tokenlar
- verification event kayıtları: 7 gün
- feed impression kayıtları: 30 gün

Mesaj, rapor ve fotoğraflar için genel süreli retention/imha politikası hâlâ yoktur. Hesap silme canlı veritabanındaki ilişkili kayıtları temizler; yedeklerden otomatik silme sağlayıcı/işletim katmanında çözülmelidir.

## Sık karşılaşılan durumlar

| Belirti | Yapılacak işlem |
| --- | --- |
| `Önce proje klasöründe npm ci çalıştır` | Proje kökünde bağımlılıkları kur. |
| PGlite kullanım/kilit hatası | Aynı veritabanını açan API/CLI işlemini durdur. |
| 4000 veya 8081 portu açılamıyor | Portu kullanan süreci kapat veya istemci/API ayarlarını birlikte değiştir. |
| Telefonda API'ye ulaşılamıyor | Bilgisayarın LAN IP'sini `EXPO_PUBLIC_API_URL` için kullan ve API `HOST=0.0.0.0` yap. |
| Web yenilenince oturum kapanıyor | Web tokenları bellektedir; tekrar giriş yap. |
| Aday görünmüyor | En az 20 değerlendirme, şehir/yaş/amaç filtreleri ve beta yaş doğrulamasını kontrol et. |
| Fotoğraf görünmüyor | `pending` fotoğrafa moderatör onayı gerekir. |
| Moderasyon yetkisi sona erdi | Yeni TOTP koduyla yetkili oturumu yenile. |
| Spotify düğmesi yok | Özellik bayrağını ve Ahenk kullanıcı UUID allowlist'ini kontrol et. |
| Spotify export yok | Tüm parçalar lisanslı ve geçerli `spotify_uri` ile eşlenmiş olmalı. |

Loglarda `request.failed`, `spotify.worker_failed` ve `maintenance.failed` olayları bulunabilir. Merkezi hata izleme ve alarm servisi henüz bağlı değildir.
