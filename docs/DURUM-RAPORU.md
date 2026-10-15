# Açık Hat: durum raporu ve eksikler (12 Ekim 2026)

Kapsam: tanıtım sitesi, kurulum ve üyelik akışı, müşteri paneli, yönetici paneli, sunucu, dağıtım ve yasal içerik.
Yöntem: kod taraması, 174 otomatik test, yerelde ekran denemeleri. Canlı ortam ve gerçek servisler (Google girişi, ElevenLabs, PayTR, Resend) denenmedi.
Son commit: `43fe4b8`. GitHub Actions bu commit ile canlıya dağıtım yapar.

## 1. Canlıya çıkışı engelleyenler (önce bunlar)

1. **Ödeme yok.** Canlıda `PAYMENT_TEST_MODE` kapalı olduğu için üyelik akışında "Ödemeyi tamamla" 501 döner; yeni üye paket alamaz, kurulum formuna geçemez. PayTR gelene kadar iki seçenek: (a) kapalı beta, ödemeyi elle onaylamak (yönetici panelinden "ödendi" işaretleme düğmesi yok, eklenmeli), (b) test modunu açıp herkese ücretsiz vermek. Karar gerekiyor.
2. **Randevu SMS'i gerçekte gitmiyor.** `fly.toml` içinde `SMS_PROVIDER=console` ve `WHATSAPP_PROVIDER=console`; yani onay mesajları yalnızca günlüğe yazılıyor. Netgsm (SMS) bağlanmadan müşteriye mesaj gitmez.
3. **Alan adı yok.** `acikhat.ai` alınmadı: e-posta (Resend), gönderen adresi, `destek@` kutusu, Firebase yetkili alan adı ve yasal metinlerdeki iletişim bilgisi bekliyor. Firebase'de `acikhat-resepsiyon.fly.dev` yetkili alan adı olarak eklenmediyse Google ile giriş canlıda çalışmaz.
4. **Fatura / e-arşiv yok.** Ödeme gelince KDV'li fatura kesilmesi gerekir (e-arşiv entegrasyonu ya da muhasebe süreci). Fiyatlar KDV dahil yazıldığı için tutar buna göre ayrıştırılmalı.
5. **Yönetici dönüşümü canlıda denenmedi.** `ADMIN_EMAILS` ayarlı, ama Google ile gerçek girişin `technic@adspine.app` hesabını yönetici yaptığı henüz görülmedi.

## 2. Güvenlik ve dayanıklılık

