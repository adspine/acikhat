import { Hono } from "hono";
import { z } from "zod";
import type { Deps } from "./deps.ts";
import type { User } from "../auth/users.ts";
import { requirePanelHeader, userFromCookie } from "./panel/session.ts";
import { OnboardingSchema } from "./onboarding.ts";
import { buildTenantDraft } from "../domain/onboarding-tenant.ts";
import { PLANS, isPlanId } from "../domain/plans.ts";
import { normalizeTrPhone } from "../domain/phone.ts";
import { TenantSchema } from "../domain/tenant.ts";
import { mailSuspension, mailTenantReady } from "../notify/emails.ts";
import { sampleUrl } from "./panel/settings.ts";
import { loadVertical } from "../domain/vertical.ts";
import { DemoCalls } from "../store/demo-calls.ts";
import { POOL } from "../domain/phone-pool.ts";
import { assignLine, assignManualLine, assignWaiting, checkManualNumber, checkPoolStock, connectTenantLine, poolOf, releaseLine, syncPoolWithTenantNumbers, waitingTenants } from "./phone-line.ts";

/** Başlayıp bu kadar süre sonuç gelmeyen test görüşmesi "sonuç alınamadı" sayılır (en uzun görüşme 2 dk) */
const STALE_DEMO_MS = 6 * 60_000;

/**
 * Yönetici (agency) paneli API'si: başvurular, müşteriler ve satış/kullanım özeti.
 * Yalnızca agency rolündeki kullanıcı erişir; müşteri hesapları (owner/team) 403 alır.
 */
export const SUBMISSION_STATUSES = ["new", "reviewing", "approved", "live", "rejected"] as const;
const DAY = 86_400_000;

type SubmissionRow = {
  reference: string; business_name: string; contact_phone: string; status: string; created_at: number;
  payload_json: string; user_id: string | null; plan: string | null; tenant_id: string | null; admin_note: string | null;
  user_email: string | null; user_name: string | null; plan_paid_at: number | null;
};

const SUBMISSION_SQL = `SELECT s.reference, s.business_name, s.contact_phone, s.status, s.created_at, s.payload_json, s.user_id, s.plan,
    s.tenant_id, s.admin_note, u.email AS user_email, u.name AS user_name, u.plan_paid_at
  FROM onboarding_submissions s LEFT JOIN users u ON u.id = s.user_id`;

function sectorOf(payloadJson: string): string {
  try {
    return (JSON.parse(payloadJson) as { business?: { sector?: string } }).business?.sector ?? "spa";
  } catch {
    return "spa";
  }
}

