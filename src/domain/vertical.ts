import { readFileSync } from "node:fs";
import { z } from "zod";
import type { Tenant } from "./tenant.ts";
import { PERMISSIONS } from "./permissions.ts";

/**
 * Sektör şablonu: agent/verticals/<ad>/ altında
 *   vertical.json        varsayılan karşılama, bildirim metni, terimler
 *   prompt.tr.md         sistem prompt şablonu
 *   eval-scenarios.json  otomatik test senaryoları
 * Yeni sektör = yeni klasör; kod değişmez.
 */
const VerticalSchema = z.object({
  label: z.string(),
  greeting: z.string(),
  confirmationTemplate: z.string(),
  staffTerm: z.string(),
  /** Bilgi bölümünde ekibin başlığı, örn. "Terapistler" */
  staffLabel: z.string(),
  /** Kuyrukta bekleyen arayana çalınan anons; {firma} yer tutucusu */
  holdMessage: z.string(),
  /** Panel terimleri: "Oda" / "Koltuk" / "Lift" ve oda tiplerinin okunur adları */
  roomLabel: z.string(),
  /** Çoğulu ayrı yazılır: Türkçe ek uyumu (Odalar, Koltuklar, Liftler) */
  roomLabelPlural: z.string(),
  roomTypes: z.record(z.string(), z.string()),
  /** Ekip rolünün adı ("Resepsiyon", "Sekreter"...) ve varsayılan yetkileri */
  teamRoleLabel: z.string(),
  teamPermissions: z.array(z.enum(PERMISSIONS)),
  /** Panelden iptal edilen randevu için müşteriye mesaj; yer tutucular onay mesajıyla aynı */
  cancellationTemplate: z.string(),
  /** Konuşma tanıma ipucu: sektöre özgü sözcükler (marka, işlem adı...). Firmanın hizmet ve personel adlarına eklenir. */
  asrKeywords: z.array(z.string()).default([]),
});
export type Vertical = z.infer<typeof VerticalSchema>;

const dir = (name: string) => new URL(`../../agent/verticals/${name}/`, import.meta.url);

export function loadVertical(name: Tenant["vertical"]): Vertical {
  return VerticalSchema.parse(JSON.parse(readFileSync(new URL("vertical.json", dir(name)), "utf8")));
}

export function verticalFile(name: Tenant["vertical"], file: string): URL {
  return new URL(file, dir(name));
}

/** "{firma} ... {ajan}" gibi yer tutucuları doldurur; bilinmeyenleri boş bırakır */
export function fill(template: string, vars: Record<string, string | undefined>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "");
}
