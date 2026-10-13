import type { Store } from "../store/db.ts";
import type { TenantRegistry } from "../store/tenants.ts";
import type { TenantStore } from "../store/tenant-store.ts";
import type { Notifier } from "../integrations/notify.ts";
import type { Calendars } from "../calendar/calendars.ts";
import type { BookingService } from "../booking/service.ts";
import type { Users } from "../auth/users.ts";
import type { AgentPushResult } from "../agent/sync.ts";
import type { PhoneConnectResult } from "../agent/phone.ts";
import type { Tenant } from "../domain/tenant.ts";
import type { FirebaseVerifier } from "../auth/firebase.ts";
import type { VoiceCatalog } from "../integrations/voices.ts";
import type { Mailer } from "../integrations/mail.ts";

export interface Deps {
  store: Store;
  /** Canlı firma ayarları (bellekte; yayınlanınca güncellenir) */
  tenants: TenantRegistry;
  /** Firma ayarlarının kalıcı kaydı: canlı + taslak */
  tenantStore: TenantStore;
  users: Users;
  notifier: Notifier;
  /** Firmanın takvim kaynağı (kendi veritabanımız veya Google Takvim) */
  calendars: Calendars;
  /** Randevu yazma/iptal: asistan ve panel ortak */
  booking: BookingService;
  /** Ayar yayınlanınca asistanı ElevenLabs'te günceller (testlerde sahte verilir) */
  publishAgent: (tenant: Tenant) => Promise<AgentPushResult>;
  /** Firmanın 0850 numaralarını ElevenLabs SIP trunk olarak asistana bağlar; verilmezse panelden bağlama kapalıdır */
  connectPhone?: (tenant: Tenant) => Promise<PhoneConnectResult>;
  /** Araç çağrılarındaki Bearer token */
  toolSecret: string;
  slotKey: string;
  /** Boşsa post-call webhook reddedilir */
  webhookSecret: string;
  /** Firebase giriş belgesi doğrulayıcı; yoksa Firebase ile giriş kapalıdır */
  firebase?: FirebaseVerifier | null;
  /** Giriş yapmış kullanıcıya şifre belirleme e-postası gönderir (Firebase); yoksa özellik kapalıdır */
  passwordReset?: ((email: string) => Promise<void>) | null;
  /** Asistan sesi seçimi için Türkçe ses listesi; yoksa panelde ses seçimi kapalıdır */
  voices?: VoiceCatalog | null;
  /** Bu e-postalarla (Firebase'de doğrulanmış) giren hesap yönetici (agency) olur. Küçük harfle. */
  adminEmails?: string[];
  /** Gerçek ödeme bağlanana kadar: paketi ödenmiş saymak için test düğmesi açık mı */
  paymentTestMode?: boolean;
  /** Sistem e-postaları (yönetici ve müşteri bildirimleri); yoksa e-posta gönderilmez */
  mailer?: Mailer | null;
  /** E-postalardaki bağlantıların kök adresi (https://...) */
  baseUrl?: string;
  /** Oturum çerezi Secure olsun mu (yerel http geliştirmede false) */
  secureCookies: boolean;
  /** Testlerde sabitlenebilsin diye enjekte edilir */
  now: () => Temporal.ZonedDateTime;
}
