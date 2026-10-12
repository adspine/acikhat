const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const WEEKDAYS = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"];

export function weekdayName(d: Temporal.PlainDate): string {
  return WEEKDAYS[d.dayOfWeek - 1]!;
}

/** "12 Ekim Pazartesi" */
export function spokenDate(d: Temporal.PlainDate): string {
  return `${d.day} ${MONTHS[d.month - 1]} ${weekdayName(d)}`;
}

/**
 * "14.30" → "on dört otuz"; tam saatte "19" → "on dokuz".
 * "19.00" biçimini bazı Türkçe sesler "on dokuz sıfır sıfır" diye okuyor (STT ile doğrulandı).
 */
export function spokenTime(t: Temporal.PlainTime): string {
  if (t.minute === 0) return String(t.hour);
  return `${t.hour}.${String(t.minute).padStart(2, "0")}`;
}

/** "12 Ekim Pazartesi, saat 14.30" */
export function spokenDateTime(z: Temporal.ZonedDateTime): string {
  return `${spokenDate(z.toPlainDate())}, saat ${spokenTime(z.toPlainTime())}`;
}

/**
 * LLM'e gün hesabı yaptırmamak için prompt'a giden tablo:
 * "Bugün: 11 Ekim Pazar (2026-10-11)\nYarın: ..."
 */
export function dateTable(today: Temporal.PlainDate, days = 14): string {
  const lines: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = today.add({ days: i });
    const label = i === 0 ? "Bugün" : i === 1 ? "Yarın" : i === 2 ? "Öbür gün" : "";
    lines.push(`${label ? label + ": " : ""}${spokenDate(d)} = ${d.toString()}`);
  }
  return lines.join("\n");
}

export function parseTime(hhmm: string): Temporal.PlainTime {
  return Temporal.PlainTime.from(hhmm);
}

export type PartOfDay = "sabah" | "ogle" | "aksam";

export function partOfDay(t: Temporal.PlainTime): PartOfDay {
  if (t.hour < 12) return "sabah";
  if (t.hour < 17) return "ogle";
  return "aksam";
}