export function adminRoutes(deps: Deps) {
  const app = new Hono<{ Variables: { admin: User } }>();
  const db = deps.store.db;
  app.use("*", requirePanelHeader);
  app.use("*", async (c, next) => {
    const user = userFromCookie(c, deps);
    if (!user) return c.json({ error: "Oturum açmanız gerekiyor" }, 401);
    if (user.role !== "agency") return c.json({ error: "Bu bölüm yalnızca yöneticiler içindir" }, 403);
    c.set("admin", user);
    await next();
  });

  const summary = (r: SubmissionRow) => ({
    reference: r.reference,
    businessName: r.business_name,
    sector: sectorOf(r.payload_json),
    contactPhone: r.contact_phone,
    status: r.status,
    createdAt: r.created_at,
    tenantId: r.tenant_id,
    plan: isPlanId(r.plan) ? r.plan : null,
    paid: !!r.plan_paid_at,
    member: r.user_email ? { email: r.user_email, name: r.user_name } : null,
    note: r.admin_note,
  });

  /** Genel bakış: üyelik, satış ve kullanım rakamları */
  app.get("/overview", (c) => {
    const now = deps.now().epochMilliseconds;
    const since = now - 30 * DAY;
    const n = (sql: string, ...args: (string | number)[]) => (db.prepare(sql).get(...args) as { n: number }).n;
    const paidRows = db.prepare("SELECT plan, COUNT(*) AS n FROM users WHERE plan_paid_at IS NOT NULL AND plan IS NOT NULL GROUP BY plan").all() as { plan: string; n: number }[];
    const byPlan = { baslangic: 0, standart: 0, pro: 0 };
    let mrrUsd = 0;
    for (const r of paidRows) {
      if (!isPlanId(r.plan)) continue;
      byPlan[r.plan] = r.n;
      mrrUsd += PLANS[r.plan].priceUsd * r.n;
    }
    const statusRows = db.prepare("SELECT status, COUNT(*) AS n FROM onboarding_submissions GROUP BY status").all() as { status: string; n: number }[];
    const submissions = Object.fromEntries(SUBMISSION_STATUSES.map((s) => [s, 0])) as Record<string, number>;
    for (const r of statusRows) submissions[r.status] = r.n;
    const dayRows = db.prepare("SELECT date(started_at / 1000, 'unixepoch') AS d, COUNT(*) AS n FROM calls WHERE started_at >= ? GROUP BY d").all(since) as { d: string; n: number }[];
    const perDay = new Map(dayRows.map((r) => [r.d, r.n]));
    const callsByDay = Array.from({ length: 30 }, (_, i) => {
      const d = new Date(now - (29 - i) * DAY).toISOString().slice(0, 10);
      return { date: d, calls: perDay.get(d) ?? 0 };
    });
    return c.json({
      members: n("SELECT COUNT(*) AS n FROM users WHERE role != 'agency'"),
      paid: paidRows.reduce((a, r) => a + r.n, 0),
      mrrUsd,
      byPlan,
      submissions,
      tenants: deps.tenants.all().length,
      suspended: deps.tenants.all().filter((t) => t.suspended).length,
      salesPanel30Usd: (db.prepare("SELECT COALESCE(SUM(amount_usd), 0) AS n FROM orders WHERE status = 'paid' AND paid_at >= ?").get(since) as { n: number }).n,
      calls30: n("SELECT COUNT(*) AS n FROM calls WHERE started_at >= ?", since),
      appointments30: n("SELECT COUNT(*) AS n FROM appointments WHERE created_at >= ? AND status != 'cancelled'", since),
      callsByDay,
    });
  });

  app.get("/submissions", (c) => {
    const rows = db.prepare(`${SUBMISSION_SQL} ORDER BY s.created_at DESC`).all() as SubmissionRow[];
    return c.json({ submissions: rows.map(summary) });
  });

  app.get("/submissions/:ref", (c) => {
    const row = db.prepare(`${SUBMISSION_SQL} WHERE s.reference = ?`).get(c.req.param("ref")) as SubmissionRow | undefined;
    if (!row) return c.json({ error: "Başvuru bulunamadı" }, 404);
    const payload = JSON.parse(row.payload_json) as unknown;
    // Kurulum kontrol listesi: firma ayarına çevirirken eksik veya şüpheli çıkanlar
    let checklist: string[] = [];
    const form = OnboardingSchema.safeParse(payload);
    if (form.success) checklist = buildTenantDraft(form.data).todo;
    return c.json({ ...summary(row), payload, checklist });
  });

  const Patch = z.object({ status: z.enum(SUBMISSION_STATUSES).optional(), note: z.string().max(2000).optional(), payload: z.unknown().optional() });
  app.patch("/submissions/:ref", async (c) => {
    const parsed = Patch.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "Geçersiz değer" }, 400);
    const ref = c.req.param("ref");
    const row = db.prepare("SELECT status, admin_note, tenant_id FROM onboarding_submissions WHERE reference = ?").get(ref) as { status: string; admin_note: string | null; tenant_id: string | null } | undefined;
    if (!row) return c.json({ error: "Başvuru bulunamadı" }, 404);
    // Başvuru verisi düzenlenebilir (firma oluşturulmadan önce); form şemasına uymayan veri kaydedilmez
    if (parsed.data.payload !== undefined) {
      if (row.tenant_id) return c.json({ error: "Firma oluşturulduktan sonra başvuru verisi değiştirilemez; firma ayarlarını panelden düzenleyin" }, 409);
      const form = OnboardingSchema.safeParse(parsed.data.payload);
      if (!form.success) {
        return c.json({ error: "Veri geçerli değil", issues: form.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, 422);
      }
      db.prepare("UPDATE onboarding_submissions SET payload_json = ?, business_name = ?, contact_phone = ? WHERE reference = ?").run(
        JSON.stringify(form.data),
        form.data.business.name,
        normalizeTrPhone(form.data.contact.phone) ?? form.data.contact.phone,
        ref,
      );
    }
    db.prepare("UPDATE onboarding_submissions SET status = ?, admin_note = ? WHERE reference = ?").run(parsed.data.status ?? row.status, parsed.data.note ?? row.admin_note, ref);
    return c.json({ ok: true });
  });

  /**
   * Başvuruyu onayla: form bilgilerinden firma ayarı oluşturur ve (üyeyse) üyeyi firmaya bağlar.
   * Üye bundan sonra kendi panosuna girer. Ayar canlıya alınmadan önce panelden gözden geçirilip yayınlanır.
   */
  app.post("/submissions/:ref/create-tenant", async (c) => {
    const ref = c.req.param("ref");
    const row = db.prepare(`${SUBMISSION_SQL} WHERE s.reference = ?`).get(ref) as SubmissionRow | undefined;
    if (!row) return c.json({ error: "Başvuru bulunamadı" }, 404);
    if (row.tenant_id) return c.json({ error: "Bu başvuru için firma zaten oluşturuldu" }, 409);
    const form = OnboardingSchema.safeParse(JSON.parse(row.payload_json));
    if (!form.success) return c.json({ error: "Başvuru verisi okunamadı" }, 422);
    // İsteğe bağlı elle numara: dolu ise havuzdan otomatik atama yapılmaz. Firma oluşmadan önce denetlenir, hatalıysa hiçbir şey oluşmaz.
    const body = z.object({ phoneNumber: z.string().trim().max(32).optional() }).safeParse(await c.req.json().catch(() => ({})));
    let manual: { number: string } | null = null;
    if (body.success && body.data.phoneNumber) {
      const chk = checkManualNumber(deps, body.data.phoneNumber);
      if (!chk.ok) return c.json({ error: chk.error }, chk.status);
      manual = { number: chk.number };
    }
    const { parsed, todo } = buildTenantDraft(form.data);
    if (!parsed) return c.json({ error: "Firma ayarı doğrulamadan geçmedi", checklist: todo }, 422);

    // Aynı adda firma varsa sonuna sayı eklenir
    let id = parsed.id;
    for (let i = 2; deps.tenants.get(id) || deps.tenantStore.getEditable(id); i++) id = `${parsed.id}-${i}`;
    // Üyenin ödediği paketin dakikası firmanın planına işlenir (panelde kullanım buna göre gösterilir)
    const paid = row.user_id ? deps.users.onboardingOf(row.user_id) : null;
    const plan = paid?.paidAt && paid.plan ? { includedMinutes: PLANS[paid.plan].minutes, id: paid.plan } : parsed.plan;
    const tenant = { ...parsed, id, plan };
    deps.tenantStore.create(tenant);
    deps.tenants.set(tenant);
    if (row.user_id) deps.users.assignTenant(row.user_id, id);
    mailTenantReady(deps, tenant);
    db.prepare("UPDATE onboarding_submissions SET status = 'approved', tenant_id = ? WHERE reference = ?").run(id, ref);
    // Ödemesi doğrulanmış üyenin firmasına hat havuzundan numara atanır (asistan kurulunca ElevenLabs'e bağlanır)
    const line = manual ? await assignManualLine(deps, tenant, manual.number, c.get("admin").id) : await assignLine(deps, tenant, { requirePaid: true, actorId: c.get("admin").id });
    return c.json({
      ok: true, tenantId: id, linkedMember: !!row.user_id, checklist: todo,
      line: line.ok ? { number: line.number, connected: line.connected, ...(line.note && { note: line.note }) } : { reason: line.reason, error: line.message },
    });
  });

  /** Müşteri firmaları ve son 30 günlük kullanım */
  app.get("/tenants", (c) => {
    const since = deps.now().epochMilliseconds - 30 * DAY;
    const calls = new Map((db.prepare("SELECT tenant_id, COUNT(*) AS n FROM calls WHERE started_at >= ? GROUP BY tenant_id").all(since) as { tenant_id: string; n: number }[]).map((r) => [r.tenant_id, r.n]));
    const appts = new Map((db.prepare("SELECT tenant_id, COUNT(*) AS n FROM appointments WHERE created_at >= ? AND status != 'cancelled' GROUP BY tenant_id").all(since) as { tenant_id: string; n: number }[]).map((r) => [r.tenant_id, r.n]));
    const now = deps.now();
    const monthStart = now.withTimeZone("UTC").with({ day: 1 }).startOfDay().epochMilliseconds;
    const secs = new Map((db.prepare("SELECT tenant_id, COALESCE(SUM(duration_secs), 0) AS n FROM calls WHERE started_at >= ? GROUP BY tenant_id").all(monthStart) as { tenant_id: string; n: number }[]).map((r) => [r.tenant_id, r.n]));
    const addons = new Map((db.prepare("SELECT tenant_id, COALESCE(SUM(minutes), 0) AS n FROM orders WHERE kind = 'addon' AND status = 'paid' AND period = ? GROUP BY tenant_id").all(`${now.withTimeZone("UTC").year}-${String(now.withTimeZone("UTC").month).padStart(2, "0")}`) as { tenant_id: string; n: number }[]).map((r) => [r.tenant_id, r.n]));
    const owners = db.prepare("SELECT tenant_id, email, plan, plan_paid_at FROM users WHERE tenant_id IS NOT NULL AND role = 'owner'").all() as { tenant_id: string; email: string; plan: string | null; plan_paid_at: number | null }[];
    return c.json({
      tenants: deps.tenants.all().map((t) => {
        const owner = owners.find((o) => o.tenant_id === t.id);
        return {
          id: t.id,
          name: t.name,
          vertical: t.vertical,
          assistantReady: t.agentIds.length > 0,
          hasPhone: t.phoneNumbers.length > 0,
          owner: owner?.email ?? null,
          plan: t.plan.id ?? (owner && isPlanId(owner.plan) && owner.plan_paid_at ? owner.plan : null),
          phoneNumbers: t.phoneNumbers,
          voiceId: t.agent.voiceId ?? null,
          suspended: t.suspended,
          pendingPlan: t.plan.pending?.id ?? null,
          calls30: calls.get(t.id) ?? 0,
          appointments30: appts.get(t.id) ?? 0,
          includedMinutes: t.plan.includedMinutes === undefined ? null : t.plan.includedMinutes + (addons.get(t.id) ?? 0),
          addonMinutes: addons.get(t.id) ?? 0,
          planMinutes: t.plan.includedMinutes ?? null,
          minutesUsed: Math.round((secs.get(t.id) ?? 0) / 60),
        };
      }),
    });
  });

  /**
   * Firma üzerinde yönetici işlemleri: paket, telefon hattı, askıya alma.
   * Canlı ayara uygulanır; bekleyen bir taslak varsa aynı alanlar taslağa da yazılır (sonradan yayınlanınca geri dönmesin).
   */
  const TenantPatch = z.object({
    plan: z.enum(["baslangic", "standart", "pro"]).optional(),
    includedMinutes: z.number().int().min(0).max(100_000).optional(),
    phoneNumbers: z.array(z.string()).max(10).optional(),
    suspended: z.boolean().optional(),
    /** Asistan: ses, ad ve karşılama. Canlıya hemen uygulanır (asistan ElevenLabs'te de güncellenir). greeting boş ya da null ise varsayılana döner. */
    agent: z.object({ voiceId: z.string().min(10).max(40).optional(), name: z.string().trim().min(1).max(40).optional(), greeting: z.string().max(500).nullable().optional() }).optional(),
  });

  /** Asistan sesleri (yönetici için, firma seçmeden): panelle aynı Türkçe liste ve hazır örnek sesler */
  app.get("/voices", async (c) => {
    const defaultId = process.env.ELEVENLABS_VOICE_ID || "MzfWWOj9g3sIKex1YFMV";
    if (!deps.voices) return c.json({ voices: [], enabled: false, defaultId });
    try {
      return c.json({ voices: (await deps.voices()).map((v) => ({ ...v, previewUrl: sampleUrl(v.id) })), enabled: true, defaultId });
    } catch {
      return c.json({ error: "Ses listesi şu an alınamıyor. Biraz sonra tekrar deneyin." }, 502);
    }
  });

  /** Firmanın asistan kimliği: düzenleme penceresi bununla açılır */
  app.get("/tenants/:id/agent", (c) => {
    const t = deps.tenants.get(c.req.param("id"));
    if (!t) return c.json({ error: "Firma bulunamadı" }, 404);
    return c.json({ voiceId: t.agent.voiceId ?? null, name: t.agent.name, greeting: t.agent.greeting ?? "", defaultGreeting: loadVertical(t.vertical).greeting, firma: t.name, ready: t.agentIds.length > 0 });
  });

  /**
   * Asistanı kur: firmanın ElevenLabs asistanını oluşturur ve kimliğini firmaya yazar (komut satırı betiğinin panel karşılığı).
   * Asistan zaten varsa aynı çağrı onu güncel ayarla günceller.
   */
  app.post("/tenants/:id/assistant", async (c) => {
    const id = c.req.param("id");
    const tenant = deps.tenants.get(id);
    if (!tenant) return c.json({ error: "Firma bulunamadı" }, 404);
    const pushed = await deps.publishAgent(tenant);
    if (!pushed.ok) return c.json({ error: pushed.error }, 502);
    if (pushed.created) {
      const raw = structuredClone(deps.tenantStore.getLiveRaw(id) as Record<string, unknown>);
      raw.agentIds = [pushed.agentId];
      const next = TenantSchema.safeParse(raw);
      if (!next.success) return c.json({ error: "Ayar geçerli değil" }, 422);
      deps.tenantStore.publish(next.data);
      deps.tenants.set(next.data);
      const editable = deps.tenantStore.getEditable(id);
      if (editable?.hasDraft) deps.tenantStore.saveDraft(id, { ...(editable.config as Record<string, unknown>), agentIds: [pushed.agentId] });
    }
    deps.store.audit({ tenantId: id, userId: c.get("admin").id, action: "admin.assistant", target: id, detail: { created: pushed.created } });
    // Asistan ilk kez kurulduysa ve firmanın numarası varsa (havuzdan atanmış olabilir) hat da bağlanır
    const phone = pushed.created && deps.tenants.get(id)?.phoneNumbers.length ? await connectTenantLine(deps, deps.tenants.get(id)!) : undefined;
    return c.json({ ok: true, created: pushed.created, ...(phone && { phone }) });
  });

  /**
   * Firmanın numaralarını ElevenLabs'te asistana bağlar (numara kaydedilince otomatik çalışır; bu uç yeniden denemek içindir).
   * Netgsm panelindeki SIP Trunk ayarı elle yapılır; burası yalnızca ElevenLabs tarafını kurar.
   */
  app.post("/tenants/:id/phone/connect", async (c) => {
    const id = c.req.param("id");
    const tenant = deps.tenants.get(id);
    if (!tenant) return c.json({ error: "Firma bulunamadı" }, 404);
    if (!deps.connectPhone) return c.json({ error: "Numara bağlama bu sunucuda kapalı" }, 501);
    const r = await connectTenantLine(deps, tenant);
    if (!r.connected) return c.json({ error: r.error }, 502);
    deps.store.audit({ tenantId: id, userId: c.get("admin").id, action: "admin.phone", target: id, detail: { numbers: tenant.phoneNumbers } });
    return c.json({ ok: true, connected: tenant.phoneNumbers });
  });

  /**
   * Landing sayfası test görüşmeleri: özet sayılar ve son istekler.
   * days=0 tüm zamanlar. Numaralar yalnızca yöneticiye tam görünür.
   */
  app.get("/demo-calls", (c) => {
    const days = Math.min(Math.max(Number(c.req.query("days") ?? 30) || 0, 0), 365);
    const nowMs = deps.now().epochMilliseconds;
    const since = days ? nowMs - days * 86_400_000 : 0;
    const calls = deps.demoCalls ?? new DemoCalls(deps.store.db);
    const stats = calls.stats(since, STALE_DEMO_MS, nowMs);
    const rows = calls.list(300).filter((r) => r.createdAt > since);
    return c.json({
      days,
      stats,
      rows: rows.map((r) => ({
        ...r,
        // Sonucu hiç gelmeyen arama: yönetici "devam ediyor" sanmasın
        status: r.status === "calling" && nowMs - r.createdAt > STALE_DEMO_MS ? "unknown" : r.status,
      })),
      enabled: !!deps.demoTenantId && !!deps.startDemoCall,
      tenant: deps.demoTenantId ? deps.tenants.get(deps.demoTenantId)?.name ?? null : null,
    });
  });

  app.patch("/tenants/:id", async (c) => {
    const id = c.req.param("id");
    const tenant = deps.tenants.get(id);
    if (!tenant) return c.json({ error: "Firma bulunamadı" }, 404);
    const parsed = TenantPatch.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "Geçersiz değer" }, 400);
    const p = parsed.data;

    let phones: string[] | undefined;
    if (p.phoneNumbers) {
      phones = [];
      for (const raw of p.phoneNumbers.map((x) => x.trim()).filter(Boolean)) {
        const chk = checkManualNumber(deps, raw, id);
        if (!chk.ok) return c.json({ error: chk.error }, chk.status);
        if (!phones.includes(chk.number)) phones.push(chk.number);
      }
    }

    // Ses yalnızca ElevenLabs'teki Türkçe listeden seçilebilir
    if (p.agent?.voiceId) {
      let allowed: Set<string> | null = null;
      try {
        allowed = deps.voices ? new Set((await deps.voices()).map((v) => v.id)) : null;
      } catch {
        allowed = null;
      }
      if (!allowed?.has(p.agent.voiceId)) return c.json({ error: "Bu ses seçilemez (Türkçe ses listesinde yok ya da liste alınamadı)" }, 422);
    }

    const apply = (raw: Record<string, unknown>) => {
      if (p.agent) {
        const agent = { ...((raw.agent as Record<string, unknown>) ?? {}) };
        if (p.agent.voiceId) agent.voiceId = p.agent.voiceId;
        if (p.agent.name) agent.name = p.agent.name;
        if (p.agent.greeting !== undefined) {
          if (p.agent.greeting?.trim()) agent.greeting = p.agent.greeting.trim();
          else delete agent.greeting;
        }
        raw.agent = agent;
      }
      if (p.plan) raw.plan = { ...((raw.plan as object) ?? {}), id: p.plan, includedMinutes: p.includedMinutes ?? PLANS[p.plan].minutes };
      else if (p.includedMinutes !== undefined) raw.plan = { ...((raw.plan as object) ?? {}), includedMinutes: p.includedMinutes };
      if (phones) raw.phoneNumbers = phones;
      if (p.suspended !== undefined) raw.suspended = p.suspended;
      return raw;
    };
    const editable = deps.tenantStore.getEditable(id);
    const next = TenantSchema.safeParse(apply(structuredClone(deps.tenantStore.getLiveRaw(id) as Record<string, unknown>)));
    if (!next.success) return c.json({ error: "Ayar geçerli değil" }, 422);
    // Asistan kuruluysa ElevenLabs'te de güncellenir; başarısızsa canlı ayar değişmez
    if (p.agent && next.data.agentIds.length) {
      const pushed = await deps.publishAgent(next.data);
      if (!pushed.ok) return c.json({ error: pushed.error }, 502);
    }
    deps.tenantStore.publish(next.data);
    deps.tenants.set(next.data);
    if (p.suspended !== undefined && p.suspended !== tenant.suspended) mailSuspension(deps, next.data, p.suspended);
    if (editable?.hasDraft) deps.tenantStore.saveDraft(id, apply(structuredClone(editable.config as Record<string, unknown>)));

    if (p.plan) {
      db.prepare("UPDATE users SET plan = ? WHERE tenant_id = ? AND role = 'owner'").run(p.plan, id);
    }
    deps.store.audit({ tenantId: id, userId: c.get("admin").id, action: "admin.tenant", target: id, detail: p });

    // Numara gönderildiyse (değişmemiş olsa da) ElevenLabs tarafı da kurulur/güncellenir; böylece yarım kalan bağlama kaydet düğmesiyle tamamlanır. Başarısız olsa bile numara kaydedilmiştir; panel uyarıyı gösterir, yeniden denenebilir.
    if (phones) await syncPoolWithTenantNumbers(deps, id, tenant.phoneNumbers, phones, c.get("admin").id);
    let phone: { connected: boolean; error?: string } | undefined;
    if (phones?.length) phone = await connectTenantLine(deps, next.data);
    return c.json({ ok: true, ...(phone && { phone }) });
  });

  /* ---------------- hat havuzu ---------------- */

  /** Havuz envanteri: durum sayıları, numaralar, hat bekleyen firmalar */
  app.get("/phone-pool", (c) => {
    const pool = poolOf(deps);
    pool.promoteExpired(deps.now().epochMilliseconds);
    const names = new Map(deps.tenants.all().map((t) => [t.id, t.name]));
    return c.json({
      stats: pool.stats(),
      lowStockAt: POOL.lowStockAt,
      quarantineDays: POOL.quarantineDays,
      initialSize: POOL.initialSize,
      numbers: pool.list().map((r) => ({ ...r, tenantName: r.tenantId ? (names.get(r.tenantId) ?? null) : null })),
      waiting: waitingTenants(deps).map((t) => ({ id: t.id, name: t.name })),
    });
  });

  /** Netgsm'den alınan numaraları havuza ekler; hat bekleyen (ödemiş) firmalar varsa kendiliğinden atanır */
  app.post("/phone-pool", async (c) => {
    const parsed = z
      .object({ numbers: z.string().min(1).max(5000), note: z.string().trim().max(200).optional(), renewAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() })
      .safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "Numaraları her satıra bir tane yazın; yenileme tarihi YYYY-AA-GG olmalı" }, 400);
    const raws = parsed.data.numbers.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);
    if (raws.length > 50) return c.json({ error: "Tek seferde en fazla 50 numara eklenebilir" }, 422);
    const renewAt = parsed.data.renewAt ? Temporal.PlainDate.from(parsed.data.renewAt).toZonedDateTime(deps.now().timeZoneId).epochMilliseconds : undefined;
    const r = poolOf(deps).add(raws, { nowMs: deps.now().epochMilliseconds, note: parsed.data.note, renewAt, inUse: (n) => deps.tenants.all().some((t) => t.phoneNumbers.includes(n)) });
    deps.store.audit({ tenantId: null, userId: c.get("admin").id, action: "pool.add", detail: { added: r.added.length, skipped: r.skipped.length } });
    const assigned = r.added.length ? await assignWaiting(deps) : [];
    checkPoolStock(deps);
    return c.json({ ok: true, added: r.added, skipped: r.skipped, assigned });
  });

  /** Firmaya havuzdan elle numara ata (ödeme şartı aranmaz: yönetici kararıdır) */
  app.post("/tenants/:id/assign-number", async (c) => {
    const tenant = deps.tenants.get(c.req.param("id"));
    if (!tenant) return c.json({ error: "Firma bulunamadı" }, 404);
    // test: true → canlı satın alma akışını gerçek numara almadan denemek için sanal "deneme numarası" (ElevenLabs'e bağlanmaz)
    const body = z.object({ test: z.boolean().optional() }).safeParse(await c.req.json().catch(() => ({})));
    const test = body.success && body.data.test === true;
    const r = await assignLine(deps, tenant, { requirePaid: false, actorId: c.get("admin").id, ...(test && { test: true }) });
    if (!r.ok) return c.json({ error: r.message, reason: r.reason }, r.reason === "no_tenant" ? 404 : 409);
    return c.json({ ok: true, number: r.number, connected: r.connected, ...(test && { test: true }), ...(r.note && { note: r.note }) });
  });

  /** Atanmış numarayı bırak: karantinaya alınır, firmadan ve ElevenLabs'ten kaldırılır */
  app.post("/phone-pool/:number/release", async (c) => {
    const r = await releaseLine(deps, c.req.param("number"), c.get("admin").id);
    if (!r.ok) return c.json({ error: r.error }, 409);
    return c.json({ ok: true, disconnected: r.disconnected, ...(r.warning && { warning: r.warning }) });
  });

  /** Müsait ya da karantinadaki numarayı havuzdan kalıcı çıkar (Netgsm'de abonelik bırakıldığında) */
  app.post("/phone-pool/:number/retire", (c) => {
    const n = c.req.param("number");
    if (!poolOf(deps).retire(n)) return c.json({ error: "Yalnızca müsait ya da karantinadaki numara emekli edilebilir" }, 409);
    deps.store.audit({ tenantId: null, userId: c.get("admin").id, action: "pool.retire", target: n });
    checkPoolStock(deps);
    return c.json({ ok: true });
  });

  /** Not ve yıllık yenileme tarihi */
  app.patch("/phone-pool/:number", async (c) => {
    const parsed = z
      .object({ note: z.string().trim().max(200).nullable().optional(), renewAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional() })
      .safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "Geçersiz değer" }, 400);
    const renewAt = parsed.data.renewAt === undefined ? undefined : parsed.data.renewAt === null ? null : Temporal.PlainDate.from(parsed.data.renewAt).toZonedDateTime(deps.now().timeZoneId).epochMilliseconds;
    if (!poolOf(deps).setMeta(c.req.param("number"), { ...(parsed.data.note !== undefined && { note: parsed.data.note }), ...(renewAt !== undefined && { renewAt }) })) return c.json({ error: "Numara havuzda yok" }, 404);
    return c.json({ ok: true });
  });

  return app;
}
