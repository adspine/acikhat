import { readFileSync } from "node:fs";
import type { Tenant } from "./tenant.ts";
import { loadVertical, verticalFile } from "./vertical.ts";

/**
 * Ajan prompt'u = ortak kurallar (agent/core/prompt.tr.md) + sektör bölümleri
 * (agent/verticals/<sektör>/prompt.tr.md) + firma bilgileri.
 */
const CORE = new URL("../../agent/core/prompt.tr.md", import.meta.url);
const DAYS = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"];

const stripComments = (s: string) => s.replace(/<!--[\s\S]*?-->\n?/g, "");

/** "## ad" başlıklarıyla ayrılmış sektör bölümleri */
export function parseSections(text: string): Map<string, string> {
  const out = new Map<string, string>();
  const parts = stripComments(text).split(/^## +(\S+)[ \t]*$/m);
  for (let i = 1; i < parts.length; i += 2) out.set(parts[i]!, parts[i + 1]!.trim());
  return out;
}

export function composePrompt(core: string, sectorText: string, vars: Record<string, string>): string {
  const sections = parseSections(sectorText);
  const used = new Set<string>();
  let out = stripComments(core).replace(/\[\[sector:([\w-]+)\]\]/g, (_, key: string) => {
    const section = sections.get(key);
    if (section === undefined) throw new Error(`Sektör prompt'unda "## ${key}" bölümü yok`);
    used.add(key);
    return section;
  });
  const unused = [...sections.keys()].filter((k) => !used.has(k));
  if (unused.length) throw new Error(`Sektör prompt'undaki bölüm(ler) ortak prompt'ta kullanılmıyor: ${unused.join(", ")}`);

  // Firma bilgileri sektör bölümlerinin içinde de geçebilir, bu yüzden en son doldurulur
  out = out.replace(/\[\[(\w+)\]\]/g, (m, key: string) => vars[key] ?? m);
  const missing = out.match(/\[\[[\w:-]+\]\]/g);
  if (missing) throw new Error(`Doldurulmamış yer tutucu: ${[...new Set(missing)].join(", ")}`);
  return out.trim() + "\n";
}

export function renderPrompt(t: Tenant): string {
  const vertical = loadVertical(t.vertical);
  const hours = DAYS.map((d, i) => {
    const w = t.hours[String(i + 1) as keyof Tenant["hours"]];
    return `- ${d}: ${w.length ? w.map(([a, b]) => `${a}-${b}`).join(", ") : "kapalı"}`;
  }).join("\n");
  return composePrompt(readFileSync(CORE, "utf8"), readFileSync(verticalFile(t.vertical, "prompt.tr.md"), "utf8"), {
    business_name: t.name,
    agent_name: t.agent.name,
    services: t.services
      .map((s) => `- ${s.name}: ${s.priceTRY} TL (id: ${s.id})${s.staffCount > 1 ? `, ${s.staffCount} ${vertical.staffTerm} birlikte yapar` : ""}`)
      .join("\n"),
    staff_label: vertical.staffLabel,
    staff: t.staff.map((s) => `${s.name} (${s.gender === "kadin" ? "kadın" : "erkek"})`).join(", ") || "(tanımlı değil)",
    hours,
    faq: t.faq.map((f) => `- ${f.q}: ${f.a}`).join("\n") || "- (yok)",
  });
}
