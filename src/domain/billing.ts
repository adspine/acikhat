import { PLANS, type PlanId } from "./plans.ts";

/**
 * Ek dakika paketleri (add-on). Paket dakikası biterken tek seferlik satın alınır; yalnızca satın alındığı
 * fatura dönemi (takvim ayı) boyunca geçerlidir, kullanılmayan dakika bir sonraki aya devretmez.
 * Fiyatlar USD, KDV dahil. Not: her paketin dakika başı fiyatı, plan dakikasından ucuz değildir (plan fiyatını zayıflatmaz)
 * ama ek dakika ücretinden (OVERAGE_USD_PER_MINUTE) ucuzdur.
 */
export interface AddonPack {
  id: string;
  name: string;
  minutes: number;
  priceUsd: number;
}

export const ADDON_PACKS: readonly AddonPack[] = [
  { id: "ek-100", name: "100 dk ek paket", minutes: 100, priceUsd: 30 },
  { id: "ek-300", name: "300 dk ek paket", minutes: 300, priceUsd: 80 },
  { id: "ek-600", name: "600 dk ek paket", minutes: 600, priceUsd: 150 },
];

export const findAddon = (id: unknown): AddonPack | undefined => ADDON_PACKS.find((p) => p.id === id);

/** Mevcut pakete göre geçiş türü: yükseltme hemen ve fark ödenerek, düşürme dönem sonunda ve ücretsiz olur */
export type PlanChange = "same" | "upgrade" | "downgrade";

export function planChange(current: PlanId | undefined, target: PlanId): PlanChange {
  if (current === target) return "same";
  if (!current) return "upgrade";
  return PLANS[target].priceUsd > PLANS[current].priceUsd ? "upgrade" : "downgrade";
}

/** Yükseltmede dönemin kalan günlerine oranlanmış fark (bugün dahil), sent hassasiyetinde */
export function upgradeCharge(current: PlanId | undefined, target: PlanId, today: { day: number; daysInMonth: number }): number {
  const from = current ? PLANS[current].priceUsd : 0;
  const diff = PLANS[target].priceUsd - from;
  const remaining = today.daysInMonth - today.day + 1;
  return Math.max(1, Math.round(((diff * remaining) / today.daysInMonth) * 100) / 100);
}

export const periodKey = (d: { year: number; month: number }) => `${d.year}-${String(d.month).padStart(2, "0")}`;
