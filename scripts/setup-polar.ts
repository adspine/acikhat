// Polar'da paket ve ek dakika ürünlerini oluşturur (varsa atlar) ve POLAR_PRODUCTS değerini yazdırır.
// Fiyat ve dakika src/domain/plans.ts ve billing.ts'ten gelir. KDV dahil fiyat (tax_behavior: inclusive).
// Kullanım: POLAR_ACCESS_TOKEN=… POLAR_SERVER=sandbox node scripts/setup-polar.ts
import { PLANS, PLAN_IDS } from "../src/domain/plans.ts";
import { ADDON_PACKS } from "../src/domain/billing.ts";

const token = process.env.POLAR_ACCESS_TOKEN;
if (!token) throw new Error("POLAR_ACCESS_TOKEN gerekli (Polar > Settings > Developers > Organization Access Token; products:read/write)");
const base = process.env.POLAR_SERVER === "sandbox" ? "https://sandbox-api.polar.sh" : "https://api.polar.sh";

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(base + path, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body === undefined ? null : JSON.stringify(body) });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  return (await res.json()) as any;
}

const wanted = [
  ...PLAN_IDS.map((id) => ({ item: id, name: `Açık Hat ${PLANS[id].name} (${PLANS[id].minutes} dk/ay)`, usd: PLANS[id].priceUsd, monthly: true })),
  ...ADDON_PACKS.map((p) => ({ item: p.id, name: `Açık Hat ${p.name}`, usd: p.priceUsd, monthly: false })),
];

const existing = (await api("GET", "/v1/products/?limit=100&is_archived=false")).items as { id: string; metadata?: { item?: string } }[];
const out: Record<string, string> = {};
for (const w of wanted) {
  const found = existing.find((p) => p.metadata?.item === w.item);
  if (found) {
    out[w.item] = found.id;
    console.error(`var: ${w.item} → ${found.id}`);
    continue;
  }
  const created = await api("POST", "/v1/products/", {
    name: w.name,
    recurring_interval: w.monthly ? "month" : null,
    prices: [{ amount_type: "fixed", price_amount: Math.round(w.usd * 100), price_currency: "usd", tax_behavior: "inclusive" }],
    metadata: { item: w.item },
  });
  out[w.item] = created.id;
  console.error(`oluşturuldu: ${w.item} → ${created.id}`);
}
console.log(`\nfly secrets set POLAR_PRODUCTS='${JSON.stringify(out)}'`);
