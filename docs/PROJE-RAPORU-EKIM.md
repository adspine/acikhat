# Açık Hat: Baştan uca proje raporu (12 Ekim 2026)

Bu rapor teknik bilgi gerektirmeyecek şekilde yazıldı. Her maddede önce "ne demek", sonra "ne yapmak gerek" var.

Nasıl baktım: Kodun tamamını taradım, 201 otomatik testi çalıştırdım, canlı sunucuyu (acikhat-resepsiyon.fly.dev) ve Fly'daki gizli ayarların listesini kontrol ettim. Gerçek telefon, gerçek ElevenLabs görüşmesi, Google girişi, e-posta ve ödeme gibi dış servisleri denemedim; onlar aşağıda "denenmedi" diye işaretli.

---

## 1. Tek bakışta durum

| Konu | Durum |
|---|---|
| Müşteri paneli (randevu, çağrı, rapor, paket, kurulum, ses seçimi) | Çalışıyor, testli |
| Yönetici paneli (başvuru, müşteriler, asistan kur/düzenle/dene) | Çalışıyor, testli |
| Giriş / üyelik (Firebase) | Çalışıyor, canlıda Google girişi tam denenmedi |
| Randevu SMS'i / WhatsApp | **Gerçekte gitmiyor** (aşağıda madde 2.1) |
| E-posta bildirimleri | Hazır ama **kapalı** (domain ve anahtar bekliyor) |
| Ödeme | **Test modunda** (herkese ücretsiz paket veriyor) |
| Gerçek telefon görüşmesi | Hiç denenmedi |
| Güvenlik başlıkları, sıkıştırma, hız sınırı, SEO | Eksik (madde 4) |

Kısaca: Ürünün yazılımı büyük ölçüde hazır. Sizin saydığınız iki eksik (numara + gerçek telefon testi, domain) doğru; ben bunlara bağlı ek işler buldum, ayrıca bunlardan bağımsız birkaç eksik daha var.

---

## 2. Sizin 1. eksiğiniz: Netgsm 850'li numara ve gerçek telefon testi

### 2.1 Kodda yazılmamış bir parça var: SMS gönderimi
Randevu alınınca müşteriye giden onay SMS'i şu an gerçek bir sağlayıcıya bağlı değil. Sistem mesajı yalnızca kendi kayıt defterine yazıyor ("gönderdim" diye geçiyor ama kimseye ulaşmıyor). Kodda Netgsm için SMS bağlantısı hiç yazılmadı, yalnızca telefon hattı (SIP) bağlama betiği var.
- **Ne gerek:** Netgsm SMS bağlantısını ben yazarım (yarım gün). Sizden Netgsm kullanıcı kodu, şifre ve onaylı **SMS başlığı** (gönderen adı) gerekir. Başlık onayı Netgsm'de birkaç gün sürebilir, hemen başvurun.
- WhatsApp için de bir sağlayıcı seçilmedi; şimdilik yalnızca SMS düşünmek mantıklı.

### 2.2 Telefon hattı nasıl bağlanacak
Arayan kişi 850 numarasını arar, Netgsm çağrıyı ElevenLabs'e iletir, ElevenLabs'teki asistan cevap verir. Bu bağlantıyı kuran betik hazır (`scripts/connect-phone.ts`). Sizin yapacaklarınız:
1. Netgsm'den numarayı alın, panelinde SIP bilgilerinizi bulun (kullanıcı adı, şifre).
2. Netgsm'de gelen aramaları ElevenLabs'in adresine yönlendirin (betiğin başındaki açıklamada adımlar var).
3. SIP kullanıcı adı ve şifresini bana verin, betiği çalıştırıp numarayı asistana bağlayayım.
4. Yönetici panelinde Müşteriler > firma > Yönet'ten numarayı firmaya atayın. (Asistan kurulmamışsa önce ⋮ > Asistanı kur.)
- **Netgsm'e sormanız gereken:** 850 numaralar SIP ile ElevenLabs'e yönlendirilebiliyor mu, aynı anda kaç görüşme (kanal) açılabiliyor, şifreli konuşma (SRTP) destekleniyor mu. Ben bunları doğrulayamadım; ilk gerçek aramada anlaşılır.
- **Kanal sayısı:** Aynı anda kaç kişi arayabilir sorusu hem Netgsm'in kanal sayısına hem ElevenLabs planınıza bağlı. Pilotta 2-3 yeterli olur.

