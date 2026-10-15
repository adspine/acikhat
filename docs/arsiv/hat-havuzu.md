> **ARŞİV (terk edilen model).** Açık Hat artık numara havuzu tutmaz: her müşteri numarasını kendi Netgsm aboneliğinden alır (rehber sayfası `#/numara-al`, kontrol listesi `docs/musteri-numara-kontrol-listesi.md`). Bu belge, havuz modelinin hukuki ve sözleşmesel değerlendirmesini (Netgsm sözleşme maddeleri 4.3, 4.7, 4.10, 4.11) tarihçe için saklar. Havuz kodu kaldırıldı.

# Hat havuzu: kurulum, işleyiş ve hukuki çerçeve

Model: Netgsm'den **biz** 0850 numaraları alırız (tek hesap, havuz). Her firmaya bir numara atanır ve bu numara yalnızca müşterinin kendi hattından yaptığı **çağrı yönlendirmesinin hedefidir**. Müşteri numarayı yayınlamaz, satın almaz, devralamaz. Panel: Yönetim > **Hat havuzu**.

## 1. Netgsm'den numara alma (elle)
Netgsm'de numara siparişi için API uç noktası bulamadık; alım elle yapılır.
1. https://www.netgsm.com.tr üzerinden yeni abonelik: kullanıcı doğrulama (SMS), yetkili bilgisi, adres, **numara türü: 0850**, e-Devlet ya da mobil uygulamayla sözleşme onayı, belge yükleme, ödeme. Belge listesi Netgsm'in ayrı sayfasında; şahıs işletmesi için vergi levhası ve imza beyanı istenebilir (üçüncü taraf kaynak, Netgsm sayfası belirtmiyor).
2. Netgsm bilgi bankası "Her yeni Netgsm numarası için yeni bir abonelik başvurusu yapılmak zorundadır" diyor, aynı sayfada "Numara Ekle" seçeneği de var. Çelişkiyi Netgsm'e yazılı sorun; toplu alımda tek başvuruyla kaç numara alınabildiğini öğrenin.
3. **Abonelik türü:** "Ön ödemeli" seçmek, yetkisiz kullanımda (arama dolandırıcılığı) mali kaybı bakiyeyle sınırlar. "Faturalı" sınırsız borç doğurabilir.
4. Netgsm Web Portal > Ses Hizmeti > Ayarlar > **SIP Bilgileri**: SIP Trunk'ı etkinleştirin. IP/alan adı `sip.rtc.elevenlabs.io`, port `5060`, aranan prefix `+90`. Alan tek olduğundan büyük olasılıkla hesap genelinde geçerli (yeni numara otomatik yönlenir); **yazılı teyit isteyin.**
5. Numarayı Hat havuzu sayfasından ekleyin; sipariş numarasını not, yıllık yenileme tarihini tarih alanına yazın.

## 2. Atama (otomatik)
- Firma oluşturulurken (Başvurular > Firma oluştur), üyenin ödemesi doğrulanmışsa havuzdan en eski müsait numara atanır.
- Asistan kurulunca numara ElevenLabs'e bağlanır ve müşteriye "hattınız hazır" e-postası gider (numara başına bir kez).
- Havuz boşsa firma "hat bekliyor" kalır, yöneticiye e-posta gider; numara eklenince bekleyen firmaya kendiliğinden atanır.
- **Numarayı elle girmek için:** Başvurular > başvuruyu aç > **"Telefon hattı (isteğe bağlı)"** alanı. Doluysa havuzdan otomatik atama yapılmaz; havuzda müsaitse o numara atanır, havuz dışıysa (örneğin müşterinin kendi aldığı numara) elle kalır. Hatalı, başka firmada ya da karantinada olan numarada firma oluşmaz. Firma oluşunca sonuç (atandı, bağlandı, havuz boş) aynı ekranda görünür. Sonradan değiştirmek için Müşteriler > Yönet.
- Ödemesi doğrulanmamış üyeye otomatik atama yapılmaz. Yönetici, Müşteriler > ⋮ > "Havuzdan hat ata" ile elle verebilir.
- Müsait numara 2'ye düşünce yöneticiye (günde en çok bir) uyarı gider. Her zaman en az 3 yedek tutun.

## 2b. Deneme numarası (canlı satın alma akışını denemek için)
Gerçek numara almadan akışı (ödeme, firma oluşturma, asistan kurma, "hat hazır" e-postası) denemek için: Müşteriler > ⋮ > **"Deneme hattı ata (gerçek değil)"**. Numara sanaldır (`0850 999 xxxx`): ElevenLabs'e bağlanmaz, arama karşılamaz, e-postası `[DENEME]` etiketli gelir. Otomatik atama hiçbir zaman deneme numarası seçmez (gerçek müşteri sanal numara almaz); deneme numarası stok sayısına katılmaz. Bırakılınca karantinaya girmeden silinir. Gerçek arama testi için gerçek bir numara gerekir.

