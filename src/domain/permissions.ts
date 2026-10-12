/**
 * Panel yetkileri. Roller sabit kod değil: sahip her şeye sahip, ekip rolünün adı ve yetkileri
 * sektör şablonundan (vertical.json) gelir ve firma bazında değiştirilebilir.
 */
export const PERMISSIONS = [
  "appointments.view",
  "appointments.edit",
  "calls.view",
  "callbacks.edit",
  "reports.view",
  "settings.edit",
  "users.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** Panelde yetki ayarlarında gösterilen açıklamalar */
export const PERMISSION_LABELS: Record<Permission, string> = {
  "appointments.view": "Randevuları görür",
  "appointments.edit": "Randevu ekler ve iptal eder",
  "calls.view": "Çağrıları ve dökümleri görür",
  "callbacks.edit": "Geri aramaları kapatır",
  "reports.view": "Raporları görür",
  "settings.edit": "Fiyat, saat, hizmet ve ekip ayarlarını değiştirir",
  "users.manage": "Kullanıcı ekler ve yetki verir",
};

export type Role = "owner" | "team" | "agency";

export function permissionsFor(role: Role, teamPermissions: readonly Permission[]): Set<Permission> {
  if (role === "owner" || role === "agency") return new Set(PERMISSIONS);
  return new Set(teamPermissions);
}
