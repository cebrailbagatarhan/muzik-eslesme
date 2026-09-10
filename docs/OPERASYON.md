# Ahenk operasyon rehberi

Bu rehber depodaki mevcut demo ve servis adaptörlerinin nasıl çalıştırılacağını açıklar. Sunucu, alan adı ve dış servis hesabı oluşturmaz. Üretim için kalan geliştirmeler [KAPSAM.md](KAPSAM.md) dosyasındadır.

## Yerel çalıştırma

Node.js 24 ile proje kökünde:

```bash
npm ci
npm run demo
```

Web adresi `http://127.0.0.1:8081`, API adresi `http://127.0.0.1:4000` olur. Ctrl+C iki sunucuyu da durdurur. Demo komutu yalnızca `APP_MODE=demo` ve boş `DATABASE_URL` ile çalışır. Mevcut `.env` dosyasını ve mevcut örnek hesapları korur.

ZIP hazır web çıktısı içerir. GitHub'dan indirilen kaynaklarda demo komutu bu çıktıyı ilk açılışta üretir. Kaynak kodu veya API adresi değiştiğinde web çıktısını yeniden oluşturmak gerekir:

```bash
npm run export:web -w @ahenk/mobile
```

Derleme öncesinde `apps/mobile/.env` dosyasında `EXPO_PUBLIC_API_URL=http://127.0.0.1:4000` değerini ayarla. Expo bu adresi web çıktısının içine yerleştirir; sonradan yalnızca API ayarını değiştirmek web çıktısını güncellemez. ZIP'teki hazır çıktı varsayılan 4000 portuna yönelir.

## Ortam ayarları

API ayarları `apps/api/.env` içindedir. Proje kökündeki `.env.example` başlangıç şablonudur; `npm run setup` bu şablondan dosyayı oluşturur. İstemci için `apps/mobile/.env.example` şablonunu kullan.

| Ayar | Mevcut davranış |
| --- | --- |
| `APP_MODE` | `demo` veya `beta`. Beta ek servis yapılandırmalarını zorunlu kılar. |
| `HOST`, `PORT` | API'nin dinlediği adres ve port; varsayılan `127.0.0.1:4000`. |
| `DATABASE_URL` | Boşsa PGlite; doluysa PostgreSQL bağlantı havuzu. |
| `PGLITE_DATA_DIR` | API çalışma dizinine göre yerel veri yolu; varsayılan `../../data/postgres`. |
| `REDIS_URL` | Ortak hız limiti sayaçları ve API işlemleri arasında yenileme olayları; betada zorunlu. |
| `ALLOWED_ORIGINS` | Virgülle ayrılmış tam web origin adresleri; boşluk ekleme. Beta değerleri `https://` ile başlamalıdır. |
| `DATA_ENCRYPTION_KEY` | 32 baytlık, 64 hex karakterli veri şifreleme anahtarı. Kurulum rastgele üretir. |
| `MEDIA_SIGNING_KEY` | Aynı biçimde, ayrı medya imza anahtarı. Kurulum rastgele üretir. |
| `MIN_MUSIC_RATINGS` | En az 20; geçilen kartlar bu sayıya dahil değildir. |
| `AGE_WEBHOOK_SECRET` | Yaş doğrulama imza anahtarı; betada en az 32 karakter. |
| `PHOTO_SCANNER_URL` | Temizlenmiş JPEG kabul eden denetim servisi; betada HTTPS gerekir. |
| `PHOTO_SCANNER_TOKEN` | Denetim servisine gönderilen bearer kimlik bilgisi; betada zorunlu. |
| `SPOTIFY_ENABLED` | Varsayılan `false`. Çekirdek eşleşme ve sohbet bundan bağımsızdır. |
| `SPOTIFY_CLIENT_ID` | Spotify uygulamasının istemci kimliği. |
| `SPOTIFY_REDIRECT_URI` | API'nin HTTPS callback adresi; `/v1/integrations/spotify/callback` ile biter. |
| `SPOTIFY_ALLOWED_USER_IDS` | Virgülle ayrılmış Ahenk kullanıcı UUID'leri; Spotify kullanıcı adları değildir. |
| `EXPO_PUBLIC_API_URL` | İstemci derlemesinin kullandığı API adresi; herkese açık kabul edilir, gizli anahtar içermez. |

Gerçek `.env`, veritabanı, oturum ve TOTP bilgileri dağıtım paketine dahil değildir. `DATA_ENCRYPTION_KEY` kaybolursa mevcut şifreli mesajlar, fotoğraflar, bağlantı tokenları ve TOTP sırları okunamaz. Bu sürüm otomatik anahtar rotasyonu veya eski anahtarla yeniden şifreleme sağlamaz; mevcut veritabanıyla birlikte anahtarı değiştirme.

