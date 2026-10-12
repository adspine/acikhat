import { describe, expect, it } from "vitest";
import { bestSlots, candidateSlots, type BusyBlock } from "../src/domain/slots.ts";
import { demoTenant, MONDAY_9AM } from "./helpers.ts";

const service = (id: string) => demoTenant.services.find((s) => s.id === id)!;
const monday = MONDAY_9AM.toPlainDate();
const at = (iso: string) => Temporal.ZonedDateTime.from(`${iso}[Europe/Istanbul]`).epochMilliseconds;
const times = (slots: { start: Temporal.ZonedDateTime }[]) => slots.map((s) => s.start.toPlainDateTime().toString().slice(0, 16));

describe("slot motoru", () => {
  it("en erken 3 seçeneği birbirinden en az 60 dk ayrık önerir", () => {
    const slots = bestSlots(demoTenant, { service: service("klasik-masaj-60"), now: MONDAY_9AM, dateFrom: monday, dateTo: monday }, []);
    expect(times(slots)).toEqual(["2026-10-12T10:00", "2026-10-12T11:00", "2026-10-12T12:00"]);
  });

  it("minLeadMinutes'tan önceki saatleri önermez", () => {
    const now = Temporal.ZonedDateTime.from("2026-10-12T13:05[Europe/Istanbul]");
    const [first] = bestSlots(demoTenant, { service: service("klasik-masaj-60"), now, dateFrom: monday, dateTo: monday }, []);
    expect(first!.start.toPlainTime().toString()).toBe("14:15:00");
  });

  it("hizmet kapanıştan önce bitmeli", () => {
    const slots = candidateSlots(demoTenant, { service: service("aromaterapi-90"), now: MONDAY_9AM, dateFrom: monday, dateTo: monday }, []);
    const last = slots.map((s) => s.end.toPlainTime().toString()).sort().at(-1);
    expect(last).toBe("21:00:00");
  });

  it("kapalı günde ve terapistin çalışmadığı günde slot vermez", () => {
    const closed = Temporal.PlainDate.from("2026-10-29");
    expect(candidateSlots(demoTenant, { service: service("klasik-masaj-60"), now: MONDAY_9AM, dateFrom: closed, dateTo: closed }, [])).toEqual([]);

    // Murat çarşamba çalışmıyor
    const wed = Temporal.PlainDate.from("2026-10-14");
    expect(candidateSlots(demoTenant, { service: service("klasik-masaj-60"), now: MONDAY_9AM, dateFrom: wed, dateTo: wed, staffId: "murat" }, [])).toEqual([]);
  });

  it("terapist saatleri spa saatleriyle kesişir", () => {
    const slots = candidateSlots(demoTenant, { service: service("klasik-masaj-60"), now: MONDAY_9AM, dateFrom: monday, dateTo: monday, staffId: "murat" }, []);
    expect(slots[0]!.start.toPlainTime().toString()).toBe("14:00:00");
  });

  it("dolu terapisti ve tampon süresini dikkate alır", () => {
    // Hamam odası tek: 10:00-10:45 + 15 dk tampon = 11:00'e kadar dolu
    const busy: BusyBlock[] = [{ staffId: "elif", roomId: "hamam-1", startMs: at("2026-10-12T10:00"), endMs: at("2026-10-12T11:00") }];
    const slots = candidateSlots(demoTenant, { service: service("hamam-kese-45"), now: MONDAY_9AM, dateFrom: monday, dateTo: monday }, busy);
    expect(slots.some((s) => s.start.epochMilliseconds < at("2026-10-12T11:00"))).toBe(false);
  });

  it("oda tipi doluysa (tek çift odası) slot vermez", () => {
    const busy: BusyBlock[] = [{ staffId: "x", roomId: "cift-1", startMs: at("2026-10-12T10:00"), endMs: at("2026-10-12T21:00") }];
    expect(candidateSlots(demoTenant, { service: service("cift-masaj-60"), now: MONDAY_9AM, dateFrom: monday, dateTo: monday }, busy)).toEqual([]);
  });

  it("istenen saate en yakın seçenekleri öne alır, gün tercihini korur", () => {
    const slots = bestSlots(
      demoTenant,
      { service: service("klasik-masaj-60"), now: MONDAY_9AM, dateFrom: monday, dateTo: monday.add({ days: 2 }), preferredTime: Temporal.PlainTime.from("18:00") },
      [],
    );
    expect(times(slots)).toEqual(["2026-10-12T17:00", "2026-10-12T18:00", "2026-10-12T19:00"]);
  });

  it("öğleden sonra / akşam filtresi", () => {
    const slots = bestSlots(demoTenant, { service: service("klasik-masaj-60"), now: MONDAY_9AM, dateFrom: monday, dateTo: monday, partOfDay: "aksam" }, []);
    expect(slots.every((s) => s.start.hour >= 17)).toBe(true);
  });

  it("kadın terapist tercihi", () => {
    const slots = candidateSlots(demoTenant, { service: service("klasik-masaj-60"), now: MONDAY_9AM, dateFrom: monday, dateTo: monday, staffGender: "kadin" }, []);
    expect(new Set(slots.map((s) => s.staffId))).toEqual(new Set(["ayse", "elif"]));
  });
});

describe("çok terapistli hizmet (çift masajı)", () => {
  const cift = demoTenant.services.find((s) => s.id === "cift-masaj-60")!;
  const tenAm = <T extends { start: Temporal.ZonedDateTime }>(slots: T[]) => slots.filter((s) => s.start.hour === 10 && s.start.minute === 0);

  it("aynı saatte iki farklı uygun terapist atar", () => {
    const [slot] = tenAm(candidateSlots(demoTenant, { service: cift, now: MONDAY_9AM, dateFrom: monday, dateTo: monday }, []));
    expect(slot).toBeDefined();
    const team = [slot!.staffId, ...slot!.extraStaffIds].sort();
    expect(team).toEqual(["ayse", "elif"]); // Murat çift masajı yapmıyor
    expect(slot!.roomId).toBe("cift-1");
  });

  it("terapistlerden biri doluysa oda boş olsa bile o saati önermez", () => {
    const busy: BusyBlock[] = [{ staffId: "elif", roomId: "oda-2", startMs: at("2026-10-12T10:00"), endMs: at("2026-10-12T11:15") }];
    expect(tenAm(candidateSlots(demoTenant, { service: cift, now: MONDAY_9AM, dateFrom: monday, dateTo: monday }, busy))).toHaveLength(0);
  });

  it("tek terapistli hizmette ek terapist atanmaz", () => {
    const klasik = demoTenant.services.find((s) => s.id === "klasik-masaj-60")!;
    const [slot] = candidateSlots(demoTenant, { service: klasik, now: MONDAY_9AM, dateFrom: monday, dateTo: monday }, []);
    expect(slot!.extraStaffIds).toEqual([]);
  });
});