- **Güvenlik başlıkları yok:** CSP, `X-Frame-Options` (panel başka sitede iframe'e gömülebilir), `Referrer-Policy`, `X-Content-Type-Options`. Hono'nun `secureHeaders` ara katmanı ile kolayca eklenir.
- **Genel uçlarda hız sınırı yok:** `/api/onboarding` yalnızca bal tuzağı ile korunuyor. Giriş denemelerinde sınır var (5 / 15 dk), ama başvuru formu, `/api/auth/pay`, şifre sıfırlama gibi uçlarda yok.
- **Çağrı kayıtları için saklama süresi uygulanmıyor:** gizlilik metni "saklama süresi sözleşmede belirlenir" diyor ama transkript ve özetleri silen otomatik iş yok. KVKK silme/dışa aktarma talebi için firma bazlı araç da yok.
- **Tek makine, tek SQLite dosyası:** `--ha=false`. Fly günlük anlık yedek alıyor, ancak geri yükleme hiç denenmedi. Şema değişiklikleri `addColumns` ile elle yönetiliyor (sürümlü geçiş yok).
- **İzleme yok:** hata takibi (Sentry vb.), çağrı hatası uyarısı ve çalışma süresi izleme yok; yalnızca konsol günlüğü ve `/health`.
- **Yönetici hesabı:** 2 adımlı doğrulama yok. Yönetim paneli müşteri verisinin tamamını görebiliyor; denetim kaydı yazılıyor ama arayüzde görüntülenmiyor.
- **Yasal sayfada kişisel veri:** satıcı bilgisinde "Vergi kimlik no" (şahıs işletmesinde TC kimlik no ile aynıdır) herkese açık. Mesafeli satışta zorunlu olabilir; avukata danışılmalı. İletişim e-postası hâlâ `kisaltici@gmail.com`.

## 3. Tanıtım sitesi

**SEO ve paylaşım (en büyük açık)**
- Güncel (2026-10-15): site temiz yollarla çalışır (`/hesap`, `/rehber`, `/numara-al`); eski `/#/...` adresleri açılışta temiz adrese çevrilir. Yasal metinler `/yasal/<sayfa>` ve sektör sayfaları sunucuda ayrı, taranabilir sayfalardır.
- `robots.txt`, `sitemap.xml`, `canonical`, Open Graph / Twitter kartı, yapılandırılmış veri (Organization, Product/Offer, FAQPage) ve **favicon yok**. Bağlantı paylaşıldığında önizleme boş çıkar.
- İçerik: sektör bazlı iniş sayfaları (diş kliniği, emlak, güzellik...), blog, SSS şeması yok. Dönüşüm ölçümü (analitik) yok; çerez onay yüküne girmeden ölçüm için gizlilik odaklı bir araç seçilebilir.

**Performans**
- Yanıtlar sıkıştırılmıyor (`compress` ara katmanı yok). `site.css` 68 KB ve `index.html` 68 KB ham gidiyor; gzip/brotli ile yaklaşık dörtte birine iner.
- Yazı tipleri Google Fonts'tan yükleniyor (site: Plus Jakarta Sans, panel: Onest + Unbounded). Kendi sunucumuzdan sunmak hem hız hem KVKK (üçüncü taraf istek) açısından daha iyi.
- Panelde `TestCall` parçası 579 KB (tembel yükleniyor, sorun değil), ana paket 393 KB. Derleme "büyük parça" uyarısı veriyor.

**İçerik ve tasarım**
- Mobil görünüm özellikle denenmedi: tanıtım sitesi, kurulum formu, giriş/üye ol. İlk izlenimin oluştuğu yer burası.
- Canlı demo yok: ziyaretçi asistanın sesini deneyemiyor (yalnızca kayıtlı örnek konuşma var). "Asistanı şimdi dene" en güçlü satış aracı olabilir.
- Referans, müşteri yorumu, vaka çalışması yok (henüz müşteri olmadığı için doğal).
- Tarayıcı ağında kurulum akışının adımları arasında geri dönüşte taslak kaybı denenmedi.

## 4. Kurulum ve üyelik akışı

- Üyesiz doğrudan `/kurulum` formu hâlâ herkese açık (eski akış). Kapatılacak mı, yoksa "formu doldur, sonra üye ol" gibi bir giriş olarak mı kalacak karar bekliyor.
- E-posta doğrulaması Firebase e-postası ile yapılıyor; gönderen adresi/şablonu Firebase varsayılanı (Türkçeleştirilmedi, markalanmadı).
- Şifre sıfırlama Firebase üzerinden; ama panelin eski şifreli girişi ile ekip hesapları için "geçici şifre" akışı ayrı yaşıyor. Ekip üyelerinin tek bir giriş yoluna taşınması düşünülmeli.
- Başvuru onaylandıktan sonra asistanın canlıya alınması (ElevenLabs ajanı, telefon hattı, Google Takvim) tamamen elle. Kontrol listesi var ama otomasyon yok.
- Sektör şablonlarının ajan promptları yazıldı ama gerçek aramada denenmedi; spa dışı sektörler için değerlendirme (eval) senaryoları yok.

## 5. Müşteri paneli

Çalışan: Bugün, Randevular, Çağrılar, Geri aramalar, Raporlar (karşılaştırma, hizmetler, haftanın günleri, arayanlar, kaçan nedeni), Paketim (kullanım, ek paket, yükseltme/düşürme), Ayarlar (ses seçimi dahil), Kullanıcılar.

Eksik ve iyileştirilebilir:
- **Kota aşımı tahsil edilmiyor:** kota bitince asistan çalışmaya devam ediyor, aşım ücreti yalnızca gösteriliyor. Aşım dönem sonunda faturalandırılmalı ya da kota dolunca davranış (durdur / devam) seçtirilmeli.
- **Çağrı dökümü var** (konuşma metni, zaman damgalı, özet, randevuya bağlantı) ve artık konuşma içinde arama ile kopyalama da var. **Ses kaydı dinleme yok** (ElevenLabs'ten kayıt çekilmiyor). Müşteriler için değerli ama ayrı bir saklama ve KVKK konusu.
- **Bildirim tercihleri yok:** kota ve satın alma e-postaları kapatılamıyor; haftalık özet e-postası yok.
- **Rapor dışa aktarma yok** (CSV/PDF). Randevu listesi de dışa aktarılamıyor.
- Randevu hatırlatma (SMS/WhatsApp), iptal sonrası otomatik geri arama, toplu mesaj gibi gelir getiren işler yok; çoğu Netgsm'e bağlı.
- Panel mobilde çalışıyor ama sol menü kota kutusu mobilde görünmüyor; kullanım yalnızca Paketim sayfasında.
- Ayarlar, Randevular, Kullanıcılar sayfaları yeni cam tasarımıyla ekranda gezilmedi; olası görsel pürüzler var.
- Boş durumlar (yeni müşteri, hiç çağrı yok) için ilk kullanım rehberi / kontrol listesi ("telefonu yönlendir, asistanı dene, saatleri kontrol et") yok.

## 6. Yönetici paneli

Çalışan: Genel bakış (üye, gelir, panel satışı, çağrı grafiği), Başvurular (onay, form ile düzenleme, kontrol listesi), Müşteriler (paket, hat, askıya alma, kullanım).

Eksik ve iyileştirilebilir:
- Üye listesi bilinçli kaldırıldı; ödemeyi yarıda bırakanları görmek için geri getirilebilir ya da genel bakışa "terk edilen üyelikler" sayacı eklenebilir.
- Müşteri ve başvuru tablolarında arama, sıralama, sayfalama, CSV dışa aktarma yok. Müşteri sayısı arttıkça gerekecek.
- Müşteri çekmecesinde son aktivite, çağrı geçmişi, kullanıcılar ve denetim kaydı görünmüyor.
- Üye hesabı pasifleştirme/silme, e-posta değiştirme gibi hesap işlemleri yok.
- Siparişler listesi (kim neyi ne zaman aldı) ve iade/iptal işlemi yok; PayTR ile birlikte gerekecek.
- Yeni başvuru bildirimi e-postası var (Resend anahtarı girilince çalışır); anlık bildirim (Slack/WhatsApp) yok.
- Yönetici paneli mobil görünümü denenmedi.

## 7. Test ve kalite

- 174 backend testi geçiyor (giriş, yolculuk, yönetici, faturalama, e-posta, sektör şablonları...).
- **Ön yüz testi yok:** `web/` (düz JS) ve `panel/` (React) için birim ya da uçtan uca (Playwright) test bulunmuyor. Giriş, kurulum, satın alma gibi kritik akışlar için en az bir duman testi önerilir.
- Erişilebilirlik: modal odak tuzağı, klavye ve `aria` özellikleri eklendi; cam yüzeylerde metin kontrastı ölçülmedi. Azaltılmış hareket destekleniyor.
- CI: test + panel derlemesi + Fly dağıtımı. Tip denetimi (`tsc`) CI'da yok; yerelde yapılıyor.
- Ek paket fiyatları (100/300/600 dk, $30/$80/$150) taslaktır; iş kararı bekliyor.

## 8. Önerilen yol haritası

**Bu hafta (canlıya hazırlık)**
1. Alan adını al, Resend + Firebase yetkili alan + `destek@` kutusunu bağla.
2. Ödeme kararı: PayTR hazır olana kadar "elle onay" modu ya da kapalı beta; yönetici panelinde "ödendi işaretle".
3. Netgsm bağla (SMS_PROVIDER); randevu onay mesajlarını gerçek numarayla dene.
4. Güvenlik başlıkları, hız sınırı, sıkıştırma, yazı tiplerini kendi sunucuna alma (yarım günlük iş).
5. Favicon, `robots.txt`, `sitemap.xml`, OG etiketleri.
6. Gerçek bir işletme (ör. kendi spa denemesi) ile uçtan uca canlı deneme: Google girişi, ödeme, kurulum, hat, gerçek arama.

**Sonraki 2-4 hafta**
7. PayTR entegrasyonu + fatura süreci + kota aşımı tahsilatı.
8. Hash yönlendirmeden gerçek sayfalara geçiş; sektör iniş sayfaları; canlı ses demosu.
9. Ses kaydı dinleme (isteğe bağlı); KVKK silme/dışa aktarma aracı; döküm saklama süresi işi.
10. Ön yüz duman testleri (Playwright) ve hata izleme.
11. Diğer sektörler için ElevenLabs ajanlarının kurulup gerçek aramalarla doğrulanması ve eval senaryoları.

**Sonra**
12. Yönetici paneli arama/dışa aktarma, sipariş listesi, 2 adımlı doğrulama.
13. Müşteri bildirim tercihleri, haftalık özet e-postası, randevu hatırlatma kampanyaları.
14. Çoklu makine / PostgreSQL geçişi (müşteri sayısı arttığında).