## 3. Bırakma ve karantina
**Karantina:** Bırakılan numara 180 gün kimseye verilmez. Neden: eski müşterinin telefonu hâlâ o numaraya yönlendiriyor olabilir; hemen başkasına verilirse onun arayanları yeni firmaya düşer (yanlış firma ve gizlilik sorunu). 180 gün dolunca numara yeniden müsait olur. Bırakma anında numara firmadan ve ElevenLabs'ten kaldırılır.
- Hizmeti biten firma için: `scripts/erase-tenant.ts` numarayı otomatik karantinaya alır; ElevenLabs asistanı, Google Takvim erişimi ve Polar aboneliği elle kapatılır.
- Netgsm'de aboneliği bırakılan numara "Emekli et" ile havuzdan kalıcı çıkarılır.

## 4. Yenileme (önemli)
Netgsm kurumsal sabit telefon sözleşmesi (Rev. v4.4) madde 4.7'ye göre abonelik, iptal ya da durdurma bildirimi yapılmazsa aynı süre için **otomatik yenilenir**. Ön ödemeli hesapta bakiye yetersizse numara/hizmet durabilir; durursa o numaraya yönlendiren müşterilerin çağrıları kaybolur. Yenileme tarihini panelde tutun (30 gün önce uyarı gelir), bakiyeyi kontrol edin.

## 5. Yasal sorumluluk: kimde?
*Hukuki tavsiye değildir; ölçeklenmeden önce bir avukata ve mali müşavire doğrulatın.*

**Netgsm karşısında: abone, yani sözleşmeyi onaylayan siz.** Netgsm sözleşmesi (Rev. v4.4) ve bilgi bankası:
- Numara, tahsis edildiği aboneye aittir ve o abone tarafından kullanılmak zorundadır; numarayla ilgili tüm hukuki işlemlerden sözleşmeyi onaylayan firma sorumludur (bilgi bankası, Yeni Abonelik).
- 4.3: Kullanımdan kaynaklanan her türlü erişim, zarar ve ziyandan abone sorumludur; Netgsm hattı görüşmelere kapatabilir.
- 4.4: Hat ve web şifresiyle yapılan tüm işlemler abonenin sorumluluğundadır.
- **4.10: "ABONE, NETGSM'den aldığı hizmeti yaptığı işin gereği dışında ticari amaçlarla üçüncü kişilere sunamaz."** İhlalde Netgsm sözleşmeyi feshedebilir ya da hizmeti kısıtlayabilir.
- 4.11: Sözleşme Netgsm'in muvafakati ve yeni sözleşme olmadan başkasına devredilemez; borçlar devreden ve devralanın müştereken ve müteselsilen sorumluluğundadır.

**Bunun bizim modelimizdeki karşılığı:**
- Numaralar bizim adımıza, bizim hizmetimizin (yapay zekâ telefon asistanı) bir parçası olarak kullanılır: yazılımın teknik uç noktasıdır. Müşteriye telefon hattı ya da numara **satmıyoruz**, müşteri numarayı yayımlamıyor ve devralamıyor. Bu, 4.10'daki "yaptığı işin gereği" kapsamında savunulabilir, ama **kesin değildir**: Netgsm, birden çok işletme için kullanımı "üçüncü kişiye sunma" sayabilir. **Netgsm'den bu kullanım için yazılı onay alın** (aşağıdaki şablon).
- Müşterinin kendi numarasını yayımlayıp yapay zekâyı ana hat yapmak istediği durumda (BYO) numarayı müşteri **kendi** Netgsm hesabında alır; böylece numara satışı/kullandırma sorusu doğmaz.
- Çağrı kaydı, aydınlatma ve KVKK: müşteri veri sorumlusu, biz veri işleyen (Kullanım koşulları madde 9). Görüşme başında yapay zekâ olduğu ve kaydın yapıldığı söylenir.
- Giden aramalar (landing "Beni arayın" ve insana aktarma) 0850 numarasından çıkar: istenen ve onaylanan arama olmalı, onay kaydı tutulmalı (ticari elektronik ileti kuralları). Dolandırıcılık riskine karşı ön ödemeli abonelik ve giden arama sınırları.
- **Kişisel sorumluluk:** Şahıs işletmesinde işletme ile kişi hukuken aynıdır: Netgsm borçları, zararlar ve cezalardan malvarlığınızla sorumlusunuz. Müşteri sayısı arttığında sınırlı sorumlu bir şirket (örneğin tek ortaklı limited) kurmayı mali müşavirinizle değerlendirin. Numaralar sonradan Netgsm'in muvafakati ve yeni sözleşmeyle şirkete devredilir (4.11); bu yüzden ilk havuzu küçük tutmak (5 numara) devri kolaylaştırır.
- BTK Numaralandırma Yönetmeliği'nin ilgili maddelerini (tahsis ve kullanım şartları) tam metinden okumadık; yalnızca özet kaynaklara baktık. Avukatınızdan doğrulayın.

