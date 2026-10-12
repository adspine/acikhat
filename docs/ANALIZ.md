# Proje Analizi ve Eklenen Noktalar

Kaynak: `sesli_ai_resepsiyonist_proje_ozeti.md` (Ekim 2026). Bu belge özeti teknik açıdan değerlendirir, gözden kaçan noktaları ekler ve kodun neden böyle kurulduğunu açıklar.

İşaretler: **[DOĞRULA]** = kurulumdan önce sağlayıcıdan/dokümandan teyit edilmeli. **[VARSAYIM]** = kaynaksız tahmin.

---

## 1. Özetin güçlü yanları (aynen korundu)

- **Slot seçimi deterministik kodda, LLM sadece konuşuyor.** En doğru karar. Kodda bunu bir adım ileri taşıdık (aşağıda 3.1).
- Yönetilen platformla (ElevenLabs Agents) başlamak. 3.000 dk/ay hacimde kendin kurmak (LiveKit/Pipecat) emek olarak daha pahalı.
- Önce yalnızca gelen çağrı (inbound). Giden arama İYS ve maliyet açısından ayrı bir proje.
- Mevcut numara → yönlendirme → 0850 → SIP → ajan. Müşteri numarasını değiştirmiyor, satışı kolaylaştırıyor.

---

## 2. Gözden kaçan noktalar (öncelik sırasıyla)

### 2.1 KRİTİK: İnsana aktarmada çağrı döngüsü
Spa numarası **koşulsuz** olarak 0850'ye yönlendirildiyse ve ajan "sizi resepsiyona aktarıyorum" deyip çağrıyı **aynı spa numarasına** aktarırsa, çağrı tekrar ajana döner. Sonsuz döngü oluşur ya da çağrı düşer.

Çözüm:
- Aktarma hedefi her zaman **farklı bir hat** olmalı: resepsiyon cep telefonu veya yönlendirme kuralı olmayan ikinci bir sabit hat. Tenant ayarında `handoff.transferNumber` alanı bu yüzden zorunlu.
- Aktarma, SIP sağlayıcısından **giden çağrı** olarak çıkar. Cep telefonuna aktarma dakikası pahalı olabilir (özetteki Plivo örneği: 0,39 $/dk). Bu maliyet modelde yok. **[DOĞRULA]**: Netgsm/Verimor'da SIP REFER mi, yeni bacak mı açılıyor? Dakika ücreti ne?
- "Meşgul/cevapsız halinde yönlendirme" (hibrit) modelinde bu risk azalır, çünkü insan zaten telefonu açmamış demektir. Bu durumda ajan aktarmak yerine **geri arama kaydı** almalı. Kodda `log_callback_request` aracı bu yüzden var.

