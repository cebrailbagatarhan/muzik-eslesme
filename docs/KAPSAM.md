# Teslim kapsamı ve kalan işler

Teslim, yüklenen fizibilite rehberindeki bağımsız müzik eşleşme çekirdeğinin yerel demo ve geliştirme başlangıcıdır. Rehberin tüm üretim yol haritasının tamamlandığı anlamına gelmez. Aşağıdaki ayrım hangi dosyaların teslim edildiğini ve hangi ürün işlerinin henüz yapılmadığını gösterir.

## Depoda bulunanlar

| Alan | Teslim edilen uygulama |
| --- | --- |
| Hesap | E-posta/parola üyeliği, doğum tarihi kapısı, süreli oturum, refresh token rotasyonu ve hesap silme. |
| Profil | Şehir, biyografi, yaş aralığı, arkadaşlık/tanışma amacı, müzik seçimleri, fotoğraf yükleme. |
| Müzik | 72 kurmaca katalog kaydı, beğeni/olumsuz/favori/geç/geri alma, en az 20 değerlendirme. |
| Eşleştirme | Karşılıklı filtreler, açıklanabilir puan, kişi beğenisi, tekil karşılıklı eşleşme. |
| Sohbet | Eşleşmeye özel mesajlar, okundu bilgisi, silme, WebSocket yenileme olayları. |
| Instagram | Eşleşme başına karşılıklı paylaşım, geri alma, hesap değişiminde ve engellemede izinlerin kapanması. |
| Playlist | Ortak taslak, olumsuz tercihleri dışlama, gerekçeler, parça çıkarma ve sıralama. |
| Güvenlik | Engelleme, raporlama, moderatör rolü, TOTP, fotoğraf incelemesi, şifreli kanıt ve audit kayıtları. |
| Veri altyapısı | Kalıcı yerel PGlite, dış PostgreSQL bağlantısı, SQL migration'ları ve isteğe bağlı Redis. |
| İstemci | Türkçe Expo / React Native ekranları ve web çıktısı; moderasyon aynı uygulamada. |
| Kurulum | Kilitli npm bağımlılık listesi, ortam şablonları, kurulum/demo komutları ve operasyon rehberi. |

## Adaptörü var; dış servis veya ek kullanıcı akışı gerekiyor

| Alan | Kalan iş |
| --- | --- |
| Yaş doğrulama | İmzalı webhook mevcut. Gerçek sağlayıcı, doğrulamayı başlatan ekran ve sonuç dönüşü henüz bağlı değil. |
| Fotoğraf tarama | HTTP tarama sözleşmesi mevcut. Gerçek zararlı dosya/içerik denetim servisi bağlanmalı. |
| Spotify | PKCE, şifreli token ve aktarım kuyruğu mevcut. Gerçek uygulama hesabı, erişim ayarları, allowlist ve parça URI eşlemeleri gerekli. |
| Beta altyapısı | PostgreSQL/Redis ayarları mevcut. Çalışan bulut servisleri, HTTPS ve dağıtım ortamı sağlanmadı. |

## Henüz geliştirilmemiş üretim işleri

1. **Lisanslı katalog:** Gerçek parça, sanatçı, kapak ve varsa önizleme kaynağı; sağlayıcıdan veri yükleme ve hak metadata'sını güncelleme aracı. Demo ses kaydı oynatmaz.
2. **Hesap yaşam döngüsü:** E-posta doğrulama, parola kurtarma/değiştirme, Apple/Google oturumu ve moderatör MFA kurtarma akışları.
3. **Gizlilik arayüzü:** İşletmeye ait metinler, ayrıntılı ve ayrı geri alınabilir rıza yönetimi; demo metin/sürüm değerlerinin işletmenin gerçek belgelerine bağlanması.
4. **Moderasyon operasyonu:** Süreli askı ve itiraz akışları, ayrı kalıcı kapatma kararı, vardiya/destek kanalı, rapor SLA'ları ve ileri spam/kötüye kullanım denetimi.
5. **Medya ve bildirim:** Özel obje depolama adaptörü, cihaz push bildirimleri ve arka planda mesaj bildirimi.
6. **Dağıtım:** Docker veya bulut kurulum dosyaları, alan adı, HTTPS proxy ayarı, süreç yönetimi, merkezi izleme ve alarm, yedekleme/geri yükleme otomasyonu.
7. **Veri yönetimi:** KMS/zarf şifreleme, anahtar rotasyonu, genel saklama/imha zamanlayıcısı ve yedeklerde silme politikasının uygulanması.
8. **Mobil yayın:** Gerçek cihaz derlemeleri, uygulama kimlikleri, ikon/açılış görselleri, OAuth deep link dönüşü, mağaza kayıt ve yayın dosyaları.
9. **Ürün kapsamı:** Ayrı Next.js yönetim paneli, mesafe tabanlı öneri ve ayrıntılı eşleşme tercihleri. Mevcut filtreler şehir, yaş ve tanışma amacıyla sınırlıdır.
10. **İşletim araçları:** Lisanslı katalog yönetimi, belirsiz Spotify aktarımını uzlaştırma paneli, ürün analitiği ve bekleme listesi.

Bu işler eksik yüklenmiş dosyalar değildir; bu başlangıç sürümünde henüz uygulanmamış özellikler ve işletim hazırlıklarıdır. Dış servis anahtarları kaynak depoya yazılmaz.

## Teslim ve doğrulama durumu

İlk teslimde 26 otomatik test geçmiş ve Expo web çıktısı oluşturulmuştur. Spotify senaryoları sahte servis yanıtlarıyla çalıştırılmıştır; gerçek Spotify hesabında aktarım, ayrı PostgreSQL sunucusu, fiziksel iOS/Android cihazı ve bulut dağıtımı doğrulanmamıştır. Tarayıcıda görsel inceleme tamamlanmamıştır.

Son ekleme yalnızca eksik operasyon rehberini, bu kapsam dosyasını ve README/şablon açıklamalarını tamamlar. Kullanıcının isteği doğrultusunda yeni test veya derleme çalıştırılmamıştır.

GitHub kaynak dosyalarını; ZIP aynı kaynakların yanında daha önce oluşturulmuş web çıktısını içerir. `node_modules`, çalışma verileri ve gerçek `.env` dosyaları kuruluma ait olup teslim paketine dahil edilmez.