### 2.3 Gerçek telefon testinde bakılacaklar (kontrol listesi)
1. Numarayı ara, asistan karşılasın, firma adı ve karşılama doğru olsun.
2. Randevu al: takvime yazıldı mı, panelde göründü mü, SMS geldi mi.
3. Randevu iptal / değiştir.
4. Çalışma saati dışı, dolu saat, yanlış anlaşılan isim/numara gibi zor durumlar.
5. Görüşme bitince Çağrılar sayfasında kayıt, özet ve dakika kullanımı görünüyor mu.
6. Aramayı yarıda kes: "kaçan çağrı" doğru işaretleniyor mu.
7. İnsana aktarma isteniyorsa o bacak ayrıca denenmeli.
8. Eğer ElevenLabs "Asistanı dene" ile aynı kalitede değilse (telefon hattı sesi daha kötü olur) konuşma hızı ve duraksama ayarlarına bakılır.

Bunların hiçbiri şu ana kadar gerçek hatla denenmedi; bu yüzden ilk testlerde küçük ayarlar çıkması normaldir.

---

## 3. Sizin 2. eksiğiniz: acikhat.ai alanı adı ve tam bağlama

Alan adını aldığınızda şu sırayla bağlanır. Ben kodu ve ayarları yaparım, siz hesap/panel işlerini yaparsınız:

| # | İş | Kim |
|---|---|---|
| 1 | acikhat.ai'yi satın al | Siz |
| 2 | Alan adını Fly sunucusuna yönlendir (DNS kayıtları + sertifika, `fly certs add`) | Ben komutu veririm, DNS kayıtlarını siz girersiniz |
| 3 | Sunucudaki sitenin ana adresini (`PUBLIC_BASE_URL`) yeni alan adına çevir | Ben |
| 4 | Tüm asistanları yeniden yayınla ve ElevenLabs'teki webhook adreslerini yenile (asistanlar araçlarını ve görüşme sonu bilgisini bu adrese gönderiyor; eski adrese bırakılırsa koparsa randevu alamaz) | Ben |
| 5 | Firebase > Authentication > yetkili alan adlarına acikhat.ai ekle (yoksa Google ile giriş çalışmaz) | Siz |
| 6 | Resend'de alan adını doğrula (DNS kayıtları: SPF ve DKIM) ve API anahtarını al | Siz |
| 7 | Sunucuya `RESEND_API_KEY` ve gönderen adresini (`MAIL_FROM`) tanımla | Ben |
| 8 | `destek@acikhat.ai` posta kutusu (Google Workspace, Zoho vb.) | Siz |
| 9 | Sitedeki `kisaltici@gmail.com` adreslerini yeni adresle değiştir (gizlilik ve yasal metinler) | Ben |
| 10 | Eski adres (fly.dev) yeni adrese yönlendirsin | Ben |

**Önemli:** 4. madde atlanırsa en sinsi hata çıkar: site açılır, giriş çalışır ama telefonda asistan randevu alamaz. Alan adını değiştirdiğiniz gün mutlaka bir test aramasıyla doğrulayalım.

Alan adını almadan önce bile 2-3-4. maddeler denenebilir, ama ElevenLabs tarafı ürün adresine bağımlı olduğu için bunları adres kesinleşince tek seferde yapmak daha temiz.

---

## 4. Sizin saydıklarınızdan bağımsız, benim bulduğum eksik ve hatalar

### Yüksek öncelik (canlıya müşteri almadan önce)

