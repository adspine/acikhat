import { Hono } from "hono";
import { z } from "zod";
import type { Deps } from "./deps.ts";
import { DemoCalls } from "../store/demo-calls.ts";
import { isTrMobile, normalizeTrPhone, spokenPhone } from "../domain/phone.ts";
import { DEMO_MAX_SECONDS } from "../agent/demo-call.ts";

/** Bir numaranın deneyebileceği toplam test görüşmesi */
export const DEMO_MAX_PER_PHONE = 2;
/** Aynı IP'den 24 saatte açılabilecek görüşme ve 1 saatte yapılabilecek istek (engellenenler dahil) */
const IP_CALLS_PER_DAY = 4;
const IP_ATTEMPTS_PER_HOUR = 8;
/** Tüm ziyaretçiler için 24 saatlik üst sınır (maliyet ve kötüye kullanım freni) */
const DEFAULT_DAILY_LIMIT = 60;
/** Görüşme sonucu bu süre içinde gelmediyse aynı numaraya yeniden arama açılabilir */
const ACTIVE_WINDOW_MS = 4 * 60_000;
/** Arama saatleri (İstanbul): yabancı bir numarayı gece aramayız */
const OPEN_HOUR = 8;
const CLOSE_HOUR = 23;

const Body = z.object({
  phone: z.string().trim().max(32),
  consent: z.literal(true),
  /** Bal tuzağı: gizli alan; botlar doldurur, insanlar görmez */
  website: z.string().optional(),
});

const mask = (e164: string) => {
  const s = spokenPhone(e164);
  return `${s.slice(0, 4)} *** ** ${s.slice(-2)}`;
};

/**
 * Landing sayfası "test görüşmesi": ziyaretçinin girdiği cep numarasını demo firmanın 0850 hattından arar.
 * Kayıtsız ve herkese açık olduğu için başkasının numarasını girerek rahatsız etmeye karşı katmanlı sınır:
 * numara başına 2 görüşme, IP başına sınır, günlük genel sınır, arama saatleri, onay kutusu ve bal tuzağı.
 */
export function demoRoutes(deps: Deps) {
  const app = new Hono();
  const demo = () => {
    const tenant = deps.demoTenantId ? deps.tenants.get(deps.demoTenantId) : undefined;
    return tenant && !tenant.suspended && tenant.agentIds.length && tenant.phoneNumbers.length && deps.startDemoCall ? tenant : null;
  };
  const dailyLimit = () => Number(process.env.DEMO_DAILY_LIMIT) || DEFAULT_DAILY_LIMIT;

  /** Sayfa kartı bu cevaba göre açılır ya da gizlenir */
  app.get("/demo-call", (c) => c.json({ enabled: !!demo(), name: demo()?.name ?? null, maxSeconds: DEMO_MAX_SECONDS, maxPerNumber: DEMO_MAX_PER_PHONE }));

  app.post("/demo-call", async (c) => {
    const tenant = demo();
    if (!tenant) return c.json({ code: "closed", error: "Test görüşmesi şu an kapalı." }, 503);

    const parsed = Body.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ code: "consent", error: "Aranmayı ve görüşmenin kaydedilmesini onaylayın." }, 400);
    // Bal tuzağı dolu: başarılı gibi görünür, hiçbir şey yapılmaz
    if (parsed.data.website) return c.json({ ok: true, remaining: 0, maxSeconds: DEMO_MAX_SECONDS, masked: "" });

    const phone = normalizeTrPhone(parsed.data.phone);
    if (!phone || !isTrMobile(phone)) return c.json({ code: "invalid_phone", error: "Geçerli bir cep numarası yazın (05xx xxx xx xx)." }, 422);

    const ip = c.req.header("fly-client-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
    const nowMs = deps.now().epochMilliseconds;
    const calls = deps.demoCalls ?? new DemoCalls(deps.store.db);
    const block = (reason: "limit" | "busy" | "ip" | "daily" | "hours", status: 403 | 429 | 503, error: string) => {
      calls.insert({ id: crypto.randomUUID(), phone, ip, status: "blocked", blockReason: reason, atMs: nowMs });
      return c.json({ code: reason, error }, status);
    };

    const hour = deps.now().withTimeZone(tenant.timezone).hour;
    if (hour < OPEN_HOUR || hour >= CLOSE_HOUR) return block("hours", 403, `Test görüşmeleri ${String(OPEN_HOUR).padStart(2, "0")}.00 ile ${CLOSE_HOUR}.00 arasında yapılır.`);
    if (calls.attemptsForIp(ip, nowMs - 3_600_000) >= IP_ATTEMPTS_PER_HOUR) return block("ip", 429, "Çok fazla deneme yapıldı. Bir saat sonra tekrar deneyin.");
    if (calls.countForPhone(phone) >= DEMO_MAX_PER_PHONE) {
      return block("limit", 429, `Bu numara ${DEMO_MAX_PER_PHONE} test görüşmesi hakkını kullandı. Asistanı kendi hattınızda kurmak için hemen başlayabilirsiniz.`);
    }
    if (calls.hasActive(phone, nowMs - ACTIVE_WINDOW_MS)) return block("busy", 429, "Bu numaraya zaten bir test görüşmesi yapılıyor.");
    if (calls.countForIp(ip, nowMs - 86_400_000) >= IP_CALLS_PER_DAY) return block("ip", 429, "Bu bağlantıdan bugün çok fazla test görüşmesi istendi. Yarın tekrar deneyin.");
    if (calls.countSince(nowMs - 86_400_000) >= dailyLimit()) return block("daily", 503, "Bugünkü test görüşmesi kontenjanı doldu. Yarın tekrar deneyin.");

    // Satır, arama başlamadan eklenir: eş zamanlı iki istek aynı hakkı iki kez kullanamaz
    const id = crypto.randomUUID();
    const attempt = calls.countForPhone(phone) + 1;
    calls.insert({ id, phone, ip, status: "calling", attempt, atMs: nowMs });
    const started = await deps.startDemoCall!(tenant, { phone, demoId: id });
    if (!started.ok) {
      console.error(`[demo] arama başlatılamadı (${mask(phone)}): ${started.error}`);
      calls.markFailed(id, started.error, deps.now().epochMilliseconds);
      // Numara meşgul/kapalı/yok: kullanıcıya doğru yazıp yazmadığını sor
      if (/(486|480|603|404|484)|busy|unavailable|not found/i.test(started.error)) {
        return c.json({ code: "unreachable", error: "Bu numaraya şu an ulaşılamadı. Numarayı kontrol edip biraz sonra tekrar deneyin; hakkınız düşmedi." }, 422);
      }
      return c.json({ code: "failed", error: "Arama şu an başlatılamadı. Biraz sonra tekrar deneyin; hakkınız düşmedi." }, 502);
    }
    calls.setConversation(id, started.conversationId);
    return c.json({ ok: true, remaining: DEMO_MAX_PER_PHONE - attempt, maxSeconds: DEMO_MAX_SECONDS, masked: mask(phone) });
  });

  return app;
}
