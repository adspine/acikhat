# Polar.sh ödeme kurulumu

Polar "Merchant of Record"dur: kartı çeker, KDV/satış vergisini hesaplayıp öder, faturayı keser; bize payout yapar.
Ürünler **KDV dahil** (`tax_behavior: inclusive`) açılır, yani site/panel metinleri ("KDV dahil") doğru kalır.

## Akış
- Üyelik: `POST /api/auth/pay` → Polar ödeme sayfası → dönüşte site `?odeme=ok` ile bekler → `order.paid` webhook'u paketi ödenmiş yapar.
- Ek dakika: panelden satın al → ödeme sayfası → `order.paid` webhook'u dakikaları o dönemin kotasına ekler.
- Yükseltme: Polar aboneliği `proration_behavior=invoice` ile hemen güncellenir; düşürme `next_period` (ücretsiz, dönem başı).
- Yenileme: Polar kendisi her ay tahsil eder; müşteriye "ödemeniz alındı" e-postası gider (`order.paid`, `subscription_cycle`).
- Ödeme alınamadı (`past_due`): müşteriye uyarı e-postası, yöneticiye bildirim; Polar kartı yeniden dener, hizmet hemen kapanmaz.
- Abonelik sona erdi (`revoked`: iptal dönem sonu veya denemeler tükendi): firma **otomatik askıya alınır**, müşteriye e-posta gider. Ödeme gelince (`order.paid` yenileme / `subscription.active`) otomatik açılır. Yöneticinin elle askıya aldığı firma kendiliğinden açılmaz.
- Dönem sonunda iptal (`canceled`, `cancel_at_period_end`): müşteriye bitiş tarihiyle e-posta; hizmet dönem sonuna kadar açık.
- Panel > Paketim > "Aboneliği yönet": Polar müşteri portalı (kart değiştirme, iptal, makbuz).
- Paketi ödenmiş yapan **tek yer** imzası doğrulanmış webhook'tur (`src/http/polar-webhook.ts`).

## Kurulum (önce sandbox)
1. https://sandbox.polar.sh → organizasyon aç, payout hesabı bağla (Stripe Connect; Türkiye destekli).
2. Settings → Developers → **Organization Access Token** (products:read/write, checkouts:write, subscriptions:write, customer_sessions:write).
3. `POLAR_ACCESS_TOKEN=… POLAR_SERVER=sandbox node scripts/setup-polar.ts` → 6 ürünü açar, `fly secrets set POLAR_PRODUCTS=…` satırını yazar.
4. Settings → Webhooks → adres `https://acikhat.si/webhooks/polar`, olaylar: `order.paid`, `subscription.active`, `subscription.canceled`, `subscription.revoked`, `subscription.past_due`. Çıkan gizli anahtar = `POLAR_WEBHOOK_SECRET`.
5. `fly secrets set POLAR_SERVER=sandbox POLAR_ACCESS_TOKEN=… POLAR_WEBHOOK_SECRET=… POLAR_PRODUCTS=…` → test kartı 4242 4242 4242 4242 ile dene.
6. Aynısını production Polar'da tekrarla (`POLAR_SERVER=production`), `PAYMENT_TEST_MODE` boş kalsın.

Polar secret'ları boşsa ödeme kapalıdır (`PAYMENT_TEST_MODE=1` yalnızca ücretsiz test içindir).

## Bilinen sınırlar
- Kota dönemi takvim ayı; Polar yenilemesi satın alma gününe göre. Yükseltme farkını Polar kendi döngüsüne göre hesaplar, panelde gösterilen "bu ay için fark" tahmindir.
- Ödeme sayfasında müşterinin ülkesine göre yerel para birimi gösterilebilir; tahsilat USD fiyatı esas alır.