1. **Ödeme şu an test modunda canlıda açık.** Sunucuda `PAYMENT_TEST_MODE=1` var; herkes "ödemeyi tamamla" deyip ücretsiz paket alıyor. Pilotta bilerek olabilir, ama gerçek müşteri geldiğinde ya PayTR ya da yönetici panelinde "elle ödendi işaretle" düğmesi gerekir. Bu düğme henüz yok.
2. **Test sayfası canlıda açık.** `/test/` adresi canlıda duruyor (şifre ister, kapalı sayılmaz) ama artık yönetici panelinde "Asistanı dene" var; eski sayfa gereksiz. Kapatmak daha güvenli.
3. **Güvenlik başlıkları yok.** Site başka bir sitenin içine gömülebilir (tıklama tuzağı), tarayıcıya "bu içeriği olduğu gibi kullan" talimatı verilmiyor. Hepsi kolay eklenir (yarım gün).
4. **Sıkıştırma yok.** Site ve panel dosyaları ham gidiyor; sıkıştırmayla yaklaşık dörtte birine iner, açılış hızlanır.
5. **Başvuru ve ödeme uçlarında hız sınırı yok.** Giriş denemelerinde var, ama form gönderme gibi uçlara bot saldırırsa sunucu doldurulabilir.
6. **Kişisel veri saklama süresi uygulanmıyor.** Gizlilik metni "süre sözleşmede belirlenir" diyor ama eski çağrı kayıtlarını silen bir iş yok; KVKK silme talebi için de araç yok. Avukatla sürenin belirlenmesi gerekir.
7. **Yedek geri yükleme hiç denenmedi.** Fly günlük yedek alıyor ama "yedekten dönülebiliyor mu" kimse bilmiyor. Bir kez deneme tatbikatı yapılmalı.
8. **Hata izleme yok.** Sunucuda bir şey bozulursa size haber gelmiyor; yalnızca log var. Telefon hatları için özellikle önemli: asistan çökerse müşteri arayıp boşluğa konuşur.

### Orta öncelik

9. **Kota aşımı faturalanmıyor.** Paket dakikası bitince asistan çalışmaya devam ediyor, aşım ücreti sadece ekranda yazıyor. Aşım dönem sonunda tahsil edilmeli ya da kota bitince durma/devam seçeneği sunulmalı.
10. **Fatura / e-arşiv yok.** Ödeme gerçek olunca KDV'li fatura gerekir.
11. **Yönetici hesabı için ek doğrulama (2 adım) yok.** Bu hesap tüm müşteri verisini görüyor; Google hesabınızda 2 adım doğrulamayı açın.
12. **Asistan gerçek aramada az denendi.** Spa dışındaki sektörlerin (emlak, restoran vb.) asistan talimatları yazıldı ama gerçek aramalarla doğrulanmadı.
13. **Yasal sayfada kişisel veri:** Vergi kimlik no (şahıs işletmesinde TC kimlik no olabilir) herkese açık. Avukata sorun.
14. **Ses geçersiz kılma (başka sesle deneme)** yeni eklendi: mevcut asistanlarda ilk yayına kadar çalışmayabilir, ElevenLabs ile denenmedi.
15. **"Asistanı kur" gerçek ElevenLabs ile denenmedi.** İlk kurulumu birlikte izleyelim.

### Düşük öncelik / ileride

16. Arama motoru görünürlüğü: site tek sayfalık, adresler `#` ile; Google bunları ayrı sayfa olarak göremiyor. `robots.txt`, `sitemap.xml`, paylaşım önizlemesi (OG), favicon yok.
17. Yazı tipleri Google'dan yükleniyor; kendi sunucumuzdan sunmak hem hız hem KVKK için daha iyi.
18. Yönetici panelinde arama/sıralama/dışa aktarma yok (müşteri sayısı artınca gerekir). Sipariş listesi ve iade yok (ödeme ile gerekecek).
19. Müşteri panelinde ses kaydı dinleme, rapor dışa aktarma, bildirim tercihleri, haftalık özet e-postası yok.
20. Ön yüz testleri yok (arka yüzde 201 test var). Giriş ve kurulum akışı için otomatik tarayıcı testi iyi olur.
21. Tek sunucu, tek veritabanı dosyası. Birkaç yüz müşteriye kadar yeterli; sonra büyütülür.

---

## 5. Önerdiğim sıra

1. **Hemen başvurun (bekleme süresi var):** Netgsm numarası + SMS başlığı onayı, acikhat.ai satın alma.
2. **Ben yapabilirim, siz beklerken:** Netgsm SMS bağlantısı, güvenlik başlıkları, sıkıştırma, hız sınırı, eski test sayfasını kapatma, "elle ödendi işaretle" düğmesi, favicon/robots/sitemap.
3. **Numara ve domain gelince:** Bölüm 3'teki sırayla domain bağlama, ardından bölüm 2.3'teki kontrol listesiyle gerçek telefon testi.
4. **İlk müşteriden önce:** kota aşımı kararı, kişisel veri saklama süresi, hata izleme.

Dilediğiniz maddeleri söyleyin; 2. başlıktaki işleri sırayla yapmaya başlayabilirim.
