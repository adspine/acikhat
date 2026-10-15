import { Hono } from "hono";
import { z } from "zod";
import type { Deps } from "./deps.ts";
import { normalizeTrPhone } from "../domain/phone.ts";
import { checkLineNumber } from "./phone-line.ts";
import { createTenantFromSubmission } from "./tenant-create.ts";
import { OnboardingSchema } from "../domain/onboarding-schema.ts";
import { userFromCookie } from "./panel/session.ts";
import { mailLineSubmitted, mailSubmission } from "../notify/emails.ts";

export { OnboardingSchema };


export function onboardingRoutes(deps: Deps) {
  const app = new Hono();

  app.post("/onboarding", async (c) => {
    const raw = await c.req.text();
    if (raw.length > 100_000) return c.json({ ok: false, error: "Form çok büyük" }, 413);
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw);
    } catch {
      return c.json({ ok: false, error: "Form okunamadı, sayfayı yenileyip tekrar deneyin" }, 400);
    }
    // Bot tuzağı: görünmeyen alan doluysa sessizce kabul edip kaydetme
    if (typeof body.company_fax === "string" && body.company_fax) return c.json({ ok: true, reference: "OK" });

    // Form yalnızca giriş yapmış ve paketini ödemiş üyeye açıktır (yönetici hesabı istisna)
    const user = userFromCookie(c, deps);
    if (!user) return c.json({ ok: false, error: "Kurulum formu için önce giriş yapın" }, 401);
    const journey = deps.users.onboardingOf(user.id);
    if (!journey.paidAt && user.role !== "agency") return c.json({ ok: false, error: "Kurulum formu için önce paketinizi seçip ödemeyi tamamlayın" }, 402);

    delete body.line; // hat bilgisi yalnızca doğrulanarak yazılır
    const parsed = OnboardingSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { ok: false, error: "Bazı alanlar eksik", fields: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
        422,
      );
    }
    // Formda 0850/sabit hat numarası yazıldıysa doğrulanır; yazılmadıysa üye 3. adımda numara almaya yönlendirilir
    const declared = parsed.data.phone.assistantNumber?.trim();
    if (declared) {
      const chk = checkLineNumber(deps, declared, { strict: true });
      if (!chk.ok) return c.json({ ok: false, error: "Bazı alanlar eksik", fields: [{ path: "phone.assistantNumber", message: chk.error }] }, 422);
      parsed.data.line = { number: chk.number, source: "form", at: Date.now() };
    }
    // Paketi ödenmiş üyenin başvurusu hesabına bağlanır (kurulum yolculuğunun 3. adımı)
    const owner = journey.paidAt ? user : null;
    const reference = deps.store.saveOnboarding({
      businessName: parsed.data.business.name,
      contactPhone: normalizeTrPhone(parsed.data.contact.phone)!,
      payload: parsed.data,
      ...(owner && { userId: owner.id, plan: journey.plan ?? undefined }),
    });
    if (owner) deps.users.setOnboardingRef(owner.id, reference);
    console.info(`[onboarding] yeni başvuru ${reference}: ${parsed.data.business.name}`);
    mailSubmission(deps, {
      reference,
      businessName: parsed.data.business.name,
      person: parsed.data.contact.person,
      phone: parsed.data.contact.phone,
      sector: parsed.data.business.sector,
      memberEmail: owner?.email ?? null,
      contactEmail: parsed.data.contact.email || undefined,
      plan: owner ? (journey.plan ?? null) : null,
    });
    // Ödemiş üyenin firması hemen oluşturulur: üye panele girer ve numara adımını panelde rehberle tamamlar.
    // Firma canlı sayılmaz (asistan ve numara yönetici onayıyla bağlanır). Oluşturulamazsa başvuru yönetici inceleyene kadar bekler.
    if (owner) {
      const made = createTenantFromSubmission(deps, { reference, userId: owner.id, form: parsed.data });
      if (made.ok) return c.json({ ok: true, reference, tenantCreated: true });
      console.error(`[onboarding] firma otomatik oluşturulamadı (${reference}): ${made.error}`);
    }
    return c.json({ ok: true, reference });
  });

  /**
   * Kurulumun 3. adımı: üye Netgsm'den numarasını aldıktan sonra numarayı ve gerekli bilgileri gönderir.
   * Firma onaylanana kadar tekrar gönderilebilir (numara değiştirmek için). Başarılı olunca yolculuk 4. adıma (onay bekleniyor) geçer.
   */
  const Line = z.object({
    number: z.string().trim().min(1, "Numaranızı yazın").max(32),
    subscriptionType: z.enum(["onodemeli", "faturali"], "Abonelik türünü seçin"),
    sipConfigured: z.literal(true, "Netgsm SIP ayarını yaptığınızı onaylayın"),
    ownerConfirmed: z.literal(true, "Numaranın sizin adınıza kayıtlı olduğunu onaylayın"),
  });
  app.post("/onboarding/line", async (c) => {
    const user = userFromCookie(c, deps);
    if (!user) return c.json({ ok: false, error: "Önce giriş yapın" }, 401);
    const journey = deps.users.onboardingOf(user.id);
    if (!journey.paidAt || !journey.reference) return c.json({ ok: false, error: "Önce paketinizi ödeyip kurulum formunu gönderin" }, 409);
    if (user.tenantId) return c.json({ ok: false, error: "Firmanız zaten kurulmuş. Numarayı değiştirmek için bize yazın." }, 409);
    const parsed = Line.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ ok: false, error: parsed.error.issues[0]?.message ?? "Eksik bilgi" }, 422);
    const chk = checkLineNumber(deps, parsed.data.number, { strict: true });
    if (!chk.ok) return c.json({ ok: false, error: chk.error }, chk.status);
    const row = deps.store.db.prepare("SELECT payload_json FROM onboarding_submissions WHERE reference = ?").get(journey.reference) as { payload_json: string } | undefined;
    if (!row) return c.json({ ok: false, error: "Başvuru bulunamadı" }, 404);
    const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
    payload.line = { number: chk.number, subscriptionType: parsed.data.subscriptionType, sipConfigured: true, source: "step3", at: Date.now() };
    deps.store.db.prepare("UPDATE onboarding_submissions SET payload_json = ? WHERE reference = ?").run(JSON.stringify(payload), journey.reference);
    deps.store.audit({ tenantId: null, userId: user.id, action: "onboarding.line", target: chk.number });
    mailLineSubmitted(deps, { reference: journey.reference, number: chk.number, memberEmail: user.email, subscriptionType: parsed.data.subscriptionType });
    return c.json({ ok: true, number: chk.number });
  });

  return app;
}
