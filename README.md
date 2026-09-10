# Ahenk — Müzik Eşleşme Uygulaması

Eklenen fizibilite rehberine göre hazırlanan çalıştırılabilir başlangıç sürümü. Türkçe Expo / React Native istemcisi, TypeScript / Fastify API, PostgreSQL veri modeli ve moderasyon ekranı içerir. Müzik zevki yalnızca uygulama içindeki açık seçimlerden hesaplanır.

Ayrıntılı ayarlar, servis bağlantıları ve sorun giderme için [Operasyon rehberi](docs/OPERASYON.md); teslim edilenlerle henüz geliştirilmeyen işlerin ayrımı için [Teslim kapsamı](docs/KAPSAM.md).

## Hızlı kurulum

Bilgisayarında **Node.js 24** kurulu olmalı. ZIP'i açıp `muzik-eslesme` klasöründe terminal aç:

```bash
npm ci
npm run demo
```

Tarayıcıda **http://127.0.0.1:8081** adresini aç. API, 4000 portunda çalışır. Durdurmak için terminalde Ctrl+C kullan.

Demo komutu yerel ayar ve şifreleme anahtarlarını oluşturur, örnek verileri ekler ve uygulamayı başlatır. Docker gerekmez; PostgreSQL'in gömülü PGlite sürümü kullanılır. Yerel veriler `data/postgres` altında kalır. `apps/api/.env` ve `data/` depoya eklenmez.

GitHub deposu tüm kaynakları içerir. GitHub'dan indirilen kaynaklarda ilk `npm run demo` web çıktısını da oluşturur.

Örnek hesaplar: `ada@demo.local`, `deniz@demo.local`, `ege@demo.local`, `lalin@demo.local`, `mert@demo.local`. Ortak demo parolası: **AhenkDemo!2026**. Giriş ekranındaki örnek hesap düğmelerini de kullanabilirsin. Ada ve Deniz arasında deneme eşleşmesi hazırdır.

## Özellikler

- E-posta / parola ile üyelik, e-posta doğrulama, parola sıfırlama/değiştirme, 18+ kapısı, süreli oturum ve refresh token rotasyonu.
- Profil, şehir, karşılıklı yaş ve tanışma tercihleri; profil fotoğrafı yükleme ve moderatör onayı.
- Müzik kartlarında beğenme, beğenmeme, favori, geçme ve geri alma; en az 20 değerlendirme.
- Açıklanabilir, sürümlenmiş müzik puanı ve karşılıklı beğeniyle tekil eşleşme.
- Eşleşmeye özel sohbet, okundu bilgisi, mesaj silme, WebSocket yenileme olayları.
- Eşleşme başına karşılıklı Instagram paylaşımı; geri alma, hesap değişimi ve engellemede görünürlüğü kapatma.
- Olumsuz tercihleri dışlayan ortak playlist; sıralama ve parça çıkarma.
- Engelleme, şikâyet, şifreli kanıt saklama, TOTP korumalı moderasyon, süreli askı ve tekil itiraz akışı.
- Sunucu kontrollü, ayrı ayrı geri alınabilir isteğe bağlı rızalar.
- Genişletilmiş veri dışa aktarma, yeniden parola doğrulamasıyla hesap silme ve ilişkili kayıtların temizlenmesi.
- Varsayılan olarak kapalı Spotify PKCE bağlantısı ve kullanıcı başlatmalı aktarım kuyruğu.
- API için çok aşamalı Docker imajı ve GitHub Actions üzerinde typecheck, test, Expo web export ve Docker build doğrulaması.

## Geliştirme

```bash
npm run setup
npm run seed
npm run dev
# İkinci terminalde:
npm run web
# Expo mobil geliştirme sunucusu için:
npm run mobile
```

Fiziksel telefonda `apps/mobile/.env.example` dosyasını `.env` olarak kopyala; `EXPO_PUBLIC_API_URL` değerini bilgisayarının yerel ağ IP adresi ve 4000 portuyla ayarla. API `HOST` değerini yerel ağdan erişim için `0.0.0.0` yap. Aynı ağda olmalısın. Gerçek iOS/Android cihaz derlemeleri bu teslimde doğrulanmadı.

Yerel PGlite aynı anda tek işlem tarafından açılabilir. `seed` veya `moderator` komutlarından önce API'yi durdur. Beklenmedik kapanışta kalan `data/postgres.lock` dosyasını yalnızca başka API işlemi çalışmadığını doğruladıktan sonra kaldır.

## Moderatör kurulumu

Önce normal bir hesap oluştur. API'yi durdurup şu komutu çalıştır:

```bash
npm run moderator -- moderasyon@ornek.com
```

Komutun verdiği TOTP anahtarını kimlik doğrulayıcı uygulamana ekle; paylaşma veya depoya kaydetme. API'yi tekrar açıp yeniden giriş yap. Moderasyon sekmesinde 6 haneli kodla 10 dakikalık yetkili oturum açılır. Kendi fotoğrafını veya taraf olduğun raporu onaylayamazsın. Uyarılar hedef kullanıcıya uygulama içinde gösterilir; askı kararları süreli olabilir ve her somut askı kararı için tek itiraz kaydı tutulur.

## PostgreSQL ve dış servisler

