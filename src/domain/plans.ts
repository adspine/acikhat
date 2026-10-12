/**
 * Satılan paketler. Tek kaynak: sunucu fiyatı ve dakikayı buradan okur, site yalnızca gösterir.
 * Fiyatlar USD, KDV dahil. listUsd üstü çizili lansman öncesi liste fiyatıdır.
 */
export const PLAN_IDS = ["baslangic", "standart", "pro"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export interface Plan {
  id: PlanId;
  name: string;
  priceUsd: number;
  listUsd: number;
  minutes: number;
}

export const PLANS: Record<PlanId, Plan> = {
  baslangic: { id: "baslangic", name: "Başlangıç", priceUsd: 149, listUsd: 199, minutes: 400 },
  standart: { id: "standart", name: "Standart", priceUsd: 299, listUsd: 399, minutes: 1000 },
  pro: { id: "pro", name: "Pro", priceUsd: 599, listUsd: 799, minutes: 2500 },
};

export const isPlanId = (v: unknown): v is PlanId => typeof v === "string" && (PLAN_IDS as readonly string[]).includes(v);
