import { Hono } from "hono";
import { z } from "zod";
import type { Deps } from "../deps.ts";
import { type PanelEnv, requirePermission } from "./session.ts";
import { TenantSchema, type Tenant } from "../../domain/tenant.ts";
import { loadVertical } from "../../domain/vertical.ts";
import { PERMISSION_LABELS } from "../../domain/permissions.ts";

z.config(z.locales.tr());

/**
 * Panelden değiştirilemeyen alanlar: kurulumu bozabilecek veya plana bağlı olanlar.
 * Taslak kaydedilirken bu alanlar her zaman canlı ayardan alınır.
 */
const PROTECTED = ["id", "vertical", "timezone", "phoneNumbers", "agentIds", "calendar", "plan", "sms", "team"] as const;

/** Yayınlanmamış değişiklik özetinde kullanılan bölümler */
const SECTIONS: { key: string; label: string; fields: string[] }[] = [
  { key: "business", label: "İşletme bilgileri", fields: ["name"] },
  { key: "hours", label: "Çalışma saatleri", fields: ["hours", "closedDates", "slotStepMinutes", "minLeadMinutes", "maxDaysAhead"] },
  { key: "services", label: "Hizmetler ve fiyatlar", fields: ["services"] },
  { key: "staff", label: "Ekip", fields: ["staff"] },
  { key: "rooms", label: "Odalar ve alanlar", fields: ["rooms"] },
  { key: "faq", label: "Sık sorulanlar", fields: ["faq"] },
  { key: "assistant", label: "Asistan", fields: ["agent"] },
  { key: "phone", label: "Telefon ve aktarma", fields: ["handoff", "calls"] },
  { key: "notifications", label: "Bildirimler", fields: ["notifications"] },
];