API'nin `.env` dosyasında `DATABASE_URL` verilirse `pg` bağlantı havuzu kullanılır. Migration dosyaları sürüm tablosuyla sırayla uygulanır. `REDIS_URL` verilirse hız limitleri ve sunucular arası yenileme olayları Redis üzerinden çalışır. `APP_MODE=beta`, PostgreSQL, Redis, HTTPS origin, yaş doğrulama webhook anahtarı, fotoğraf tarayıcısı ve kimlik e-postası teslim webhooku yapılandırmasını zorunlu kılar.

Beta yaş sağlayıcısı `POST /v1/verification/age` adresine `eventId`, `userId`, `verified`, `birthDate`, `timestamp` alanlarını gönderir. Başarılı (`verified:true`) sonuçta `birthDate` zorunludur ve sağlayıcının doğruladığı değer kullanıcının kayıt sırasında beyan ettiği doğum tarihinin yerini alır. `x-verification-signature`, `eventId.userId.verified.birthDate.timestamp` metninin `AGE_WEBHOOK_SECRET` ile HMAC-SHA256 hex imzasıdır. Olumsuz sonuçta `birthDate` boş bırakılabilir; imza metninde iki nokta arasındaki alan boş kalır. İstek 5 dakika içinde olmalı; olay kimliği tekrar işlenmez. Olumsuz doğrulama aktif eşleşmeleri kapatır ve mevcut oturumları sonlandırır.

Fotoğraf tarayıcısı, `PHOTO_SCANNER_URL` adresine gönderilen temizlenmiş JPEG için `{ "clean": true }` döndürmelidir; bearer kimliği `PHOTO_SCANNER_TOKEN` ayarıdır. Şikâyet edilen fotoğraflar, orijinal sonradan silinse bile moderasyon incelemesi için şikâyet anındaki şifreli snapshot ile saklanır.

Spotify için `SPOTIFY_ENABLED`, `SPOTIFY_CLIENT_ID`, HTTPS `SPOTIFY_REDIRECT_URI` ve `SPOTIFY_ALLOWED_USER_IDS` ayarlanır. Callback yolu `/v1/integrations/spotify/callback` olmalıdır. Yalnızca `playlist-modify-private` izni istenir. Lisanslı katalog kayıtlarının gerçek `spotify_uri` eşlemeleri gerekir. Aktarım kuyruğu 429 yanıtında Retry-After değerine uyar. Liste oluşturma yanıtı kaybolursa iş `uncertain` kalır; ikinci liste otomatik oluşturulmaz. Böyle bir iş Spotify'dan kontrol edilmeden yeniden başlatılmamalıdır.

## Docker

API imajını proje kökünde oluşturabilirsin:

```bash
docker build -t ahenk-api .
```

İmaj çok aşamalıdır: TypeScript derlemesi geliştirme bağımlılıklarının bulunduğu builder aşamasında yapılır; runtime katmanı yalnızca production bağımlılıklarını, derlenmiş API'yi ve migration dosyalarını içerir. Çalıştırırken gerçek ortam değişkenlerini ayrıca sağlamalısın.

## Teslim kapsamı

Bu paket **yerel demo ve geliştirme başlangıcıdır**. 72 müzik kaydı ve örnek profiller kurmacadır; ses kaydı, kapak lisansı veya gerçek kullanıcı içermez. Gerçek Spotify hesabıyla canlı aktarım yapılmadı. Demo yaş kapısı doğum tarihi beyanıdır; gerçek yaş/kimlik sağlayıcısı değildir.

Halka açık kullanım için lisanslı katalog, gerçek yaş doğrulama sağlayıcısı, gerçek e-posta teslim servisi, işletmeye ait gizlilik/şart metinleri, fotoğraf tarama sağlayıcısı, moderasyon operasyonu, izleme, yedekleme ve dağıtım ortamı tamamlanmalıdır. Fotoğraflar bu sürümde PostgreSQL'de şifreli tutulur; özel obje depolama adaptörü, push bildirimleri, ayrı Next.js yönetim paneli ve mağaza yayını dahil değildir. Moderasyon ekranı aynı Expo uygulamasının içindedir. Mesaj şifrelemesi sunucuda AES-GCM'dir, uçtan uca şifreleme değildir. Hesap silme canlı veritabanını temizler; işletim yedeklerinin imhası dağıtım sorumlusuna aittir.

GitHub Actions her PR ve `main` push'unda bağımlılık kurulumunu, TypeScript kontrolünü, otomatik API testlerini, API build'ini, Expo web export'unu ve Docker image build'ini doğrular.

## Proje yapısı

```text
apps/api/src/          API, yetkilendirme, müzik motoru, servis adaptörleri
apps/api/migrations/   PostgreSQL migration dosyaları
apps/api/test/         İşlev ve güvenlik testleri
apps/mobile/src/       Türkçe Expo ekranları
scripts/               Kurulum, demo başlatma ve web sunucusu
docs/                  Operasyon rehberi ve teslim kapsamı
```

API yazma işlemleri `Idempotency-Key` başlığını kullanır. Kimlik doğrulama ve hesap silme işlemleri kendi oturum kurallarıyla korunur. Günlük kişi gösterimi 100, kişi geçme bekleme süresi 7 gündür. İstek tekrar kayıtları 24 saat saklanır. Süresi dolmuş doğrulama/parola sıfırlama tokenları bakım işiyle temizlenir. Hassas içerik API loglarına yazılmaz.