## Dış PostgreSQL ve beta servisleri

Önce `npm ci` ve `npm run setup` çalıştır. Sonra API ayarlarına PostgreSQL ve Redis bağlantılarını, web origin adresini, yaş doğrulama ve fotoğraf tarama servislerini ekle; betaya geçilecekse `APP_MODE=beta` kullan. Demo veritabanını beta veritabanı olarak kullanma; örnek hesapların parolaları herkese açıktır.

```bash
npm run build
npm run start -w @ahenk/api
```

API ilk açılışta `apps/api/migrations` altındaki SQL dosyalarını sırayla uygular. PostgreSQL tarafında migration kilidi ve transaction kullanılır; sürümler `schema_migrations` tablosunda tutulur. Ayrı bir migration geri alma komutu yoktur. `npm run seed` beta modunda çalışmayı reddeder. Lisanslı katalog için veri modeli vardır, sağlayıcıdan katalog yükleyen üretim aracı henüz yoktur.

API bir HTTPS reverse proxy arkasında çalıştırılabilir. Proxy `/v1/events` için WebSocket yükseltmesini de iletmelidir. Bu sürüm `trustProxy:false` kullanır: IP hız limitleri proxy arkasında ortak IP üzerinde toplanabilir. Proxy güven zinciri ve istemci IP çözümlemesi dağıtım ortamında ayrıca yapılandırılmalıdır.

Web için API adresini `apps/mobile/.env` içinde ayarlayıp `npm run export:web -w @ahenk/mobile` çalıştır. Ortaya çıkan `apps/mobile/dist` statik çıktısını web sunucusu barındırır. `scripts/serve-web.mjs` yalnızca yerel demo sunucusudur. Depoda Docker, bulut dağıtımı, alan adı veya otomatik yayın yapılandırması bulunmaz.

## Yaş doğrulama servis sözleşmesi

Sağlayıcı `POST /v1/verification/age` adresine JSON gönderir:

```json
{
  "eventId": "saglayici-olay-000001",
  "userId": "00000000-0000-4000-8000-000000000001",
  "verified": true,
  "timestamp": 0
}
```

Örnekteki kullanıcı kimliği ve zaman yer tutucudur. Gerçek kullanıcı UUID'si ve Unix zamanı saniye cinsinden gönderilir. `eventId` 12–128 karakter arasında olmalıdır. `x-verification-signature` başlığı, `eventId.userId.verified.timestamp` metninin `AGE_WEBHOOK_SECRET` ile HMAC-SHA256 hex imzasıdır; `verified` metne `true` veya `false` olarak yazılır. Zaman toleransı 300 saniyedir. Olay kimliği tekrar işlenmez; doğrulama kaydı temizlik işlemiyle 7 günden sonra kaldırılır.

Bu uç nokta sağlayıcı adaptörüdür. Uygulamada gerçek bir sağlayıcının doğrulamasını başlatan yönlendirme/SDK ekranı henüz yoktur. Demo doğum tarihi beyanını kullanır; beta için hem sağlayıcı bağlantısı hem kullanıcı yolculuğu tamamlanmalıdır.

## Fotoğraf denetimi

İstemci JPEG veya PNG gönderir. API dosyayı çözüp yeniden JPEG oluşturur ve metadata'yı temizler. Yapılandırılmışsa tarayıcıya `Content-Type: image/jpeg` ve `Authorization: Bearer ...` ile dosyanın baytlarını gönderir. Servis başarılı HTTP yanıtıyla `{ "clean": true }` dönmelidir; yanıt süresi sınırı 15 saniyedir. Servis erişilemiyorsa fotoğraf kabul edilmez.

Otomatik denetimi geçen fotoğraf yine `pending` durumundadır. Moderatör onayından sonra diğer kullanıcılara açılır. İmzalı medya adresleri 120 saniye geçerlidir; ayrıca oturum ve güncel erişim izni gerekir. Fotoğraflar bu sürümde veritabanında şifreli tutulur.

## Moderatör hesabı

Normal bir kullanıcı hesabı oluştur, API'yi durdur ve proje kökünde çalıştır:

```bash
npm run moderator -- moderasyon@ornek.com
```

Komutun gösterdiği `otpauth://` adresini kendi kimlik doğrulayıcı uygulamana ekle. API'yi yeniden açıp yeniden giriş yap. Moderasyon sekmesinde 6 haneli TOTP kodu 10 dakikalık yetki verir. Komut mevcut moderatörün TOTP anahtarını değiştirmez.

