import { describe, expect, it } from "vitest";
import { OnboardingSchema } from "../src/http/onboarding.ts";
import { makeApp, MONDAY_9AM, paidMemberCookie } from "./helpers.ts";

const base = { business: { name: "Deniz Emlak" }, contact: { person: "Emre Can", phone: "0532 111 22 33" }, consent: { kvkk: true as const } };

describe("kurulum formu: sektöre göre özelleşen başvuru", () => {
  it("eski (yalnızca spa) başvurular geçerli kalır", () => {
    const r = OnboardingSchema.parse({ ...base, business: { name: "Lavanta Spa", operatedBy: "bagimsiz" } });
    expect(r.business.sector).toBe("spa");
    expect(r.extras).toEqual({});
  });

  it.each(["spa", "guzellik", "saglik", "emlak", "otel", "restoran", "fitness", "servis", "danismanlik", "diger"])("%s sektörü kabul edilir", (sector) => {
    expect(OnboardingSchema.safeParse({ ...base, business: { name: "X Firma", sector } }).success).toBe(true);
  });

  it("bilinmeyen sektörü reddeder", () => {
    expect(OnboardingSchema.safeParse({ ...base, business: { name: "X Firma", sector: "uzay" } }).success).toBe(false);
  });

  it("sektör cevapları, unvan, telefon ve kapasite kaybolmadan saklanır", async () => {
    const ctx = makeApp(MONDAY_9AM);
    const { app, store } = ctx;
    const cookie = await paidMemberCookie(ctx);
    const body = {
      ...base,
      business: { name: "Deniz Emlak", sector: "emlak", operatedBy: "Franchise ofisi" },
      services: [{ name: "Satılık konut danışmanlığı", note: "Komisyon sözleşmede", capacity: 4 }],
      staff: [{ name: "Ali Danışman", title: "Merkez, kiralık", phone: "0533 000 11 22" }],
      extras: { "Hizmet verdiğiniz bölgeler": ["Bolu merkez", "Düzce"], "Arayan bir ilan sorarsa": "Bilgisini alıp danışmana aktar", "Toplam oda sayısı": 42 },
    };
    const res = await app.request("/api/onboarding", { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) });
    expect(res.status).toBe(200);
    const { reference } = (await res.json()) as { reference: string };
    const saved = JSON.parse((store.db.prepare("SELECT payload_json FROM onboarding_submissions WHERE reference = ?").get(reference) as { payload_json: string }).payload_json);
    expect(saved.business).toMatchObject({ sector: "emlak", operatedBy: "Franchise ofisi" });
    expect(saved.extras["Hizmet verdiğiniz bölgeler"]).toEqual(["Bolu merkez", "Düzce"]);
    expect(saved.staff[0]).toMatchObject({ title: "Merkez, kiralık", phone: "0533 000 11 22" });
    expect(saved.services[0]).toMatchObject({ capacity: 4, note: "Komisyon sözleşmede" });
  });
});
