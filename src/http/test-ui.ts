import { Hono } from "hono";
import type { Deps } from "./deps.ts";
import { initVariables } from "./webhooks.ts";

/**
 * Geliştirme için tarayıcıdan sesli test sayfası: /test/:tenant
 * Telefondaki init webhook'u tarayıcı oturumunda çalışmadığı için
 * dinamik değişkenleri (tarih tablosu vb.) buradan ajana verir.
 * Yalnızca TEST_UI=1 iken açılır.
 */
export function testUiRoutes(deps: Deps) {
  const app = new Hono();

  app.get("/:tenant", (c) => {
    const tenant = deps.tenants.get(c.req.param("tenant"));
    const agentId = tenant?.agentIds[0];
    if (!tenant || !agentId) return c.text("Tenant veya ajan bulunamadı", 404);
    const vars = initVariables(tenant, deps.now(), c.req.query("arayan"));
    return c.html(page(tenant.name, vars));
  });

  /**
   * Görüşme anahtarını sunucu alır (API anahtarı tarayıcıya gitmez).
   * Tarayıcı eklentileri api.elevenlabs.io isteğini engellediğinde de çalışır.
   */
  app.get("/:tenant/session", async (c) => {
    const agentId = deps.tenants.get(c.req.param("tenant"))?.agentIds[0];
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!agentId || !apiKey) return c.json({ error: "agent veya ELEVENLABS_API_KEY eksik" }, 400);
    const ws = c.req.query("mode") === "websocket";
    const res = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/${ws ? "get-signed-url" : "token"}?agent_id=${agentId}`,
      { headers: { "xi-api-key": apiKey } },
    );
    const json = (await res.json()) as { token?: string; signed_url?: string };
    if (!res.ok) return c.json({ error: json }, 502);
    return c.json(ws ? { signedUrl: json.signed_url } : { conversationToken: json.token });
  });

  return app;
}

const esc = (v: string) => String(v).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
/** <script> içine JSON yazarken "</script>" ve satır ayracı karakterleri betiği bitiremesin */
const scriptJson = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

const page = (rawName: string, rawVars: Record<string, string>) => {
  const name = esc(rawName);
  const vars = Object.fromEntries(Object.entries(rawVars).map(([k, v]) => [k, esc(v)]));
  return pageHtml(name, vars, rawVars);
};

const pageHtml = (name: string, vars: Record<string, string>, rawVars: Record<string, string>) => `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${name} – Sesli Test</title>
<style>
  :root { color-scheme: light dark; --bg:#f7f5f2; --fg:#1d1b19; --muted:#6b655e; --card:#fff; --line:#e4dfd8; --accent:#5b4a8b; }
  @media (prefers-color-scheme: dark) { :root { --bg:#151413; --fg:#eeeae4; --muted:#a39c93; --card:#1f1d1b; --line:#34302c; --accent:#a998e0; } }
  * { box-sizing: border-box; }
  body { margin:0; font:16px/1.5 system-ui, sans-serif; background:var(--bg); color:var(--fg); }
  main { max-width:720px; margin:0 auto; padding:32px 16px; }
  h1 { font-size:22px; margin:0 0 4px; }
  p.sub { color:var(--muted); margin:0 0 24px; }
  .row { display:flex; gap:12px; align-items:center; flex-wrap:wrap; margin-bottom:16px; }
  button { font:inherit; padding:12px 20px; border-radius:10px; border:0; background:var(--accent); color:#fff; cursor:pointer; }
  button[disabled] { opacity:.5; cursor:default; }
  #status { color:var(--muted); }
  #log { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:16px; min-height:240px; }
  .m { margin:0 0 10px; } .m b { display:inline-block; min-width:70px; }
  .tool { color:var(--muted); font-size:14px; }
</style>
</head>
<body>
<main>
  <h1>${name} – sesli resepsiyonist testi</h1>
  <p class="sub">Mikrofon izni ver ve telefonla arıyormuş gibi konuş. Tarih: ${vars.today}, saat ${vars.now_time}. Arayan numara: ${vars.caller_phone_spoken}</p>
  <div class="row">
    <button id="start">Görüşmeyi başlat</button>
    <button id="stop" disabled>Bitir</button>
    <span id="status">Hazır</span>
  </div>
  <div id="log"></div>
</main>
<script type="module">
  import { Conversation } from "https://cdn.jsdelivr.net/npm/@elevenlabs/client@1.27.0/+esm";
  const vars = ${scriptJson(rawVars)};
  const $ = (id) => document.getElementById(id);
  const log = (who, text, cls = "") => {
    const p = document.createElement("p"); p.className = "m " + cls;
    const b = document.createElement("b"); b.textContent = who;
    p.append(b, " ", text); $("log").append(p); p.scrollIntoView({ block: "end" });
  };
  let conv;
  const callbacks = {
    dynamicVariables: vars,
    onConnect: () => { $("status").textContent = "Bağlandı, konuşabilirsin"; $("stop").disabled = false; },
    onDisconnect: () => { $("status").textContent = "Görüşme bitti"; $("start").disabled = false; $("stop").disabled = true; },
    onMessage: (m) => log(m.source === "user" ? "Sen:" : "Ajan:", m.message),
    onModeChange: (m) => { if (conv) $("status").textContent = m.mode === "speaking" ? "Ajan konuşuyor" : "Dinliyor"; },
    onError: (e) => log("Hata:", String(e?.message ?? e), "tool"),
  };
  const session = async (mode) => {
    const r = await fetch(location.pathname.replace(/\\/$/, "") + "/session?mode=" + mode);
    if (!r.ok) throw new Error("Sunucu anahtar alamadı: " + (await r.text()));
    return r.json();
  };
  $("start").onclick = async () => {
    $("start").disabled = true; $("status").textContent = "Bağlanıyor…";
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      try {
        conv = await Conversation.startSession({ ...(await session("webrtc")), connectionType: "webrtc", ...callbacks });
      } catch (e) {
        // WebRTC (UDP) ağ/eklenti tarafından engellenirse WebSocket ile dene
        log("Bilgi:", "WebRTC bağlanamadı (" + (e?.message ?? e) + "), WebSocket deneniyor…", "tool");
        conv = await Conversation.startSession({ ...(await session("websocket")), connectionType: "websocket", ...callbacks });
      }
    } catch (e) {
      log("Hata:", String(e?.message ?? e), "tool");
      $("start").disabled = false; $("status").textContent = "Başlatılamadı";
    }
  };
  $("stop").onclick = () => conv?.endSession();
</script>
</body>
</html>`;
