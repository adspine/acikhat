/**
 * Veri saklama süreleri: tek kaynak. Sitedeki KVKK aydınlatma metni (web/index.html, "6. Saklama süreleri") ve
 * ElevenLabs asistan ayarı bu değerlerle aynı olmalıdır; test/retention.test.ts metin ile bu dosyanın tutarlılığını denetler.
 *
 * Gerekçe (Ekim 2026 incelemesi): Rakipler kısa tutuyor (Smith.ai ses kaydını 3 ay, Goodcall alt planlarda 7-30 gün),
 * Retell varsayılan olarak süresiz saklıyor, ElevenLabs varsayılanı 2 yıl. KVKK saklama süresinin amaçla sınırlı olmasını,
 * süresi dolan verinin en geç 6 ayda bir periyodik imhasını ister. Burada her gün çalışır.
 * Süreler iş ihtiyacına göre seçilmiş varsayımlardır; hukuk danışmanıyla teyit edilmelidir.
 */
export const RETENTION = {
  /** ElevenLabs'te ses kaydı ve döküm kopyası (asistanın platform ayarı: privacy.retention_days) */
  elevenLabsDays: 90,
  /** Çağrı dökümü, özeti ve arayan numarası bizim veritabanımızda; sonra anonimleştirilir (süre ve sonuç istatistiği kalır) */
  callDays: 365,
  /** Geri arama talepleri (ad, telefon, sebep): süre sonunda silinir */
  callbackDays: 365,
  /** Randevu bitiminden sonra müşteri adı ve telefonu silinir (kayıt anonim istatistik olarak kalır) */
  appointmentDays: 730,
  /** Landing "test görüşmesi": girilen numara ve IP */
  demoCallDays: 90,
  /** Firmasız, ödemesiz veya reddedilmiş başvuru formları */
  leadDays: 365,
  /** Erişim ve işlem (denetim) kayıtları */
  auditDays: 730,
  /** Tekrar eden webhook olaylarını ayırt etmek için tutulan kimlikler */
  webhookEventDays: 30,
  /** Hizmet sona erince firma verisinin silinme süresi (yönetici işlemi: scripts/erase-tenant.ts) */
  terminationDays: 30,
} as const;
