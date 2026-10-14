# Kendi 0850 numaranızı alın ve Açık Hat asistanına bağlayın

*Taslak. Netgsm ekranlarındaki alan adları ve belge listesi değişebilir; bu belgeyi müşteriye vermeden önce bir kez kendiniz (ya da deneme hesabıyla) adım adım deneyin. Doğrulanmamış yerler `[DOĞRULA]` ile işaretlidir.*

## 1. Bu yol kime uygun?
- Asistanı **ana numara** yapmak isteyenler: web sitenizde, Google profilinizde ve kartvizitte yayınlayacağınız bir numara.
- Çok çağrı alıp operatörün **yönlendirme ücretinden** (örneğin Turkcell'de çağrı başına ücret) kaçınmak isteyenler.
- Numaranın **sahibi olmak** isteyenler.

**Bu yolda numara sizindir:** Netgsm ile sözleşmeyi siz yaparsınız, yıllık ücreti (yaklaşık 249 TL) doğrudan Netgsm'e ödersiniz, Açık Hat size numara satmaz. Asistan hizmetini bırakırsanız numara sizde kalır.

Bu yol sizin için ağır geliyorsa, Açık Hat'ın hazır numarasıyla çağrı yönlendirme (mevcut numaranız değişmeden) daha hızlıdır: kontrol listesine gerek yoktur.

## 2. Başlamadan önce hazırlayın (yaklaşık 15 dakika)
- [ ] **Sözleşmeyi imzalayacak kişi** (şirket yetkilisi ya da şahıs işletmesi sahibi). Başvuruyu bu kişi yapar; onay SMS ve e-Devlet ya da mobil uygulama ile onun telefonunda yapılır.
- [ ] **Şahıs işletmesi için tipik belgeler** `[DOĞRULA: Netgsm kendi ekranında listeler]`: kimlik fotokopisi, imza beyannamesi fotokopisi, güncel vergi levhası, e-Devlet yerleşim yeri belgesi.
- [ ] **Şirket için tipik belgeler** `[DOĞRULA]`: vergi levhası, imza sirküleri, ticaret sicil gazetesi, yetkilinin kimliği ve yerleşim yeri belgesi.
- [ ] Belgelerin okunaklı **PDF ya da fotoğrafı** (Netgsm ekranı hepsinin eksiksiz yüklenmesini şart koşar).
- [ ] **Ödeme yöntemi** (kart). **"Ön ödemeli"** abonelik türünü seçmenizi öneririz: yetkisiz kullanımda kaybınız bakiyeyle sınırlı kalır.
- [ ] Netgsm'de **sizin adınıza** abone olunduğunu, vekil kullanacaksanız noter onaylı vekâletname gerekeceğini bilin. Vekil yolu uzun ve masraflıdır, mümkünse yetkilinin kendisi başvursun.

## 3. Netgsm'de başvuru (adım adım)
Başvuru: **netgsm.com.tr** > yeni abonelik. Adımlar Netgsm bilgi bankasındaki sıraya göredir.
1. [ ] **Kullanıcı doğrulama:** ad, soyad ve cep telefonu; SMS ile gelen kodu girin.
2. [ ] **Yetkili bilgisi:** abonelik türü, kurum türü (şahıs işletmesi / şirket), sözleşmeyi imzalayacak yetkili.
3. [ ] **Adres:** aboneliğin kurulacağı adres (vergi levhasındaki adresle uyumlu olsun).
4. [ ] **Numara türü ve numara:** **0850** (ya da şehir kodlu numara: Bolu için 0374, İstanbul için 0212). Başvuruyu tamamlayın.
5. [ ] **Sözleşme onayı:** SMS ile gelen bilgilerle e-Devlet ya da mobil uygulamadan sözleşmeyi onaylayın.
6. [ ] **Belgeleri yükleyin** (eksiksiz).
7. [ ] **Ödeme** yapın. Abonelik türü olarak "Ön ödemeli" seçin.
8. [ ] **Aktivasyonu bekleyin.** Süre Netgsm sayfasında belirtilmemiştir `[DOĞRULA]`. Numara aktifleşince Netgsm size bilgi verir.

## 4. Numarayı bize bildirin
Numara aktif olunca **support@acikhat.si** adresine şunu yazın: *firma adınız + yeni 0850 numaranız*.
- [ ] **SIP kullanıcı adı ve şifrenizi bize göndermeyin.** Asistanın gelen çağrıları karşılaması için gerekmez.
- [ ] Biz numarayı asistanınıza bağlayıp size **"bağlandı"** diye haber vereceğiz. **Bu haberi almadan 5. adıma geçmeyin.**

## 5. Netgsm'de çağrıyı Açık Hat'a yönlendirin
Netgsm **Web Portal** > **Ses Hizmeti** > **Ayarlar** > **SIP Bilgileri**:
- [ ] **SIP Trunk** özelliğini etkinleştirin.
- [ ] **IP / alan adı:** `sip.rtc.elevenlabs.io`
- [ ] **Port:** `5060`
- [ ] **Arayan prefix:** `0`
- [ ] **Aranan prefix:** `+90`
- [ ] **"SIP Trunk Ayarlarını Kaydet"** ve ardından **"Prefix Ayarlarını Kaydet"** düğmelerine basın.

`[DOĞRULA]` Bu ayarlar hesap genelindedir; birden fazla numaranız varsa hepsi aynı yere gider.

## 6. Deneyin
- [ ] Başka bir telefondan yeni numarayı arayın. Asistan "…, merhaba. Ben yapay zekâ asistanı…" diye karşılamalı.
- [ ] Asistan açmazsa aşağıdaki sorun giderme tablosuna bakın.
- [ ] Test için randevu isteyin, panelde (Randevular ve Çağrılar) görünüp görünmediğini kontrol edin.

## 7. Numarayı nasıl kullanacaksınız?
- **Yalnızca yönlendirme hedefi:** mevcut numaranızı açamadığınızda bu numaraya yönlendirin. Müşterileriniz yine eski numarayı arar.
- **Ana numara:** yeni numarayı web sitenize, Google İşletme Profiline, sosyal medyaya ve kartvizite koyun. Bu durumda çağrıları önce asistan karşılar, gerektiğinde size aktarır.

## 8. Maliyet ve sorumluluklar (kısa)
| | |
|---|---|
| Numara ücreti | Yıllık yaklaşık 249 TL (Netgsm sayfalarında 191 TL de geçiyor). **Doğrudan Netgsm'e** ödenir |
| Yenileme | Abonelik iptal edilmezse **otomatik yenilenir** (Netgsm sözleşmesi). Ön ödemeli hesapta **bakiyeniz yetersizse numara durabilir** ve çağrılar kaybolur |
| Sözleşme | Sizinle Netgsm arasındadır. Numara ve kullanımdan doğan yükümlülükler aboneye (size) aittir |
| Açık Hat ücreti | Asistan hizmet bedeli aynıdır; numara için ayrıca ücret almayız |
| Hizmeti bırakırsanız | Numara sizde kalır, taşıyabilir ya da kapatabilirsiniz |

## 9. Sorun giderme
| Belirti | Olası neden | Ne yapmalı |
|---|---|---|
| Başvuru "belge eksik" diyor | Belge okunaksız ya da eksik | Netgsm ekranındaki listeyle karşılaştırın, tekrar yükleyin |
| Numara aktif olmadı | Belge incelemesi sürüyor | Netgsm destek hattından başvuru durumunu sorun |
| Aradığımda asistan açmıyor, çağrı düşüyor | Açık Hat tarafı henüz bağlamadı | support@acikhat.si adresine "numaram bağlandı mı?" yazın |
| Asistan başka bir işletmenin adıyla açıyor ya da hata veriyor | Numara yanlış firmaya bağlı | Bize yazın, numarayı düzeltiriz |
| Netgsm'de kaydettim ama çağrı hiç gelmiyor | Aranan prefix `+90` değil ya da trunk etkin değil | 5. adımı tekrar kontrol edin, "Prefix Ayarlarını Kaydet"e bastığınızdan emin olun |
| Numara bir süre sonra çalışmıyor | Yıllık ücret yenilenmedi, bakiye bitti | Netgsm hesabında bakiyeyi ve abonelik durumunu kontrol edin |

## 10. Bize iletilecek bilgi
- Firma adı: ………………………
- Yeni 0850 numarası: ………………………
- Netgsm'deki abonelik türü (ön ödemeli / faturalı): ………………………
- Yıllık yenileme tarihi: ………………………

---

## Açık Hat tarafında yapılacaklar (iç not, müşteriye verilmez)
1. **Numarayı firmaya elle tanımlayın:** Yönetim > Müşteriler > Yönet > "Asistanın karşıladığı numaralar" alanına yazın ve kaydedin. Numara ElevenLabs'e otomatik bağlanır (asistan kuruluysa). Müşteriye "bağlandı" e-postası elle gönderilir; havuz e-postası bu yolda çalışmaz.
2. **Müşteri numarası havuza girmez** (havuz yalnızca bizim numaralarımız içindir). Havuz stoğunu etkilemez, karantina uygulanmaz.
3. **Gelen SIP kapısı** (ElevenLabs izin listesi) açıksa aynı risk geçerlidir. Netgsm kaynak IP'leri doğrulanınca izin listesine yazın.
4. **İnsana aktarma (giden bacak) bu numarada çalışmaz:** ElevenLabs'e girilen giden SIP kimliği **bizim** Netgsm hesabımızdır; müşterinin numarası bizim hesabımızdan arayan numara olarak büyük olasılıkla kullanılamaz (operatörler arayan numara doğrulaması ister) `[DOĞRULA]`. İlk sürümde bu müşteriler için **aktarmayı kapatıp geri arama kaydına** düşürün. Müşterinin kendi SIP şifresini bizde tutmak güvenlik ve sorumluluk yükü getirir, karar verilmeden yapılmaz.
5. **Müşteri hesabı kapanınca:** numarayı firmadan kaldırın (Yönet), ElevenLabs'ten silinmesi için Hat havuzu dışı olduğundan `phone/connect` yerine ElevenLabs panelinden elle kaldırın. Numara müşterinindir, karantina yok.
6. **Yetkili kişi doğrulaması:** Müşterinin gerçekten numaranın sahibi olduğunu (Netgsm onay SMS'i ya da sözleşme ekranı görüntüsü) kayıt altına alın.
