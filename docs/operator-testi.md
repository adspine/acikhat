# Üç operatör yönlendirme testi (Turkcell, Vodafone, Türk Telekom)

Amaç: Müşterinin hattından bizim 0850'ye çağrı yönlendirmenin **gerçekte** nasıl davrandığını ölçmek. Cevaplanacak sorular:

1. Koşullu yönlendirme her operatörde çalışıyor mu? Hangi kod, hangi hatayla?
2. Bizim sistem **arayanın** numarasını mı yoksa **yönlendiren hattın** numarasını mı görüyor?
3. Yönlendirilen çağrının ücreti nedir, nasıl görünür? (Turkcell sayfası çağrı başına 13 TL diyor, Vodafone bilinmiyor.)
4. Cevapsız süresi ayarı çalışıyor mu, asistan kaçıncı saniyede açıyor?
5. Telesekreter ya da çağrı bekletme yönlendirmeyi engelliyor mu?

Süre: yaklaşık 45-60 dakika (ücretin görünmesi için ertesi gün 5 dakika). Maliyet: her test çağrısı birkaç saniyelik asistan konuşmasıdır, toplam ~20 dakika ElevenLabs süresi ve operatörün yönlendirme ücreti (Turkcell'de çağrı başına 13 TL olabilir, bu testin asıl öğrenmek istediği şey).

---

## 0. Hazırlık

**Gerekenler**
- Yönlendirilecek **A hatları**: her operatörden bir tane (cep). Sabit hat da varsa ayrıca dene.
- Arayan **B telefonu**: A hatlarından farklı bir operatörden olsun. Mümkünse ikinci bir **C telefonu** (meşgul testi için).
- **Hedef numara:** `<TEST 0850 NUMARASI>` (demo asistana bağlı olan numara; sorun çıkarmaz, görüşme demo firmasında kaydolur).
- Kronometre (telefondan) ve not defteri. Bu dosyadaki tabloları kopyalayıp doldurun.

**A hattı bilgisi (her biri için yazın):** operatör, bireysel mi kurumsal mı, tarife adı, telesekreter açık mı, faturalı mı faturasız mı. Turkcell'de "Bireysel Rahat" tarifesi yönlendirme servisinden hariç.

**Ücret ölçümü için başlangıç:** Test öncesi her A hattının bakiye / kullanım ekranının (operatör uygulaması) görüntüsünü alın. Aynı ekranı test sonrası ve ertesi gün tekrar alın.

**Kural:** Her test çağrısında asistan konuşmaya başlayınca "test" deyip **hemen kapatın**. Görüşmeyi uzatmayın.

**Başlamadan önce tüm yönlendirmeleri sıfırlayın** (A hatlarından): `##002#` ve ara. Sonra durumu sorgulayın: `*#21#`, `*#61#`, `*#62#`, `*#67#` (her biri "yönlendirme yok" demeli). Operatör farklı mesaj verirse not edin.

---

## 1. Kodlar (operatör sayfalarında doğrulanmış)

| Durum | Kod | Not |
|---|---|---|
| Koşulsuz (her çağrı) | `**21*NUMARA#` | Turkcell ve TT sayfasında var |
| Cevapsız | `**61*NUMARA**15#` | 15 = bekleme saniyesi (5-30). TT ve Turkcell sayfalarındaki örnekler bozuk görünüyor, çalışmazsa aşağıdaki varyantı deneyin |
| Meşgul | `**67*NUMARA#` | |
| Ulaşılamıyor (kapalı) | `**62*NUMARA#` | |
| İptal | `##21#`, `##61#`, `##62#`, `##67#` ya da hepsi için `##002#` | |

**Numara yazımı:** `XXXXXXX` yerine test numarasının hanelerini yazın. Önce `+90850XXXXXXX` biçimini deneyin. Reddederse `0850XXXXXXX`, sonra `850XXXXXXX`. Hangi biçimin kabul edildiğini tabloya yazın.

Kaynaklar: [Turkcell](https://www.turkcell.com.tr/servisler/arama-fatura-tl/yonlendir), [Türk Telekom](https://bireysel.turktelekom.com.tr/dijital-servisler/tum-hizmet-servisleri/cagri-yonlendirme). Vodafone için resmi kaynak bulunamadı, aynı standart kodları deneyin, çalışmazsa operatörün "Yanımda" sayfasından kendi kodunu bulun.

---

## 2. Test senaryoları (her A hattı için sırayla)

Her senaryodan sonra: sonucu tabloya yazın, yönlendirmeyi iptal edin (`##002#`).

### T1. Koşulsuz yönlendirme (taban ölçüm)
1. A hattında `**21*+90850XXXXXXX#` ara. Onay mesajı geldi mi? Yazın.
2. B'den A'yı arayın. A telefonu çaldı mı? Asistan **kaç saniyede** açtı? (Kronometre: aramaya basıştan "Merhaba" duyulana kadar.)
3. Hemen kapatın.
4. **Arayan numarası:** Bu testin saatini ve B'nin numarasının son 4 hanesini not edin. Sonradan günlükten doğrulayacağız.
5. `##21#` ile iptal.

### T2. Cevapsız (koşullu, 15 sn)
1. A'da `**61*+90850XXXXXXX**15#` ara.
2. B'den A'yı arayın, **A'yı açmayın**. A kaç saniye çaldı? Asistan kaçıncı saniyede açtı? (15 sn çaldıktan sonra mı?)
3. Kapatın, `##61#` ile iptal.

### T3. Koşullu yönlendirme açıkken A **cevaplarsa** tetiklenmemeli
1. T2'deki yönlendirmeyi tekrar kurun.
2. B'den arayın, **A'yı 5 saniye içinde açın**. Asistan hiç devreye girmemeli.
3. Girerse kritik hata, hemen yazın.

### T4. Meşgul (C telefonu varsa)
1. A'da `**67*+90850XXXXXXX#`.
2. C'den A'yı arayın ve açın, **konuşmayı sürdürün**.
3. B'den A'yı arayın. Asistan açıyor mu?
4. İptal `##67#`.

### T5. Kapalı / ulaşılamıyor
1. A'da `**62*+90850XXXXXXX#`.
2. A'yı **uçak moduna** alın.
3. B'den A'yı arayın. Asistan açıyor mu? Kaç saniyede?
4. Uçak modunu kapatın, `##62#` ile iptal.

### T6. Telesekreter çakışması (en önemli gizli sorun)
1. A'da **telesekreteri açın** (operatörün kendi servisi).
2. `**61*+90850XXXXXXX**15#` kurun (cevapsız).
3. B'den arayın, A'yı açmayın. **Telesekreter mi karşıladı, asistan mı?**
4. Telesekreter karşılarsa yönlendirme hiç işlemez. Bu, müşterilerin çoğunda sorun olabilir. Yazın.
5. Türk Telekom sayfası "telesekreter ve yönlendirme aynı anda aktif olamaz" diyor, bu da teyit edilsin.

### T7. Hedef cevap vermezse caydırıcı etkisi (isteğe bağlı)
Koşullu yönlendirmenin güvenli düştüğünü doğrulamak için, **bağlı olmayan** bir numaraya (örneğin kapalı bir telefon) cevapsız yönlendirme kurun. B'den arayın, A'yı açmayın. Arayan ne duydu? (Meşgul tonu, operatör anonsu, sessizlik?)

### T8. Sabit hat (varsa)
Aynı T1 ve T2'yi sabit hattan deneyin. Operatör farklı kod isteyebilir, müşteri hizmetlerinden öğrenip yazın.

---

## 3. Sonuç tabloları (kopyalayıp doldurun)

**A. Kod ve davranış**

| | Turkcell | Vodafone | Türk Telekom | Sabit (varsa) |
|---|---|---|---|---|
| Hat türü, tarife | | | | |
| Numara biçimi kabul edildi (+90 / 0 / 8) | | | | |
| T1 koşulsuz çalıştı (✓/✗, hata mesajı) | | | | |
| T1 asistanın açma süresi (sn) | | | | |
| T2 cevapsız çalıştı | | | | |
| T2 süre ayarı (15 sn) doğru mu, asistan kaçıncı sn | | | | |
| T3 A açınca asistan girdi mi (olmamalı) | | | | |
| T4 meşgul çalıştı | | | | |
| T5 kapalı çalıştı | | | | |
| T6 telesekreter yönlendirmeyi engelledi mi | | | | |
| T7 hedef cevap vermeyince arayan ne duydu | | | | |
| İptal kodu çalıştı, `*#61#` ile doğrulandı | | | | |

**B. Ücret (ertesi gün)**

| | Turkcell | Vodafone | Türk Telekom |
|---|---|---|---|
| Yapılan yönlendirilmiş çağrı sayısı | | | |
| Faturada / kullanımda görünen satır | | | |
| Çağrı başına ücret (TL), "yönlendirme" ya da "arama" | | | |
| Dakikadan mı düştü, ayrı ücret mi | | | |
| Servis kurma ücreti var mıydı | | | |

**C. Arayan numarası (ben günlükten doldururum)**
Her çağrının saatini ve B numarasının son 4 hanesini yazın. Ben canlı veritabanındaki çağrı kaydıyla karşılaştırıp şunu söyleyeceğim: sistem **orijinal arayanı** mı (B) yoksa **yönlendiren hattı** (A) mı görüyor, her operatör için ayrı.

---

## 4. Sonuçları bana nasıl ilettirsiniz
1. Tabloları doldurun, test saatlerini yazın (yaklaşık dakika yeterli).
2. Ertesi gün ücret satırlarını ekleyin.
3. Bana yapıştırın. Ben: arayan numara karşılaştırmasını yapar, operatör matrisini `docs/` altına yazar ve sihirbazdaki kodları ve ücret notlarını bu sonuçlara göre günceller.

## 5. Sonuca göre kararlar
- **Arayan numara orijinal geliyorsa:** Panelde ve geri arama kayıtlarında müşterinin numarası doğru görünür, sorun yok.
- **Yönlendiren hat görünüyorsa:** Geri arama ve randevu SMS'i yanlış kişiye gitmesin diye asistan numarayı **her zaman sorup teyit etmeli** (şimdiki prompt zaten soruyor, ek önlem gerekmeyebilir).
- **Telesekreter engelliyorsa:** Sihirbazda "önce telesekreteri kapatın" adımı ve hangi operatörde nasıl kapatılacağı eklenir.
- **Turkcell ücreti doğrulanırsa (çağrı başına 13 TL):** Sitede ve sihirbazda somut maliyet gösterilir, kurumsal hat sahiplerine "operatörünüzle özel yönlendirme tarifesi görüşün" önerilir.
- **Vodafone ücretsiz ya da dakikadan düşüyorsa:** Operatör matrisine yazılır, müşteriye operatöre göre doğru bilgi verilir.
