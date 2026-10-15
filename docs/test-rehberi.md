# Satın almadan test rehberi

Amaç: ödeme, firma oluşturma, hat havuzu, e-postalar ve yönlendirme akışını **gerçek abonelik satın almadan** denemek. Dört katman var; soldan sağa gerçeğe yaklaşır, maliyet ve risk artar.

| Katman | Ne test eder | Ücret | Dış sistem | Süre |
|---|---|---|---|---|
| 1. Otomatik testler | Mantığın tamamı (sahte ElevenLabs/Polar/e-posta) | Yok | Hiçbiri | 30 sn |
| 2. Yerel test modu | Ekranlar ve akış, ücretsiz "ödeme" | Yok | Firebase girişi | 10 dk |
| 3. Canlı + Polar %100 indirim kodu | Gerçek Polar ödeme sayfası ve webhook, canlı sunucu | **0 TL** | Polar, Fly | 15 dk |
| 4. Sandbox + ayrı Fly uygulaması | Canlıya benzer ayrı ortam | Fly ücreti | Polar sandbox | yarım gün |

## Katman 1: otomatik testler (`npm test`)
Hiçbir dış sisteme gitmez, canlıyı etkilemez.
```
npm test                                   # hepsi (312 test)
npm test -- test/phone-pool.test.ts        # hat havuzu, atama, karantina, deneme numarası
npm test -- test/polar.test.ts             # ödeme webhook'ları, %100 indirimli sıfır tutarlı sipariş, yenileme, iptal
npm test -- test/journey.test.ts test/admin.test.ts   # üyelik ve yönetici akışı
```
Kapsadığı akışlar: ödeme webhook'u paketi ödenmiş yapar, firma oluşturulunca ödemiş üyeye numara atanır, ödemeyene atanmaz, havuz boşken yöneticiye uyarı, numara eklenince bekleyene atama, bırakma ve karantina, e-postalar, hizmet sonu silme, saklama süreleri.

## Katman 2: yerel test modu (`npm run dev:test`)
Güvenli ayarla yerelde ikinci bir sunucu açar:
- **Polar yok**, `PAYMENT_TEST_MODE=1`: "Ödemeyi tamamla" ücretsiz çalışır, paket ödenmiş sayılır.
- **Ayrı veritabanı** (`data/test-akis.db`), canlıya ve `data/app.db`'ye dokunmaz.
- **E-posta ve ElevenLabs kapalı** (anahtarlar boş): gerçek e-posta gitmez, gerçek asistan kurulmaz. Adres: http://localhost:8790

Adımlar:
1. `npm run dev:test`, tarayıcıda http://localhost:8790. Üye olun (Google ya da e-posta; yerelde çalışır).
2. Paket seçin, **Ödemeyi tamamla** (test modu, ücret yok), kurulum formunu doldurun.
3. Yönetici hesabıyla girin (`.env` içindeki `ADMIN_EMAILS` e-postası). Yönetim > **Başvurular** > başvuruyu açın > **Firma oluştur**.
4. Yönetim > **Hat havuzu** > "Numara ekle": `0850 300 00 01` gibi uydurma numaralar ekleyin. Hat bekleyen ödemiş firma varsa **kendiliğinden atanır**. Gerçek numara istemeden denemek için Müşteriler > ⋮ > **Deneme hattı ata (gerçek değil)**.
5. Terminalde `[e-posta:gönderilmedi]` satırlarını izleyin: gitmeyen e-postaların kime ve hangi konuyla gideceğini gösterir.
6. Sıfırlamak için: sunucuyu durdurun, `rm data/test-akis.db*`.

**Bu katmanda denenemeyenler:** ElevenLabs asistanı kurma ve hattı asistana bağlama (anahtar bilerek boş), "hat hazır" e-postası (asistan gerektirir), gerçek arama. Bunlar Katman 1'de sahte ElevenLabs ile test edilir.

