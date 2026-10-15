# Sesli AI Resepsiyonist: Backend

ElevenLabs Agents üzerinde çalışan Türkçe spa resepsiyonistinin araç (tool) ve webhook sunucusu.
Proje kararları: `sesli_ai_resepsiyonist_proje_ozeti.md`. Analiz ve eklenen noktalar: `docs/ANALIZ.md`.

## Çalıştırma

```bash
cp .env.example .env      # gizli değerleri doldur
npm install
npm test                  # slot motoru + API + webhook testleri
npm run dev               # http://localhost:8787
npm run agent:build demo-spa   # build/agents/demo-spa.agent.json üretir
```

Gereksinim: Node 26+ (Temporal ve `node:sqlite` yerleşik, TypeScript derlemeden çalışır).

## Klasörler

| Yol | İçerik |
|---|---|
| `src/domain/slots.ts` | Deterministik slot motoru (çalışma saati, terapist, oda, tampon, sıralama) |
| `src/domain/slot-token.ts` | İmzalı `slot_id`: LLM saat uyduramaz |
| `src/http/tools.ts` | `check_availability`, `book_appointment`, `log_callback_request` |
| `src/http/webhooks.ts` | Arama başı (tarih tablosu, arayan no) ve görüşme sonu (HMAC) webhook'ları |
| `src/store/db.ts` | SQLite, çift randevuya karşı işlem içi kontrol |
| `tenants/*.json` | Her firma için bir ayar dosyası (hizmet, personel, oda, saatler, hat, bildirim, SSS) |
| `agent/verticals/spa/` | Spa sektör şablonu: prompt, karşılama, onay mesajı, test senaryoları |
| `src/calendar/calendars.ts` | Takvim kaynağı: kendi veritabanımız veya Google Takvim (okuma, yazma, yeniden deneme) |
| `src/integrations/google/client.ts` | Kütüphanesiz Google Calendar istemcisi (servis hesabı) |
| `src/domain/missed-calls.ts` | Kaçan çağrı tespiti ve otomatik geri arama notu |
| `scripts/build-agent.ts` | Tenant'tan ElevenLabs ajan JSON'u üretir |
| `web/` | Firmalar için tanıtım sitesi, kurulum formu ve numara yönlendirme rehberi (sunucu `/` adresinde yayınlar) |
| `scripts/hold-audio.ts` | Hat doluyken çalınan bekleme anonsunu ajanın sesiyle üretip yükler |
| `scripts/setup-webhooks.ts` | Görüşme sonu webhook'unu ElevenLabs'te oluşturur |
| `scripts/check-calendar.ts` | Firmanın Google Takvim bağlantısını ve etkinliklerin nasıl yorumlandığını kontrol eder |
| `scripts/connect-phone.ts` | Firmanın 0850 numarasını (SIP) ElevenLabs'e bağlar |

## Yeni firma eklemek (aynı sektör)
1. Firma web sitesindeki kurulum formunu doldurur (`/kurulum`). Başvurular veritabanına düşer.
2. `npm run onboarding` başvuruları listeler; `npm run onboarding -- <REF>` seçilen başvurudan `tenants/<id>.json` taslağı ve eksikler listesi üretir. Eksikleri firmayla telefonda tamamla.
3. `npm run agent:push -- <id>` ajanı oluşturur. Çıkan `agent_id` değerini dosyadaki `agentIds` alanına ekle.
4. `node --env-file=.env scripts/model-eval.ts <id>` ile sektör testlerini çalıştır. Hepsi geçmeden yayına alma.

Firma bazında değişebilenler: ajan adı/sesi/karşılama (`agent`), bildirim kanalları ve metni (`notifications`), takvim kaynağı (`calendar`), saatler, hizmetler, personel, odalar, SSS.

## Prompt yapısı
Ajanın prompt'u üç parçadan oluşur (`src/domain/prompt.ts` birleştirir):

| Parça | Dosya | İçerik |
|---|---|---|
| Ortak kurallar | `agent/core/prompt.tr.md` | Tarih tablosu, ton, hitap, randevu akışı, son teyit, araç kuralları, ödeme/saldırı/konu dışı sınırları, insana aktarma. **Bir düzeltme burada yapılırsa tüm sektörlere gider.** |
| Sektör bölümleri | `agent/verticals/<sektör>/prompt.tr.md` | `## rol`, `## sinirlar`, `## hassas-konular` |
| Firma bilgileri | `tenants/<firma>.json` | Ad, hizmetler, fiyatlar, ekip, saatler, SSS |

Eksik veya fazla sektör bölümü ya da doldurulmamış bir yer tutucu varsa ajan kurulmaz, hata verir.

