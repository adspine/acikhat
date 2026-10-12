# Google Takvim bağlantısı

Asistan, Google Takvim kullanan firmalarda takvimi okuyarak dolu saatleri görür ve aldığı randevuları takvime yazar.

## Bir kez yapılır (ajans tarafı)
Tüm firmalar için tek bir servis hesabı yeterli.

1. https://console.cloud.google.com adresinde yeni bir proje aç (örn. `acikhat`).
2. **APIs & Services → Library** bölümünden **Google Calendar API**'yi bul ve **Enable**'a bas.
3. **IAM & Admin → Service Accounts → Create service account**: ad olarak `takvim` yaz. Rol vermene gerek yok.
4. Oluşan hesabı aç, **Keys → Add key → Create new key → JSON** seç. İnen dosyayı proje klasöründe `secrets/google-sa.json` olarak kaydet. Bu klasör git'e gönderilmez.
5. `.env` dosyasına şu satırı ekle:
   ```
   GOOGLE_SERVICE_ACCOUNT_FILE=secrets/google-sa.json
   ```
6. Servis hesabının e-posta adresini not al (`takvim@acikhat.iam.gserviceaccount.com` gibi). Sunucu açılırken de bu adresi yazar.

## Her firma için
1. Firma, randevularını tuttuğu Google Takvim'i açar: **Ayarlar → [takvim adı] → Belirli kişilerle paylaş → Kişi ekle**.
2. Servis hesabının e-postasını ekler ve izin olarak **"Etkinliklerde değişiklik yapma"** seçer.
3. Aynı sayfadaki **Takvim kimliği**ni (genelde firmanın Gmail adresi) bize iletir.
4. Firma ayar dosyasına yaz (`tenants/<firma>.json`):
   ```json
   "calendar": {
     "provider": "google",
     "google": { "calendarId": "ornekspa@gmail.com" }
   }
   ```
   Terapistlerin ayrı takvimleri varsa:
   ```json
   "google": {
     "calendarId": "ornekspa@gmail.com",
     "staffCalendars": { "ayse": "ayse.terapist@gmail.com" }
   }
   ```
5. Bağlantıyı kontrol et:
   ```
   node --env-file=.env scripts/check-calendar.ts <firma> --yazma-testi
   ```
   Script, önümüzdeki 7 günün etkinliklerini ve her birinin nasıl yorumlandığını listeler. Yorumlar beklenenden farklıysa firmaya etkinlik başlığı düzenini anlat (aşağıda).

## Asistan takvimi nasıl okur
| Takvimdeki etkinlik | Asistanın yorumu |
|---|---|
| Başlıkta terapist adı geçiyor ("Ayşe – Zeynep Hanım") | Ayşe o saatte dolu. Bir oda da dolu sayılır. |
| Terapist adı geçmiyor ("Masaj – Kerem Bey") | Kim olduğu bilinmiyor. Güvenli tarafta kalmak için bu hizmeti verebilen bir terapist ve bir oda dolu sayılır. |
| Tüm gün, terapist adı var ("Murat izinli") | Murat o gün çalışmıyor. |
| Tüm gün, terapist adı yok ("Bakım", "Kapalı") | O gün hiç randevu verilmez. |
| "Serbest" olarak işaretli etkinlik, iptal edilmiş etkinlik | Dikkate alınmaz. |
| Asistanın yazdığı randevu | Terapist ve oda bilinir. |

Elle girilen randevuların sonuna, hizmetlerdeki en uzun hazırlık süresi (örn. 15 dk) otomatik eklenir.

**Firmaya önerilecek alışkanlık:** Randevu girerken başlığa terapistin adını yazmak. Ad yazılmazsa asistan o saatte bir kişiyi dolu sayar ve gerektiğinden az boş saat önerebilir; çift randevu ise olmaz.

## Bilinen sınırlar
- Takvimde sonradan silinen veya taşınan asistan randevuları, bizim kayıtlarımızda "onaylı" görünmeye devam eder. Takvim asıl kaynak olduğu için boş saat hesabı doğru yapılır, ancak panel yapılırken bu senkron eklenmeli.
- Takvim okunurken Google'a ulaşılamazsa asistan randevu yazmaz, geri arama notu alır.
- Takvime yazma başarısız olursa randevu kaybolmaz; sunucu dakikada bir yeniden dener.