### 2.2 KRİTİK: Yönlendirilen çağrıda arayan numarası
Özet bunu riskli olarak işaretlemiş. Kod iki ihtimali de karşılıyor:
- Numara gelirse (`system__caller_id` / init webhook'taki `caller_id`): ajan "Sizi 0532 … numarasından arıyorsunuz, SMS bu numaraya gelsin mi?" diye sadece **teyit** eder.
- Gelmezse veya sabit hat/gizli numara ise: ajan numarayı sorar, **3-3-2-2** gruplar halinde geri okur. Backend Türkiye cep formatını doğrular, geçersiz numarayla randevu yazmaz.

### 2.3 Tarih hesabını LLM'e bırakmamak
LLM'ler "önümüzdeki cuma", "haftaya salı" gibi ifadelerde gün hesaplamakta sık hata yapar. Bu hata **yanlış güne randevu** demektir. Uygulanan teknik: arama başında init webhook'u, önümüzdeki 14 günün tablosunu (`12 Ekim Pazartesi = 2026-10-12` …) dinamik değişken olarak prompt'a koyar. LLM hesap yapmaz, tablodan okur.

### 2.4 Uydurma saat ve çift randevu
- `check_availability` her slot için **imzalı bir `slot_id`** döner. `book_appointment` yalnızca bu id'yi kabul eder. LLM var olmayan bir saati veya yanlış terapisti uyduramaz, sahte id imza kontrolünden geçemez.
- Randevu yazılırken uygunluk **veritabanı işlemi içinde yeniden kontrol edilir**. İki hat aynı anda aynı slotu alamaz.
- `book_appointment` için `confirmed_by_caller: true` zorunlu. Sadece prompt'a "teyit et" yazmaktan daha güçlü bir kural.

### 2.5 Gecikme bütçesi: araç çağrıları
Hedef 1 saniyenin altındaydı. Her araç çağrısı bu bütçeye eklenir. Önlemler:
- Backend'i **Avrupa'da** (Frankfurt) barındır, araç cevabını 300 ms altında tut.
- Slot hesabı bellekte, tek SQL sorgusuyla yapılıyor. Google Calendar gibi dış takvimler eklenince önbellek/senkron gerekir.
- ElevenLabs'te `soft_timeout_config` ile "Hemen bakıyorum…" dolgu cümlesi ayarlı. Araç beklerken sessizlik olmaz.
- SMS gönderimi randevu cevabını **bekletmez**, arka planda yapılır.

### 2.6 Dakika yakan çağrılar (maliyet koruması)
Spam, sessiz hat, sohbet uzatan arayan ve ajanın açık kalması doğrudan maliyettir. Ayarlar:
- `max_duration_seconds: 420` (7 dk) **[VARSAYIM]**. Pilotta gerçek dağılıma göre ayarlanmalı.
- `silence_end_call_timeout: 20` sn.
- `call_limits.agent_concurrency_limit` ve `bursting_enabled: false`. Patlama 2 kat fiyat demek. Bunun yerine `queueing_config` ile kısa bekletme.

### 2.7 KVKK: yurt dışına aktarım (özette eksik kalan kısım)
Ses, transkript ve isim/telefon ABD/AB'deki sağlayıcılara gidiyor (ElevenLabs, LLM sağlayıcısı). 2024 KVKK değişikliğinden sonra yurt dışı aktarımda **standart sözleşme** yolu kullanılırsa sözleşmenin imzadan sonra 5 iş günü içinde Kurum'a bildirilmesi gerekiyor. **[DOĞRULA: avukat]**

Pratik öneriler:
- ElevenLabs'te AB veri yerleşimi / sıfır saklama seçeneklerini ve fiyatlarını sor. **[DOĞRULA]**
- `platform_settings.privacy.conversation_history_redaction` ile saklanan transkriptlerde telefon numarasını maskele. Randevu verisi zaten bizim veritabanında duruyor.
- Karşılama cümlesindeki aydınlatma metni **kısa** olmalı (her saniye para ve sabır). Tam metin SMS'teki bağlantıda ve spa sitesinde dursun.
- Veri sorumlusu spa, biz veri işleyeniz. Her spa ile **veri işleme sözleşmesi** imzalanmalı. Özette yoktu.

### 2.8 SMS ayrıntıları
- Randevu onayı **bilgilendirme** SMS'idir, İYS izni gerekmez. İçine kampanya cümlesi eklenirse ticari ileti olur ve izin gerekir. Şablonu sade tut.
- SMS başlığı (gönderici adı) her spa için ayrı kayıt ister ve onay süresi var. Başlangıçta ajansın tek başlığıyla "Lavanta Spa randevunuz…" yazmak daha hızlı. **[DOĞRULA: Netgsm]**
- Yerli SMS (Netgsm vb.) Twilio'dan genelde çok daha ucuz. Maliyet modelindeki 0,03 $ muhtemelen yüksek kalıyor. **[DOĞRULA]**

### 2.9 Arıza durumunda ne olacak?
SIP hattı, ElevenLabs veya backend çökerse arayan ya hiçbir şey duymaz ya da çağrı düşer. Satış sözleşmesinde de bu sorulacak.
- Yönlendirme operatörde "ulaşılamazsa" kuralıyla kurulabiliyorsa yedek hedef resepsiyonun cep telefonu olsun. **[DOĞRULA]**
- Backend aracı hata dönerse ajan "sistemde anlık sorun var, numaranızı alıp sizi geri arayalım" der. Prompt'ta tanımlı, araç hatası test senaryosunda var.
- ElevenLabs `alerting` ile hata oranı/gecikme alarmı kurulabilir.

### 2.10 Ürün/iş tarafında eklenmesi önerilenler
- **Haftalık rapor** (spa sahibine): kaç çağrı, kaç randevu, mesai dışı yakalanan randevu ve tahmini TL karşılığı. Satış argümanı "kaçırılan randevu" ise bunu müşteriye her hafta göstermek iptalleri azaltır. Post-call webhook verisi bunun için saklanıyor.
- **İptal/erteleme** akışı: gelen çağrıların ciddi kısmı yeni randevu değil, değişikliktir. **[VARSAYIM]** MVP'de "geri arama notu" ile karşılanıyor, 2. adımda araç olarak eklenmeli.
- **Çok kiracılı (multi-tenant) yapı ilk günden.** Her spa = bir tenant ayar dosyası, bir ElevenLabs ajanı. İkinci müşteride kod değişmez, sadece ayar eklenir. "Spa şablonu ile 5-8 saat kurulum" hedefi buna bağlı.
- **Spa yazılımı entegrasyonu** belirleyici. Spa'lar Google Calendar yerine kendi randevu programlarını kullanıyorsa iki takvim tutulur ve çift randevu riski doğar. Pilottan önce sorulması gereken ilk soru bu (özetteki 9. açık soru). Kodda takvim bir arayüzün (`AvailabilityStore`) arkasında. Şu an kendi SQLite'ımız var, Google Calendar/Cal.com adaptörü eklenebilir.
- **Model değişikliği riski**: LLM'i `backup_llm_config` ile yedekli kur. Model değiştirirken ElevenLabs test seti (`agents/tests`) üzerinden regresyon çalıştır.

---

### 2.11 ElevenLabs kurulumunda ortaya çıkanlar (11 Ekim 2026)
- **Ses kütüphanesi riski:** Popüler Türkçe seslerin çoğu (Mia, Ahu, Gökçe, Eda…) "live moderation" açık olduğu için **ajanlarda kullanılamıyor**. Kütüphane seslerini sahibi, belirlenen bildirim süresi dolunca kaldırabiliyor (Gözde: 30 gün, Burcu/Derya/Ozan: 730 gün). Müşteriye satılan bir üründe bildirim süresi kısa ses kullanılmamalı. Uzun vadede Voice Design ile ajansa ait bir ses üretilmesi önerilir.
- **Model emekliliği gerçekleşti:** `gemini-2.5-flash-lite` listeden kalkmış, yerine `gemini-3.5-flash-lite` kondu. Her ay `GET /v1/convai/llm/list` ile `deprecation_info` kontrol edilmeli.
- **Transkript maskeleme yalnızca Enterprise planda var.** Starter/Creator planlarda telefon numarası ve isim transkriptte açık saklanıyor. KVKK için ElevenLabs'teki saklama süresi kısa tutulmalı ve bu durum veri işleme sözleşmesine yazılmalı.
- **Telaffuz:** "SMS" harf harf, "19.00" "sıfır sıfır" diye okunuyordu. Telaffuz sözlüğü (`agent/pronunciation.json`) ve tam saat biçimi ("saat 19") ile çözüldü. Yeni kısaltmalar (KDV, vb.) sözlüğe eklenmeli.

## 3. Teknik mimari (uygulanan)

```
Arayan ─▶ Spa numarası ─(yönlendirme)─▶ 0850 ─SIP/TLS─▶ ElevenLabs Agent
                                                         │  (STT ▸ LLM ▸ TTS)
            ┌────────────────────────────────────────────┤
            ▼                                            ▼
  POST /webhooks/elevenlabs/init            POST /tools/:tenant/*  (webhook tools)
  (tarih tablosu, arayan no,                 check_availability ─▶ deterministik slot motoru
   spa bilgisi → dinamik değişken)           book_appointment  ─▶ SQLite işlem + SMS
                                             log_callback_request
            ▼
  POST /webhooks/elevenlabs/post-call (HMAC imzalı) ─▶ çağrı kaydı, özet, metrikler
```

### 3.1 Slot motoru kuralları (`src/domain/slots.ts`)
1. Gün = spa çalışma saati ∩ terapist çalışma saati, kapalı günler hariç.
2. Hizmet süresi + temizlik/arası tamponu, terapistin mevcut randevularıyla çakışmamalı.
3. Hizmetin gerektirdiği oda tipinde (tek/çift/hamam) boş oda olmalı.
4. En erken başlama: şimdi + `minLeadMinutes` (örn. 60 dk).
5. Sıralama: istenen saat varsa ona yakınlık, yoksa en erken. "Sabah/öğle/akşam" filtresi uygulanır.
6. **Çeşitlilik**: aynı saati 3 farklı terapistle önermek yerine birbirinden en az 60 dk uzak 3 seçenek önerilir (telefonda daha kullanışlı).

### 3.2 Stack
- Node 26 + TypeScript (Node doğrudan çalıştırıyor, derleme adımı yok), Hono (hafif HTTP), Zod (araç girdisi doğrulama).
- `Temporal` (Node 26'da yerleşik): Europe/Istanbul saat hesabı, kütüphane gerekmiyor.
- `node:sqlite`: MVP ve pilot için yeterli. Çoklu sunucuya geçişte Postgres'e (örn. Neon, Frankfurt) taşınır, depo katmanı ayrı tutuldu.
- Barındırma önerisi: Frankfurt bölgesinde kalıcı disk veren bir Node sunucusu (Fly.io, Railway, Hetzner). SQLite serverless'ta kalıcı olmaz.

---

## 4. Sıradaki adımlar (kod dışı, kullanıcıda)

1. ElevenLabs hesabı açılıp API anahtarı alınmalı. Türkçe ses denemesi yapılmalı (`eleven_v4_turbo` ve `eleven_flash_v2_5` karşılaştırması).
2. Netgsm/Verimor/Bulutfon'a Bölüm 6'daki sorular sorulmalı. Aktarma (giden bacak) ücreti de bu listeye eklenmeli (2.1).
3. Pilot spa ile 30 dakikalık görüşmede hizmet listesi, terapistler, odalar, kullandıkları randevu yazılımı ve operatörlerinde koşullu yönlendirme olup olmadığı öğrenilmeli.
4. Bir avukatla KVKK yurt dışı aktarım ve veri işleme sözleşmesi şablonu konuşulmalı.