## Katman 3: canlıda, ücret ödemeden gerçek akış (Polar %100 indirim)
Polar'ın belgesine göre toplamı sıfır olan siparişler kart istemeden hemen "ödenmiş" sayılır ve **"100% forever"** abonelikler kart sormaz ([siparişler](https://polar.sh/docs/features/orders), [indirimler](https://polar.sh/docs/features/discounts)). Böylece gerçek ödeme sayfası, webhook ve canlı sunucu denenir, hesabınıza tek kuruş yazılmaz. Webhook'umuz tutar alanlarına bağlı değildir ve sıfır tutarlı sipariş testi vardır.

**İndirim kodunu oluşturun** (Polar canlı panel > Products > Discounts):
- [ ] **Tür:** Percentage, **%100**
- [ ] **Süre:** **Forever** (aksi hâlde ilk yenilemede tam ücret çekilir!)
- [ ] **Kod:** tahmin edilemez, örn. `TEST-9f3k2x`
- [ ] **Ürün:** yalnızca **Açık Hat Başlangıç** (en ucuz)
- [ ] **Max redemptions:** 1, **Ends at:** yarın (kod sızsa bile bedava abonelik verilemez)

**Deneme:** Yeni bir üye (gerçek e-posta) > Başlangıç > Ödemeyi tamamla > Polar sayfasında **"İndirim kodu ekle"** > kodu girin > toplam $0, kart istemez.

**Ne olduğunu doğrulayın:**
```
fly logs -a acikhat-resepsiyon --no-tail | grep -E "polar\]|e-posta|hat-havuzu"
```
Beklenen satırlar: `[polar] üyelik ödendi: üye … → Başlangıç`, ardından kurulum formu adımı açılır. Firma oluşturduktan sonra `[e-posta:gönderilmedi] … Telefon hattınız hazır` (Resend bağlanana kadar e-postalar gönderilmez, günlükte görünür).

**Bittikten sonra temizlik (önemli):**
1. Aboneliği iptal edin: Panel > Paketim > **Aboneliği yönet** > iptal (ya da Polar panelinde Subscriptions).
2. **İndirim kodunu silin** ya da süresini bitirin.
3. Deneme firmasını silmek için firmayı askıya alıp `fly ssh console -C 'node scripts/erase-tenant.ts <firma-id> <firma-id>'` (firma kullanıcısı da silinir; Firebase hesabı kalır, zararsız).
4. Gerçek numara tüketmemek için **Deneme hattı** kullanın, havuza gerçek numara koymayın.

Sınırlar: Polar aynı e-postayı (artı takma adları yok sayarak) ve kartı tanır; ikinci deneme için başka bir e-posta ya da yeni kod gerekir. Bu test, **gerçek kartla ödeme** sayfasını denemez; onu bir kez gerçek 149 dolarlık ödemeyle (sonra iade) ayrıca yapmak gerekir.

## Katman 4: sandbox ve ayrı sunucu (gerekirse)
Canlıdan tamamen ayrı bir ortam: ayrı Fly uygulaması, ayrı veritabanı, Polar sandbox anahtarları ve webhook'u. Canlıdaki sunucu yalnızca canlı Polar'ın webhook gizli anahtarını tanıdığı için sandbox'ı aynı sunucuyla denemek mümkün değil. Yarım günlük kurulum ve küçük bir Fly ücreti. Katman 1-3 yetmediğinde düşünülür.

## Hangi soruyu hangi katman cevaplar?
| Soru | Katman |
|---|---|
| Ödemiş üyeye numara atanıyor mu, ödemeyene atanmıyor mu? | 1 |
| Karantina, yenileme uyarısı, stok uyarısı çalışıyor mu? | 1 |
| Yönetici ekranı doğru görünüyor mu? | 2 |
| Polar webhook'u canlıda paketi ödenmiş yapıyor mu? | 3 |
| Müşteriye "hat hazır" e-postası doğru metinle hazırlanıyor mu? | 1 (içerik), 3 (günlükte konu satırı) |
| Gerçek kartla ödeme sayfası çalışıyor mu? | 149 dolarlık gerçek ödeme (sonra iade) |
| Operatör yönlendirmesi çalışıyor mu? | `docs/operator-testi.md` |
| Gerçek arama asistanı karşılıyor mu? | Gerçek numara (mevcut demo hattı yeter) |
