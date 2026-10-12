# Rakip panel analizi: bilgi mimarisi ve "Ayarlar" kararı (12 Ekim 2026)

## Yöntem ve sınırlar (önce bunlar)

Rakiplerin müşteri panellerinin çoğu giriş duvarının arkasında. Bu rapor **herkese açık sayfalardan ve yardım merkezlerinden** derlendi; ekran ekran gezilmiş bir inceleme değil. Sesli asistan satan firmaların (Goodcall, Smith.ai, Rosie, Slang.ai) kamuya açık sayfaları panelin menüsünü hiç anlatmıyor; yalnızca özellik listesi veriyor. Menü yapısını açıkça belgeleyen ürünler (Fresha, Calendly, Dialpad, Retell, Synthflow, Vapi) o yüzden "yakın komşu" olarak ekledim: randevu/hizmet panelleri ve telefon-AI panelleri. Doğrulanamayanları ayrıca işaretledim. Kesin menü adları için bir deneme hesabıyla bakmak gerekir.

## 1. Ne bulundu

| Ürün | Ne tür | Panelde öne çıkanlar (kaynağı) |
|---|---|---|
| **Goodcall** | Sesli AI resepsiyonist | Asistan ve "beceriler/akışlar" (karşılama, dallanma), numara ve yönlendirme (meşgulse / cevapsızsa / her çağrıda; aktarma hedefi: ana hat, kişi, bölüm), geri düşme davranışı (mesaj al, bağlantı gönder, geri arama planla), Google Takvim ve CRM, **çağrı kayıtları + transkript**, "yanlış giden çağrıyı işaretle", **onaya sunup yayınla / son sürüme geri dön**, çağrı bitince SMS ve e-posta ile müşteri adayı bildirimi, ekip erişim denetimi ([goodcall.com](https://www.goodcall.com/)). Yardım merkezi: Başlangıç, Beceriler, SSS ([help.goodcall.com](https://help.goodcall.com/)). |
| **Smith.ai** | AI + insan resepsiyonist | **Çağrı panosu:** seçilen dönemde çağrı geçmişi, arayan türü, yapılan işlem; "Call Intelligence" ile randevu, aktarma, tamamlanan form sonuçları; özet ve sonraki adım önerisi; transkriptte anahtar kelime arama, kart/TC gibi bilgiler otomatik gizlenir; CRM ve takvim bağlantıları ([Capterra](https://capterra.com/p/181278/Smith-ai-Live-Website-Chat/), [Filevine](https://filevine.com/integrations/smithai/)). |
| **Rosie** | Yapay zekâ cevaplama | Telefon uygulaması merkezde: **birleşik gelen kutusu** (çağrı + SMS), AI özeti ve tam transkript, her müşteri adayı için anlık bildirim, bildirime dokununca geri arama; spam filtresi; karşılama ve SSS özelleştirme ([heyrosie.com](https://heyrosie.com/features/mobile-app)). |
| **Slang.ai** | Restoran odaklı | Ses seçimi, özel karşılama, restoran rezervasyon sistemleriyle (OpenTable, Resy...) entegrasyon, VIP yönlendirme, özel etkinlik/kayıp eşya gibi konularda anlık uyarı, çok şubeli yönetim ([slang.ai](https://www.slang.ai/)). |
| **Retell** | Geliştirici platformu | Menü "Build / Test / Deploy / Monitor / Data / Developer" mantığında: ajanlar, bilgi tabanı, test alanı ve simülasyon, numaralar, **canlı çağrı izleme**, özel analiz panoları, AI kalite puanı, çağrı ve sohbet geçmişi ([docs.retellai.com](https://docs.retellai.com/general/introduction)). |
| **Synthflow** | Kodsuz ses ajanı | Ajan düzenleyici, "Aurora" adlı panel içi yardımcı, simülasyon/değerlendirme, entegrasyon kataloğu ve webhook'lar, **Admin → Workspace Settings → Plan & Billing**, alt hesap dakika limitleri ([docs.synthflow.ai](https://docs.synthflow.ai/)). |
| **Vapi** | Geliştirici platformu | **Calls** sekmesi: çağrı listesi, bitiş nedeni, süre, maliyet, filtreler; kayıt ve transkript ayrı ayarlar ([docs.vapi.ai](https://docs.vapi.ai/observability/logs/call-logs)). |
| **Dialpad** | Telefon sistemi | Sol daralan menü (gelen kutusu, mesajlar, kişiler, çağrı geçmişi) + **Admin Settings → Departments → Business Hours & Call Handling → Call Routing**; açık ve kapalı saatler için ayrı yönlendirme, karşılama kayıtları ([Dialpad](https://dialpad.com/features/virtual-receptionist)). |
| **Fresha** | Salon/spa randevu | **Kişisel ayarlar ile işletme ayarlarını ayırır.** Sağ üst profil simgesi: Kişisel ayarlar (hesap bilgileri, **Görünüm: Açık / Koyu / Sistem**), dil seçimi profil menüsünün altında; işletme tarafı ayrı "Workspace settings → Business setup" altında ([Fresha](https://www.fresha.com/help-center/knowledge-base/personal-account/101231-manage-your-personal-account)). |
| **Calendly** | Randevu | Sol menüde işlevler (etkinlik türleri vb.), profil menüsünde hesap işleri; "Account settings" altında Profil, İletişim tercihleri, Giriş tercihleri; **markalama ve yönetici araçları ayrı** ([Calendly yardım](https://calendly.com/help/account-settings-overview)). Koyu mod bilgisi bulunamadı. |

## 2. Ortak mimari örüntüsü

Sesli AI ürünleri, ürün olgunlaştıkça şu beş katmanı ayırıyor. Hepsi bizde de karşılığı var ya da olabilir:

1. **Çalışma alanı (günlük iş):** gelen kutusu / çağrılar / randevular. Rosie, Dialpad, Smith.ai: uygulamanın ana ekranı. *Bizde: Bugün, Randevular, Çağrılar, Geri aramalar.*
2. **Analiz:** sonuç dağılımı, kaçan çağrı, saat yoğunluğu. Smith.ai "Call Intelligence", Retell panoları. *Bizde: Raporlar (iyi durumda).*
3. **Kurulum / yapılandırma:** asistanın ne söylediği, ne zaman çalıştığı, nereye aktardığı, bilgi tabanı. Goodcall (beceriler, yönlendirme), Dialpad (Business Hours & Call Handling), Retell (Build). **Kendi başına bir bölüm, "Ayarlar" adını taşımıyor**; ürünler bunu Build, Skills, Call Handling, Agent gibi **işin adıyla** çağırıyor.
4. **Hesap ve faturalama:** plan, kullanım, ekip. Synthflow (Plan & Billing), bizde Paketim ve Kullanıcılar.
5. **Kişisel tercihler:** ad, dil, görünüm, bildirimler, şifre. Fresha ve Calendly bunu **profil menüsüne** koyuyor; işletme ayarlarıyla karıştırmıyor.

## 3. Bize uyan ve uymayan

**Uyanlar**
- **Taslak → yayınla → geri dön** (Goodcall): bizde taslak ve yayınlama var, geri alma yok. Küçük bir eklemeyle (önceki sürüme dön) tamamlanır.
- **Çağrı kaydı + transkript + özet** (Smith.ai, Rosie): müşterilerin en çok değer verdiği ekran. Bizde yalnızca özet var; en büyük boşluk.
- **Çağrıyı "yanlış" diye işaretle** (Goodcall): asistan kalitesini iyileştirmenin en ucuz yolu. Bizde yok.
- **Anlık bildirim** (Rosie): yeni müşteri adayı, kaçan çağrı. Bizde e-posta altyapısı var, kural bazlı bildirim ekranı yok.
- **Açık / kapalı saat için ayrı yönlendirme** (Dialpad): bizde "asistan ne zaman devrede" tek seçim; mesai içi ve dışı için ayrı davranış (aktarma, mesaj al) eklenebilir.
- **Profil menüsünde kişisel ayarlar, ayrı işletme ayarları** (Fresha, Calendly): önerdiğiniz yapı bunun aynısı.

**Uymayanlar**
- **Geliştirici panelleri** (Vapi, Retell, Synthflow): API anahtarı, SIP, simülasyon, A/B testi. Spa, klinik, emlak sahibi için gereksiz karmaşa. Yalnızca "Asistanı dene" ve ileride "test çağrısı kaydı" faydalı.
- **Çok şubeli yönetim** (Slang): ilk aşamada şart değil; yapı ileride "firma" üstüne "şube" ekleyerek gelir.
- **Akış editörü** (Synthflow, Goodcall akışları): kullanıcı konuşmayı çizmek istemiyor; biz formla ve şablonla yönetiyoruz, bu doğru. Sektör şablonları farkımız.
- **Çok sayıda entegrasyon kataloğu:** ilk etapta Google Takvim ve SMS/WhatsApp yeterli.

## 4. "Ayarlar" adı üzerine karar

Sorunuz yerinde: şu an "Ayarlar" altında asistanın ses ve adı, çalışma saatleri, hizmetler, ekip, odalar, SSS, bildirimler, aktarma var. Bunların hepsi **asistanı ve işletmeyi kurmak**; kişisel bir ayar yok. Rakipler de bunu "Ayarlar" demiyor. Öneri:

- Sol menüde **"Kurulum"**: asistan ve işletme yapılandırması (mevcut sayfanın adı ve yönlendirmesi değişir, içerik aynı).
- Profil menüsünde **"Hesap ayarları"**: ad, dil, görünüm (Açık / Koyu / Sistem), e-posta bildirimleri; "Şifre değiştir" ve "Çıkış" yanında.
- "Asistanı dene" ve "Kullanıcılar" şimdilik olduğu yerde; ileride Kurulum altında sekme olabilir.

Önerilen genel yapı:

```
Çalışma:   Bugün · Randevular · Çağrılar · Geri aramalar
Analiz:    Raporlar
Hesap:     Paketim · Kullanıcılar
Kurulum:   Asistan, Çalışma saatleri, Hizmetler, Ekip, Odalar, SSS, Bildirimler, Telefon
Profil:    Hesap ayarları · Şifre değiştir · Çıkış
```

## 5. Bu turda yapılanlar ve sonraki öneriler

- Yapıldı: "Ayarlar" → "Kurulum", profil menüsünde "Hesap ayarları" (ad, dil, görünüm, e-posta bildirimleri), panel için açık/koyu/sistem teması. Tanıtım sitesi her zaman açık temada kalır.
- Sonraki: çağrı transkripti ve "yanlış çağrıyı işaretle", ayarlar için "önceki sürüme dön", mesai içi/dışı ayrı yönlendirme, kural bazlı anlık bildirimler, menüyü Çalışma / Analiz / Hesap / Kurulum gruplarına bölmek.