## Yeni sektör eklemek
1. `agent/verticals/spa/` klasörünü kopyala (örn. `agent/verticals/klinik/`).
2. `prompt.tr.md`: yalnızca üç bölümü o sektöre göre yaz (rol, sınırlar, hassas konular). Ortak kuralları tekrar yazma.
3. `vertical.json`: karşılama, onay mesajı, bekleme anonsu, ekip terimi (`staffTerm`, `staffLabel`).
4. `eval-scenarios.json` ve `test-senaryolari.md`: o sektörün test senaryoları.
5. `src/domain/tenant.ts` içindeki `VERTICALS` listesine sektörün adını ekle.

Randevu motoru (süreli hizmet + personel + oda/alan) sektörden bağımsızdır: kuaför, klinik, güzellik merkezi, veteriner, oto servis uyar. Kontenjanlı rezervasyon (restoran masası, grup dersi) için motora kapasite kavramı, gece bazlı rezervasyon (otel odası) için ayrı modül gerekir.

## Canlı sunucu (Fly.io)
- Adres: https://acikhat-resepsiyon.fly.dev (Chicago, `ord`). ElevenLabs'in ses sunucuları ABD'nin ortasında olduğu için araç çağrıları burada ~100 ms sürüyor (Türkiye'den 330–740 ms idi).
- Sunucu hiç uyumaz (`auto_stop_machines = "off"`); veritabanı kalıcı diskte (`/data/app.db`), Fly günlük anlık yedek alır (5 gün).
- Gizli bilgiler `fly secrets` ile verilir; `.env` sunucuya gönderilmez.

| İş | Komut |
|---|---|
| Kod veya firma ayarı değişti | `fly deploy` |
| Kayıtları izle | `fly logs` |
| Gizli bilgi değiştir | `fly secrets set AD=değer` |
| Webhook adresini kur/yenile | `node --env-file=.env scripts/setup-webhooks.ts`, ardından `fly secrets set ELEVENLABS_WEBHOOK_SECRET=…` ve `npm run agent:push -- <firma>` |
| Tarayıcı testi | https://acikhat-resepsiyon.fly.dev/test/demo-spa (kullanıcı: `test`, şifre: `.env` içindeki `TEST_UI_PASSWORD`) |

## Firma paneli
- Adres: https://acikhat-resepsiyon.fly.dev/panel/ (kaynak: `panel/`, Vite + React; sunucu uçları: `src/http/panel/`)
- Bölümler: Bugün, Randevular (elle randevu, iptal), Çağrılar (özet + döküm), Geri aramalar, Raporlar, Ayarlar (taslak → Yayınla), Kullanıcılar, Asistanı dene.
- Firma ayarları artık veritabanında (`tenants` tablosu). `tenants/*.json` yalnızca ilk kurulumda içeri alınır; sonrasında değişiklikler panelden yapılır ve "Yayınla" asistanı ElevenLabs'te günceller.
- Roller: sahip + ekip rolü. Ekip rolünün adı ve varsayılan yetkileri sektör şablonundan (`vertical.json`: `teamRoleLabel`, `teamPermissions`), firma bazında panelden değişir.

| İş | Komut |
|---|---|
| Panel geliştirme (yerel sunucu 8787'de açıkken) | `cd panel && npm run dev` |
| Panel derleme (Docker zaten yapar) | `cd panel && npm run build` |
| Canlıda kullanıcı açma | `fly ssh console -C 'node scripts/create-user.ts <firma-id> <e-posta> "<Ad Soyad>" owner'` |

## Dağıtım (otomatik)
`main` dalına her `git push` işleminde GitHub Actions önce testleri ve panel derlemesini çalıştırır, geçerse Fly.io'ya dağıtır (`.github/workflows/deploy.yml`). Elle `fly deploy` gerekmez. Durum: GitHub → Actions sekmesi.

- Fly erişimi GitHub'daki `FLY_API_TOKEN` gizli değeriyle yapılır (yalnızca bu uygulamaya dağıtım yetkili, 1 yıl geçerli). Süresi dolunca: `fly tokens create deploy -a acikhat-resepsiyon --expiry 8760h | gh secret set FLY_API_TOKEN -R adspine/acikhat`
- Sunucunun gizli değerleri (API anahtarları) Fly'da durur (`fly secrets`), repoya girmez.

### Yeni bir bilgisayarda kurulum
1. `git clone https://github.com/adspine/acikhat.git && cd acikhat && npm ci && (cd panel && npm ci)`
2. `.env` dosyası repoda yoktur: diğer bilgisayardan güvenli bir yolla (parola yöneticisi vb.) kopyalanır. E-posta veya mesajla gönderilmez.
3. Commit kimliği (yalnızca bu klasör için): `git config user.name adspine && git config user.email 341140214+adspine@users.noreply.github.com`
4. `npm test` ile kontrol, `npm run dev` ile yerel sunucu.
