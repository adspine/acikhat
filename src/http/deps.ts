import type { Store } from "../store/db.ts";
import type { TenantRegistry } from "../store/tenants.ts";
import type { TenantStore } from "../store/tenant-store.ts";
import type { Notifier } from "../integrations/notify.ts";
import type { Calendars } from "../calendar/calendars.ts";
import type { BookingService } from "../booking/service.ts";
import type { Users } from "../auth/users.ts";
import type { AgentPushResult } from "../agent/sync.ts";
import type { Tenant } from "../domain/tenant.ts";

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
  /** Araç çağrılarındaki Bearer token */
  toolSecret: string;
  slotKey: string;
  /** Boşsa post-call webhook reddedilir */
  webhookSecret: string;
  /** Oturum çerezi Secure olsun mu (yerel http geliştirmede false) */
  secureCookies: boolean;
  /** Testlerde sabitlenebilsin diye enjekte edilir */
  now: () => Temporal.ZonedDateTime;
}
