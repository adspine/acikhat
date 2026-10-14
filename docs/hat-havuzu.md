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
- Ödemesi doğrulanmamış üyeye otomatik atama yapılmaz. Yönetici, Müşteriler > ⋮ > "Havuzdan hat ata" ile elle verebilir.
- Müsait numara 2'ye düşünce yöneticiye (günde en çok bir) uyarı gider. Her zaman en az 3 yedek tutun.

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