const slug = (s: string) =>
  s
    .toLocaleLowerCase("tr")
    .replace(/[çğıöşü]/g, (c) => ({ ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u" })[c]!)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "x";

const unique = (base: string, taken: Set<string>) => {
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}-${i}`;
  taken.add(id);
  return id;
};

type Draft = Record<string, unknown> & {
  services?: { id?: string; name?: string; durationMin?: number }[];
  staff?: { id?: string; name?: string; services?: string[] }[];
  rooms?: { id?: string; type?: string }[];
};

/** Korunan alanları canlıdan al, yeni satırlara kimlik ver */
function normalizeDraft(input: Draft, live: Tenant): Draft {
  const d: Draft = structuredClone(input);
  for (const k of PROTECTED) (d as Record<string, unknown>)[k] = structuredClone((live as Record<string, unknown>)[k]);
  // Ses kimliği kurulumda seçilir; panelden yalnızca ad ve karşılama değişir
  d.agent = { ...((d.agent as object) ?? {}), voiceId: live.agent.voiceId };
  const ids = new Set<string>();
  for (const s of d.services ?? []) s.id = s.id && !ids.has(s.id) ? (ids.add(s.id), s.id) : unique(slug(`${s.name ?? "hizmet"}-${s.durationMin ?? ""}`), ids);
  const staffIds = new Set<string>();
  for (const p of d.staff ?? []) {
    p.id = p.id && !staffIds.has(p.id) ? (staffIds.add(p.id), p.id) : unique(slug(p.name ?? "kisi"), staffIds);
    // Silinen hizmetlere bağlı kalan atamaları temizle
    p.services = (p.services ?? []).filter((id) => ids.has(id));
  }
  const roomIds = new Set<string>();
  for (const r of d.rooms ?? []) r.id = r.id && !roomIds.has(r.id) ? (roomIds.add(r.id), r.id) : unique(`${r.type ?? "oda"}-${roomIds.size + 1}`, roomIds);
  return d;
}

/** Şemanın yakalayamadığı iş kuralları; mesajlar firmanın terimleriyle */
function businessIssues(t: Tenant): { path: string; message: string }[] {
  const v = loadVertical(t.vertical);
  const issues: { path: string; message: string }[] = [];
  t.services.forEach((s, i) => {
    if (!t.rooms.some((r) => r.type === s.roomType)) {
      issues.push({ path: `services.${i}.roomType`, message: `"${s.name}" için ${v.roomTypes[s.roomType] ?? s.roomType} tanımlı değil` });
    }
    const qualified = t.staff.filter((p) => p.services.includes(s.id)).length;
    if (qualified < s.staffCount) {
      issues.push({ path: `services.${i}.staffCount`, message: `"${s.name}" için ${s.staffCount} ${v.staffTerm} gerekiyor ama bu hizmeti ${qualified} kişi yapıyor` });
    }
  });
  if (!t.services.length) issues.push({ path: "services", message: "En az bir hizmet olmalı" });
  return issues;
}

function validate(draft: Draft): { tenant: Tenant | null; issues: { path: string; message: string }[] } {
  const parsed = TenantSchema.safeParse(draft);
  if (!parsed.success) return { tenant: null, issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) };
  const issues = businessIssues(parsed.data);
  return { tenant: issues.length ? null : parsed.data, issues };
}

function changedSections(live: unknown, draft: unknown): string[] {
  const l = live as Record<string, unknown>;
  const d = draft as Record<string, unknown>;
  return SECTIONS.filter((s) => s.fields.some((f) => JSON.stringify(l[f] ?? null) !== JSON.stringify(d[f] ?? null))).map((s) => s.label);
}

export function settingsRoutes(deps: Deps) {
  const app = new Hono<PanelEnv>();
  app.use("/settings", requirePermission("settings.edit"));
  app.use("/settings/*", requirePermission("settings.edit"));

  app.get("/settings", (c) => {
    const tenant = c.get("tenant");
    const editable = deps.tenantStore.getEditable(tenant.id)!;
    const v = loadVertical(tenant.vertical);
    const { issues } = editable.hasDraft ? validate(editable.config as Draft) : { issues: [] };
    return c.json({
      config: editable.config,
      hasDraft: editable.hasDraft,
      changes: editable.hasDraft ? changedSections(deps.tenantStore.getLiveRaw(tenant.id), editable.config) : [],
      issues,
      version: editable.version,
      publishedAt: editable.publishedAt,
      protected: PROTECTED,
      meta: {
        staffTerm: v.staffTerm,
        staffLabel: v.staffLabel,
        roomLabel: v.roomLabel,
        roomLabelPlural: v.roomLabelPlural,
        roomTypes: v.roomTypes,
        defaultGreeting: v.greeting,
        defaultConfirmation: v.confirmationTemplate,
        permissionLabels: PERMISSION_LABELS,
      },
    });
  });

  /** Taslağı kaydet (doğrulama hatası olsa da kaydeder; yarım düzenleme kaybolmasın) */
  app.put("/settings", async (c) => {
    const tenant = c.get("tenant");
    const body = (await c.req.json().catch(() => null)) as { config?: Draft } | null;
    if (!body?.config || typeof body.config !== "object") return c.json({ error: "Ayar okunamadı" }, 400);
    const draft = normalizeDraft(body.config, tenant);
    deps.tenantStore.saveDraft(tenant.id, draft);
    const { issues } = validate(draft);
    return c.json({ ok: true, config: draft, hasDraft: true, changes: changedSections(deps.tenantStore.getLiveRaw(tenant.id), draft), issues });
  });

  app.post("/settings/discard", (c) => {
    const tenant = c.get("tenant");
    deps.tenantStore.discardDraft(tenant.id);
    return c.json({ ok: true });
  });

  /** Doğrula → asistanı güncelle → canlıya al. Herhangi bir adım başarısızsa canlı ayar değişmez. */
  app.post("/settings/publish", async (c) => {
    const tenant = c.get("tenant");
    const user = c.get("user");
    const editable = deps.tenantStore.getEditable(tenant.id)!;
    if (!editable.hasDraft) return c.json({ error: "Yayınlanacak değişiklik yok" }, 400);
    const draft = normalizeDraft(editable.config as Draft, tenant);
    const { tenant: next, issues } = validate(draft);
    if (!next) return c.json({ error: "Bazı alanlar hatalı", issues }, 422);

    const changes = changedSections(deps.tenantStore.getLiveRaw(tenant.id), draft);
    if (next.agentIds.length) {
      const pushed = await deps.publishAgent(next);
      if (!pushed.ok) return c.json({ error: pushed.error }, 502);
    }
    const version = deps.tenantStore.publish(next);
    deps.tenants.set(next);
    deps.store.audit({ tenantId: tenant.id, userId: user.id, action: "settings.publish", target: tenant.id, detail: { version, changes } });
    return c.json({ ok: true, version, changes });
  });

  app.get("/settings/history", (c) => {
    const tenant = c.get("tenant");
    return c.json(
      deps.store.auditFor(tenant.id, { actionPrefix: "settings.", limit: 30 }).map((h) => ({
        at: h.at, user: h.user_name, detail: h.detail_json ? JSON.parse(h.detail_json) : null,
      })),
    );
  });

  return app;
}
