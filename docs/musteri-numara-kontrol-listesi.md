# Asistan numaranızı Netgsm'den alın (kontrol listesi)

*Bu belge, sitedeki `#/numara-al` rehberinin yazdırılabilir kontrol listesidir; ana kaynak site sayfasıdır. Netgsm ekranlarındaki alan adları, belge listesi, süre ve ücret Netgsm tarafından değiştirilebilir. Netgsm'in yayımlanmış sayfalarında belirtilmeyen yerler `[BELİRSİZ]` ile işaretlidir.*

## 1. Model
- **Her müşteri asistan numarasını (0850 ya da şehir kodlu sabit hat) Netgsm'den kendi adına alır.** Açık Hat numara satmaz, kiralamaz, havuz tutmaz.
- Numara müşterinindir: Netgsm ile sözleşmeyi o yapar, yıllık ücreti (Netgsm'in 0850 sayfasında 249 TL, taahhüt yok; güncel ücreti Netgsm ekranından teyit edin) doğrudan Netgsm'e öder. Hizmeti bıraksa da numara onda kalır.
- Müşteri numarayı iki şekilde kullanabilir: **ana numara** (web sitesi, Google profili, kartvizit) ya da **yönlendirme hedefi** (mevcut numarasını açamadığında bu numaraya yönlendirir; çağrı başına operatör ücreti çıkabilir).
- Neden müşteri başvurur: kimlik/vergi/adres belgeleri ve e-Devlet ya da mobil onay yetkilinin kendisindedir (KVKK, belgeler bize gelmez); numara tahsis edildiği abonenin kendisi tarafından kullanılmalıdır; bizim adımıza alınan numara üçüncü kişiye kullandırma sorunu doğurur (arşivdeki `docs/arsiv/hat-havuzu.md` analizi).

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
Açık Hat hesabınıza girin; kurulum ekranının **3. adımında** (formda numara yazmadıysanız bu adım otomatik açılır) şunları gönderin:
- [ ] Numaranız (0850 ya da sabit hat; cep numarası olmaz)
- [ ] Abonelik türü: ön ödemeli / faturalı
- [ ] "SIP yönlendirme ayarını yaptım" onayı
- [ ] "Numara benim adıma kayıtlı, şifremi paylaşmam gerekmiyor" onayı
- [ ] **SIP kullanıcı adı ve şifrenizi bize göndermeyin.** Asistanın gelen çağrıları karşılaması için gerekmez.

Gönderince 4. adıma ("onay bekleniyor") geçersiniz; biz kontrol edip numarayı asistana bağlarız ve e-posta göndeririz.

## 5. Netgsm'de çağrıyı Açık Hat'a yönlendirin
Kaynak: Netgsm bilgi bankası, "ElevenLabs ile Yapay Zekâ Çağrı Entegrasyonu". Netgsm **Online İşlemler** (portal.netgsm.com.tr) > **Ses Hizmeti** > **Ayarlar** > **SIP Bilgileri** > **Detay**:
- [ ] **SIP Trunk Bilgileri** alanına `sip.rtc.elevenlabs.io` yazın.
- [ ] Protokol olarak **TCP** seçin. (Port sayfada belirtilmemiş `[BELİRSİZ]`; arayüz istemezse yazmayın.)
- [ ] **SIP Trunk Ayarlarını Kaydet** düğmesine basın, telefonunuza gelen doğrulama kodunu girin.
- [ ] **Aranan Prefix** alanında **+90** seçin, **Prefix Ayarlarını Kaydet** düğmesine basın.
- [ ] Netgsm'in ElevenLabs rehberindeki *SIP Trunk şifresi* adımı bizim kurulumumuzda **gerekmez**; şifreyi bize vermeyin.

`[BELİRSİZ]` Bu ayarın hesaptaki diğer numaraları etkileyip etkilemediği Netgsm sayfalarında yazmıyor; başka işte kullanılan numarası olan müşteriye Netgsm'e sormasını ya da asistan için ayrı abonelik açmasını söyleyin.

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
1. **Başvuru gelince:** Yönetim > Başvurular > başvuruyu açın. Müşterinin bildirdiği numara, abonelik türü ve SIP onayı çekmecede görünür. **Onayla ve firmayı oluştur** numarayı firmaya yazar (alanı doldurursanız o numara yazılır). Numara başka bir firmada kayıtlıysa firma oluşmaz ve hata mesajı hangi firma olduğunu söyler.
2. **Asistanı kurun** (Müşteriler > Asistanı kur): numara ElevenLabs'e SIP trunk olarak bağlanır; başvuruyla gelen firmaya "Numaranız asistana bağlandı" e-postası bir kez gider.
3. **Doğrulayın:** numarayı arayın; asistan açmalı. Açmazsa Netgsm SIP ayarı (adres, TCP, +90) ya da etkinleşme eksiktir; müşteriye yazın.
4. **Numarayı değiştirme talebi:** müşteri panelinden talep gelir (yöneticiye e-posta). Doğrulayın, Müşteriler > Yönet'te numarayı değiştirin; kaldırılan numara ElevenLabs'ten silinir.
5. **Gelen SIP kapısı (P0):** ElevenLabs'te numaraların izin listesi açıksa (0.0.0.0/0) aynı risk geçerlidir. Netgsm TCP kullandığı için izin listesi çalışır; Netgsm'in kaynak IP'leri doğrulanınca listeyi kısıtlayın. Yanlış IP çağrıları düşürür, doğrulamadan yazmayın.
6. **İnsana aktarma (giden bacak) müşterinin numarasında çalışmayabilir:** ElevenLabs'e girilen giden SIP kimliği bizim Netgsm hesabımızdır; operatör müşterinin numarasını arayan numara olarak kabul etmeyebilir `[DOĞRULA]`. Aktarma çalışmazsa geri arama kaydına düşürün. Müşterinin SIP şifresini tutmayız.
7. **Hizmet sonu:** hesap kapanırken `scripts/erase-tenant.ts` asistana bağlı numaraları listeler; ElevenLabs panelinden bağlantıyı kaldırın. Numara müşterinin Netgsm aboneliğinde kalır.
