/**
 * Hat havuzu politikası (tek kaynak). Numaralar Netgsm'den biz alırız ve yalnızca müşterinin çağrı yönlendirme hedefi
 * olarak kullanılır; müşteri numarayı yayımlamaz. Hukuki ve sözleşmesel gerekçe: docs/hat-havuzu.md.
 */
export const POOL = {
  /** Başlangıçta alınacak numara sayısı (bilgi amaçlı; yaklaşık 249 TL/yıl/numara) */
  initialSize: 5,
  /** Müsait numara bu sayıya düşünce yöneticiye uyarı gider */
  lowStockAt: 2,
  /**
   * Bırakılan numara bu kadar gün kimseye verilmez. Eski müşterinin telefonu hâlâ o numaraya yönlendiriyor olabilir;
   * hemen başkasına verilirse onun arayanları yeni firmaya düşer (yanlış firma ve gizlilik sorunu).
   */
  quarantineDays: 180,
  /** Yıllık yenileme tarihine bu kadar gün kala yöneticiye hatırlatma (yenilenmezse numara düşer, çağrılar kaybolur) */
  renewalReminderDays: 30,
} as const;

export type PoolStatus = "available" | "assigned" | "quarantine" | "retired";