### Netgsm'e yazılı soru şablonu
> Merhaba, yapay zekâ destekli telefon karşılama yazılımı (SaaS) sunuyorum. Müşterilerimin kendi telefonlarından yaptığı çağrı yönlendirmesinin hedefi olarak, tarafıma tahsisli birkaç 0850 numarasını kullanıyorum. Numaralar benim abonelik sözleşmem kapsamındadır, müşteriye satılmaz, yayımlanmaz ve devredilmez; yalnızca yazılımımın teknik uç noktasıdır. Sözleşmenin 4.10 maddesi açısından bu kullanımın uygun olduğunu yazılı olarak teyit eder misiniz? Ayrıca: (1) SIP Bilgileri hesap genelinde mi, yeni numara otomatik yönleniyor mu, (2) arama kaynağı IP aralıklarınız ve TCP/TLS desteği, (3) SIP trunk ve eşzamanlı çağrı ücreti, (4) toplu numara başvurusu ve belge süreci, (5) yenileme ve bakiye uyarısı.

## 6. Güvenlik notu
ElevenLabs'teki gelen arama kapısı şu an herkese açık (`0.0.0.0/0`, kimlik doğrulama yok). Netgsm'in SIP kaynak IP'lerini öğrenip izin listesi koymadan (yalnızca TCP/TLS'te çalışır) havuzu büyütmeyin. IP'ler bilinmeden listeyi koymak tüm gerçek çağrıları düşürür.

## 7. Operatör karşılaştırması: Netgsm ve Verimor (Ekim 2026)
Kaynaklar operatörlerin kendi sayfalarıdır, bağımsız doğrulama değildir. "Belirtilmemiş" yazan her hücre, yazılı sorulacak bir sorudur.

| Konu | Netgsm | Verimor |
|---|---|---|
| 0850 yıllık ücret | 249 TL (bazı sayfalarda 191 TL), kurulum ücreti yok | 229 TL, kurulum ücretsiz. Özel numaralar ücretli, tutarı belirtilmemiş |
| Taahhüt | Yok, istenince bırakılır, kalan ayların iadesi | Sözleşmede "1 yıl" ibaresi var ama taahhüt yok |
| Gelen çağrı | Numara sahibi ücret ödemez, arayan öder | Numara sahibi ücret ödemez, arayan öder |
| SIP ile IP/alan adına yönlendirme | Var: Web Portal > Ses Hizmeti > Ayarlar > SIP Bilgileri. Alanlar: IP, port, arayan ve aranan prefix | SIP trunk oluşturma var (VAPI rehberinde) |
| Yapay zekâ platformu rehberi | **VAPI rehberi var.** Numara +90 biçiminde, aranan prefix `+90`, sunucu `sip.netgsm.com.tr` / `185.88.7.189` | VAPI rehberi var. Netgsm'in aksine kimlik bilgisi (kullanıcı adı, şifre) üzerinden kurulum anlatılıyor |
| ElevenLabs ile | **Canlıda çalışıyor** (kendi kurulumumuz) | Denenmedi |
| Eşzamanlı gelen çağrı | Sınırsız, arayan sırada bekler, meşgul tonu duymaz | "Ölçeklenebilir kapasite", sayı yok |
| Numara taşıma (içeri) | 0850 ve coğrafi numara taşınabilir, koşul ve süre belirtilmemiş. Şikâyetvar'da 850 numara devrinin 4 ayda tamamlanamadığına dair bir şikâyet var (tek örnek) | Taşıma ücretsiz, taşınan numara yıllık 129 TL |
| Şahıs işletmesi | Başvuru formu var, belge listesi sayfada yok | **Belge listesi açık** (yetkili ve vekil için ayrı, bkz. aşağıdaki not) |
| Vekil başvuru | Formda "Yetkili / Vekil" alanı var | Vekil için ıslak imzalı sözleşme, hat açma/kapama yetkili vekâletname, vergi levhası, banka doğrulaması |
| İş ortaklığı / bayilik | "Satış Ortaklığı ve Bayilik" sözleşmesi var, 1000+ bayi iddiası. **Numaraya uygulanıp uygulanmadığı belirtilmemiş** | "İş Ortaklığı": teknoloji sağlayıcıları, 0850 dahil, gelir paylaşımı (oran yok). Şartlar belirtilmemiş |
| Üçüncü kişiye kullandırma | Sözleşme 4.10: yaptığı işin gereği dışında ticari amaçla üçüncü kişilere sunamaz | SSS'de belirtilmemiş. **Sözleşme metni okunmadı** |
| API | Netgsm API'leri var. **Numara sipariş API'si bulunamadı** | Açık API (developer.verimor.com.tr). Müşteri/numara oluşturma kapsamı belirtilmemiş |
| Güvence / itibar | Şikâyetvar'da bayilik ve taşıma şikâyetleri (anekdot) | Bağımsız itibar bilgisi bulunamadı. 2018 tarihli firma haberinde İstanbul ve Ankara'da yedekli altyapı (tanıtım) |

