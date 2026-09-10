# Teslim kapsamı ve kalan işler

Teslim, yüklenen fizibilite rehberindeki bağımsız müzik eşleşme çekirdeğinin yerel demo ve geliştirme başlangıcıdır. Rehberin tüm üretim yol haritasının tamamlandığı anlamına gelmez. Aşağıdaki ayrım hangi dosyaların teslim edildiğini ve hangi ürün işlerinin henüz yapılmadığını gösterir.

## Depoda bulunanlar

| Alan | Teslim edilen uygulama |
| --- | --- |
| Hesap | E-posta/parola üyeliği, e-posta doğrulama, parola sıfırlama/değiştirme, doğum tarihi kapısı, süreli oturum, refresh token rotasyonu ve hesap silme. |
| Profil | Şehir, biyografi, yaş aralığı, arkadaşlık/tanışma amacı, müzik seçimleri, fotoğraf yükleme. |
| Müzik | 72 kurmaca katalog kaydı, beğeni/olumsuz/favori/geç/geri alma, en az 20 değerlendirme. |
| Eşleştirme | Karşılıklı filtreler, açıklanabilir puan, kişi beğenisi, tekil karşılıklı eşleşme. |
| Sohbet | Eşleşmeye özel mesajlar, okundu bilgisi, silme, WebSocket yenileme olayları. |
| Instagram | Eşleşme başına karşılıklı paylaşım, geri alma, hesap değişiminde ve engellemede izinlerin kapanması. |
| Playlist | Ortak taslak, olumsuz tercihleri dışlama, gerekçeler, parça çıkarma ve sıralama. |
| Güvenlik | Engelleme, raporlama, moderatör rolü, TOTP, süreli askı, itiraz, fotoğraf incelemesi, şifreli kanıt ve audit kayıtları. |
| Gizlilik | Veri dışa aktarma, hesap silme ve zorunlu şartlardan ayrı geri alınabilir opsiyonel rıza kontrolleri. |
| Veri altyapısı | Kalıcı yerel PGlite, dış PostgreSQL bağlantısı, SQL migration'ları ve isteğe bağlı Redis. |
| Dağıtım temeli | API Dockerfile, healthcheck ve GitHub Actions üzerinde typecheck/test/build CI akışı. |
| İstemci | Türkçe Expo / React Native ekranları ve web çıktısı; moderasyon aynı uygulamada. |
| Kurulum | Kilitli npm bağımlılık listesi, ortam şablonları, kurulum/demo komutları ve operasyon rehberi. |

## Adaptörü var; dış servis veya ek kullanıcı akışı gerekiyor

| Alan | Kalan iş |
| --- | --- |
| Yaş doğrulama | İmzalı webhook mevcut. Gerçek sağlayıcı, doğrulamayı başlatan ekran ve sonuç dönüşü henüz bağlı değil. |
| E-posta teslimi | Doğrulama ve parola sıfırlama token akışı ile provider-neutral HTTPS teslim webhooku hazır. Gerçek e-posta sağlayıcısı bağlanmalı. |
| Fotoğraf tarama | HTTP tarama sözleşmesi mevcut. Gerçek zararlı dosya/içerik denetim servisi bağlanmalı. |
| Spotify | PKCE, şifreli token ve aktarım kuyruğu mevcut. Gerçek uygulama hesabı, erişim ayarları, allowlist ve parça URI eşlemeleri gerekli. |
| Beta altyapısı | PostgreSQL/Redis ayarları ve API container'ı mevcut. Çalışan bulut servisleri, HTTPS proxy/alan adı, izleme ve yedekleme sağlanmadı. |

## Henüz geliştirilmemiş üretim işleri

1. **Lisanslı katalog:** Gerçek parça, sanatçı, kapak ve varsa önizleme kaynağı; sağlayıcıdan veri yükleme ve hak metadata'sını güncelleme aracı. Demo ses kaydı oynatmaz.
2. **Hesap yaşam döngüsü:** Apple/Google oturumu ve moderatör MFA kurtarma akışları. E-posta doğrulama ve parola kurtarma/değiştirme artık mevcuttur.
3. **Gizlilik arayüzü:** İşletmeye ait gerçek aydınlatma/şart metinleri ve bunların sürüm yönetimi. Opsiyonel geri alınabilir rıza kontrolleri mevcuttur.
4. **Moderasyon operasyonu:** Kalıcı kapatma kararı, vardiya/destek kanalı, rapor SLA'ları ve ileri spam/kötüye kullanım denetimi. Süreli askı ve itiraz akışları mevcuttur.
5. **Medya ve bildirim:** Özel obje depolama adaptörü, cihaz push bildirimleri ve arka planda mesaj bildirimi.
6. **Dağıtım:** Alan adı, HTTPS proxy ayarı, süreç yönetimi, merkezi izleme ve alarm, yedekleme/geri yükleme otomasyonu. API Dockerfile ve CI mevcuttur.
7. **Veri yönetimi:** KMS/zarf şifreleme, anahtar rotasyonu, genel saklama/imha zamanlayıcısı ve yedeklerde silme politikasının uygulanması.
8. **Mobil yayın:** Gerçek cihaz derlemeleri, uygulama kimlikleri, ikon/açılış görselleri, OAuth deep link dönüşü, mağaza kayıt ve yayın dosyaları.
9. **Ürün kapsamı:** Ayrı Next.js yönetim paneli, mesafe tabanlı öneri ve ayrıntılı eşleşme tercihleri. Mevcut filtreler şehir, yaş ve tanışma amacıyla sınırlıdır.
10. **İşletim araçları:** Lisanslı katalog yönetimi, belirsiz Spotify aktarımını uzlaştırma paneli, ürün analitiği ve bekleme listesi.

Bu işler eksik yüklenmiş dosyalar değildir; bu başlangıç sürümünde henüz uygulanmamış özellikler ve işletim hazırlıklarıdır. Dış servis anahtarları kaynak depoya yazılmaz.

## Teslim ve doğrulama durumu

İlk teslimde 26 otomatik test geçmiş ve Expo web çıktısı oluşturulmuştur. Bu geliştirme dalında hesap yaşam döngüsü, rıza ve moderasyon itiraz senaryoları için ek testler ile GitHub Actions CI eklenmiştir. Spotify senaryoları sahte servis yanıtlarıyla çalıştırılmıştır; gerçek Spotify hesabında aktarım, ayrı PostgreSQL sunucusu, fiziksel iOS/Android cihazı ve bulut dağıtımı hâlâ ayrıca doğrulanmalıdır.

GitHub kaynak dosyalarını içerir. `node_modules`, çalışma verileri ve gerçek `.env` dosyaları kuruluma ait olup depoya dahil edilmez.