Ekranda raporu kapatma, uyarma, içerik kaldırma, hesabı askıya alma ve fotoğraf onaylama/reddetme bulunur. Moderatör taraf olduğu raporu sonuçlandıramaz ve kendi fotoğrafını onaylayamaz. Süreli askı, otomatik yeniden açma, ayrı kalıcı kapatma kararı ve itiraz iş akışı henüz yoktur. Moderasyon ekibi ve destek iletişimi bu depo tarafından sağlanmaz.

## Spotify aktarımını işletme

Adaptörü açmadan önce gerçek istemci kimliği, HTTPS callback, Ahenk kullanıcı allowlist'i ve lisanslı katalog kayıtlarının `spotify_uri` eşlemeleri gerekir. Demo katalog bu eşlemeleri içermez. İstenen izin `playlist-modify-private` ile sınırlıdır. Sağlayıcı hesabındaki erişim ve uygulama ayarları ayrıca tamamlanır.

Aktarım API işleminin içindeki işçi tarafından yaklaşık iki saniyede bir ele alınır. Kullanıcı, playlist taslağı ve revizyon başına tek iş tutulur. Durumlar `queued`, `creating`, `filling`, `completed`, `failed` ve `uncertain` olabilir. 429 yanıtında belirtilen bekleme uygulanır. Liste oluşturmanın sonucu belirsizse `uncertain` iş otomatik yeniden oluşturulmaz. Spotify tarafındaki listeyi görmeden işi silip tekrar oluşturmak yinelenen listeye yol açabilir; bu sürümde manuel uzlaştırma paneli yoktur.

Bağlantıyı kesmek uygulamanın token, bağlantı ve aktarım kayıtlarını temizler. Spotify hesabında daha önce oluşturulmuş playlist'i silmez. Callback sonucu tarayıcıda gösterilir; otomatik mobil deep-link dönüşü bu sürümde yoktur.

## Kalıcı veriler ve yedekler

Yerel PGlite yedeği için önce API'yi durdur; `data/postgres` dizinini tutarlı biçimde kopyala. Şifreleme anahtarını da ayrı ve korumalı sakla. Kilit dosyası veri yedeği değildir. Dış PostgreSQL yedeklemesi seçilen servis tarafından yönetilmelidir; bu depo yedek alma/geri yükleme otomasyonu içermez.

API saatlik bakımında idempotency kayıtlarını 24 saatten, doğrulama olaylarını 7 günden ve kişi gösterimlerini 30 günden sonra temizler. Süresi dolan oturumlar ve WebSocket biletleri de temizlenir. Mesaj, rapor ve fotoğraflar için genel süreli saklama/imha işi henüz yoktur. Hesap silme canlı veritabanındaki ilişkili kayıtları temizler; daha önce alınmış yedekler otomatik silinmez.

## Sık karşılaşılan durumlar

| Belirti | Yapılacak işlem |
| --- | --- |
| `Önce proje klasöründe npm ci çalıştır` | Proje kökünde bağımlılıkları kur. |
| PGlite kullanım/kilit hatası | Aynı veritabanını açan API veya CLI işlemini durdur. Kilidi yalnızca artık hiçbir işlem çalışmadığı kesinse kaldır. |
| 4000 veya 8081 portu açılamıyor | O portu kullanan diğer uygulamayı kapat. API portunu değiştirirsen istemci adresini ve web çıktısını da güncelle. |
| Telefonda bağlantı kurulamıyor | Bilgisayarın LAN IP'sini istemci ayarına yaz, API `HOST` değerini `0.0.0.0` yap ve aynı ağı kullan. |
| Web sayfası yenilenince oturum kapanıyor | Web tokenları yalnızca bellektedir; tekrar giriş yap. |
| Müzik kartı veya aday görünmüyor | Katalog, en az 20 değerlendirme, şehir/yaş/amaç tercihleri ve beta yaş doğrulamasını kontrol et. |
| Fotoğraf görünmüyor | `pending` fotoğrafa moderatör onayı gerekir. |
| Moderasyon yetkisi sona eriyor | Yeni TOTP koduyla yetkili oturumu yenile. |
| Spotify düğmesi görünmüyor | Özellik bayrağını ve Ahenk kullanıcı UUID'sinin allowlist'te olduğunu kontrol et. |
| Spotify aktarımı tanımlı değil | Listedeki tüm parçalar lisanslı olmalı ve geçerli `spotify_uri` içermelidir. |

`GET /health` veritabanını ve varsa Redis'i kontrol eder. Loglarda `request.failed`, `spotify.worker_failed` ve `maintenance.failed` olayları bulunabilir. Merkezi hata izleme ve alarm servisi henüz bağlı değildir.