**Verimor şahıs işletmesi belgeleri (kendi SSS'leri):** Yetkili işlem yapıyorsa: abonelik sözleşmesi, yetkili kimlik fotokopisi, imza beyannamesi fotokopisi, güncel vergi levhası, e-Devlet yerleşim yeri belgesi. Vekil işlem yapıyorsa: ıslak imzalı sözleşme, vekil kimlik fotokopisi, varsa imza beyannamesi, hat açma/kapama yetkisi içeren vekâletname, vergi levhası, banka havale/EFT doğrulaması, vekil yerleşim yeri belgesi.

### Bu tablodan çıkanlar
1. **Fiyat belirleyici değil.** Fark yılda 20 TL civarı. Seçim, **kullandırma şartı, numaranın kimin adına açıldığı, API ve kaynak IP** üzerinden yapılmalı.
2. **Netgsm'in belgelediği model, müşterinin kendi hesabındaki numarayı yapay zekâ platformuna bağlamasıdır** (VAPI rehberi: "BYO SIP Trunk Number"). Yani C2 (müşteri kendi başvurur) Netgsm'in öngördüğü kullanım. Numara havuzu modelimiz (A) rehberde anlatılan kalıp değil.
3. Netgsm'in rehberindeki sunucu adresi `185.88.7.189`, Netgsm'in kaynak IP'si olabilir. **Doğrulanmadan ElevenLabs izin listesine yazmayın**: yanlış IP tüm gerçek çağrıları düşürür.
4. **Mevcut kurulumumuz Netgsm'de çalıştığı için Netgsm ile devam, Verimor yedek aday.** Verimor'un ElevenLabs ile çalıştığı bilinmiyor, numara tahsisi ve ortaklık şartları öğrenilmeden geçiş yapılmaz.

### Karar kapısı (yazılı yanıtlara göre)
| Yanıt | Karar |
|---|---|
| Netgsm 4.10'a yazılı onay verirse | A ile devam (havuz), C2 isteyen müşteriler için seçenek |
| Netgsm ya da Verimor ortaklık/bayilik modeli sunar (numara operatör adına, alt hesap, API) | **B**: ortaklıkla geç, otomasyon (H4) mümkün olur |
| Netgsm reddeder ya da belirsiz kalır, ortaklık yok | **C2** (aşağıdaki kontrol listesi) ve santralli müşteriler için D |

### Yazılı sorulara eklenecekler (Netgsm ve Verimor'a aynı)
> 6. Yazılım şirketi (şahıs işletmesi) olarak iş ortaklığı/bayilik başvurabilir miyim? Numara kimin adına açılır (operatör, ortak, müşteri)? Müşterilerime alt hesap açılabiliyor mu ve numara API ile atanabiliyor mu?
> 7. Müşterimin aldığı numarayı (kendi hesabında) benim yazılımımın SIP uç noktasına yönlendirmesi uygun mu? Tek ortak hesapta çok müşteri için numara kullanılabilir mi?
> 8. Çağrının sizden bize hangi kaynak IP aralığından, hangi taşıma (TCP/UDP/TLS) ve kimlik doğrulamayla geldiği (izin listesi için)?
> 9. Yeni 0850 için toplu başvuruda belge süreci ve aktivasyon süresi; "her yeni numara için yeni abonelik başvurusu" kuralı toplu alımda geçerli mi?

## 8. Müşterinin kendi numarasını almasını isteyen müşteriler (C2)
Müşteriye verilecek kontrol listesi: `docs/musteri-numara-kontrol-listesi.md`. Açık Hat tarafında yapılacaklar o belgenin sonunda.
