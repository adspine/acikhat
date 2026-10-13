import { describe, expect, it } from "vitest";
import { spelledPhone } from "../src/domain/phone.ts";
import { titleCaseTr } from "../src/http/tools.ts";
import { makeApp } from "./helpers.ts";

const base = "/tools/demo-spa";

describe("telefon rakam rakam okuma", () => {
  it("0532 015 10 95 → tek tek rakamlar, iki haneli sayı yok", () => {
    expect(spelledPhone("+905320151095")).toBe("sıfır beş üç iki, sıfır bir beş, bir sıfır, dokuz beş");
    expect(spelledPhone("+905441112233")).toBe("sıfır beş dört dört, bir bir bir, iki iki, üç üç");
  });
});

describe("isim yazımı", () => {
  it("Türkçe büyük/küçük harf kurallarıyla düzeltir", () => {
    expect(titleCaseTr("oğulcan   YERLİKAYA")).toBe("Oğulcan Yerlikaya");
    expect(titleCaseTr("ışık ILGAZ")).toBe("Işık Ilgaz");
    expect(titleCaseTr("  ali ")).toBe("Ali");
  });
});

describe("son teyit adımı (prepare_confirmation)", () => {
  async function slot(raw: ReturnType<typeof makeApp>["raw"]) {
    const avail = await raw(`${base}/check_availability`, { service_id: "klasik-masaj-60" });
    return avail.body.options[0].slot_id as string;
  }

  it("okunacak cümleyi sunucu hazırlar: gün, hizmet, düzgün isim, rakam rakam numara", async () => {
    const { raw } = makeApp();
    const slot_id = await slot(raw);
    const r = await raw(`${base}/prepare_confirmation`, { slot_id, customer_name: "oğulcan yerlikaya", customer_phone: "0532 015 10 95" });
    expect(r.body.ok).toBe(true);
    expect(r.body.say).toContain("Oğulcan Yerlikaya adına");
    expect(r.body.say).toContain("sıfır beş üç iki, sıfır bir beş, bir sıfır, dokuz beş numarasına gelecek");
    expect(r.body.say).toContain("Klasik masaj,");
    expect(r.body.say).not.toContain("(60 dakika)");
    expect(r.body.say).toMatch(/Onaylıyor musunuz\?$/);
    expect(r.body.customer_phone).toBe("+905320151095");
    expect(r.body.confirmation_token).toBeTruthy();
  });

  it("jeton olmadan, yanlış jetonla ya da bilgiler değişince randevu yazılmaz", async () => {
    const { raw, store } = makeApp();
    const slot_id = await slot(raw);
    const prep = await raw(`${base}/prepare_confirmation`, { slot_id, customer_name: "Ali Veli", customer_phone: "05321112233" });
    const book = (extra: Record<string, unknown>) =>
      raw(`${base}/book_appointment`, { slot_id, customer_name: "Ali Veli", customer_phone: "05321112233", confirmed_by_caller: true, ...extra });

    expect((await book({})).body.error).toBe("not_confirmed");
    expect((await book({ confirmation_token: "x".repeat(22) })).body.error).toBe("not_confirmed");
    // teyitte okunandan farklı isim ya da numara: jeton tutmaz
    expect((await book({ confirmation_token: prep.body.confirmation_token, customer_name: "Veli Ali" })).body.error).toBe("not_confirmed");
    expect((await book({ confirmation_token: prep.body.confirmation_token, customer_phone: "05441112233" })).body.error).toBe("not_confirmed");
    expect(store.db.prepare("SELECT COUNT(*) AS n FROM appointments").get()).toMatchObject({ n: 0 });

    const ok = await book({ confirmation_token: prep.body.confirmation_token });
    expect(ok.body.ok).toBe(true);
  });

  it("geçersiz numara ya da slot için teyit cümlesi üretmez", async () => {
    const { raw } = makeApp();
    const slot_id = await slot(raw);
    expect((await raw(`${base}/prepare_confirmation`, { slot_id, customer_name: "Ali", customer_phone: "0216 111 22 33" })).body.error).toBe("invalid_phone");
    expect((await raw(`${base}/prepare_confirmation`, { slot_id: "uydurma.imza", customer_name: "Ali", customer_phone: "05321112233" })).body.error).toBe("invalid_slot");
  });

  it("randevudaki isim düzgün yazımla kaydedilir", async () => {
    const { call, raw, store } = makeApp();
    const slot_id = await slot(raw);
    const ok = await call(`${base}/book_appointment`, { slot_id, customer_name: "zeynep KAYA", customer_phone: "05321112233", confirmed_by_caller: true });
    expect(ok.body.ok).toBe(true);
    expect(store.db.prepare("SELECT customer_name FROM appointments").get()).toMatchObject({ customer_name: "Zeynep Kaya" });
  });
});

describe("yer tutucu isim", () => {
  it("model isim almadan 'Bilinmiyor' yazarsa teyit cümlesi üretilmez", async () => {
    const { raw } = makeApp();
    const avail = await raw(`${base}/check_availability`, { service_id: "klasik-masaj-60" });
    const slot_id = avail.body.options[0].slot_id as string;
    for (const customer_name of ["Bilinmiyor", "müşteri", "UNKNOWN", "Yok."]) {
      const r = await raw(`${base}/prepare_confirmation`, { slot_id, customer_name, customer_phone: "05321112233" });
      expect(r.body.error).toBe("name_missing");
    }
  });
});
