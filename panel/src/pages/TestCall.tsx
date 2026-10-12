import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Conversation } from "@elevenlabs/client";
import { api, type VoiceOption } from "../api.ts";
import { Button, Empty, Icon, Loading, Select } from "../components/ui.tsx";
import { useRouter } from "../router.tsx";
import { HUES, VoiceOrb, hueFor } from "../components/VoiceOrb.tsx";

type Line = { who: "agent" | "user" | "info"; text: string };
type Status = "idle" | "connecting" | "listening" | "speaking";

const STATUS_TEXT: Record<Status, string> = {
  idle: "Hazır",
  connecting: "Bağlanıyor…",
  listening: "Sizi dinliyor, konuşabilirsiniz",
  speaking: "Asistan konuşuyor",
};

/** Denemek için örnek cümleler (müşteri gibi konuşmaya başlamak isteyenler için) */
const IDEAS = ["Yarın için randevu almak istiyorum", "Çalışma saatleriniz nedir?", "Fiyatlarınızı öğrenebilir miyim?", "Adresiniz nerede?", "Randevumu iptal etmek istiyorum"];

/**
 * Yönetici: bir firmanın asistanıyla tarayıcıdan sesli test görüşmesi. Yapılan randevular firmanın gerçek takvimine yazılır.
 * Sahnenin ortasında asistanın sesinin küresi durur; bağlıyken küre canlanır ve konuşan tarafın ses şiddetiyle nefes alır
 * (asistan konuşurken çıkış, siz konuşurken giriş sesi).
 */
export interface TestTenant {
  id: string;
  name: string;
  voiceId: string | null;
  assistantReady: boolean;
}

/** Yönetici sayfası: firma seçilir, seçilen firmanın asistanı denenir */
export function TestCallPage() {
  const { loc, navigate } = useRouter();
  const q = useQuery({ queryKey: ["admin", "tenants"], queryFn: () => api<{ tenants: TestTenant[] }>("/api/admin/tenants") });
  const ready = (q.data?.tenants ?? []).filter((t) => t.assistantReady);
  const wanted = loc.query.get("firma");
  const tenant = ready.find((t) => t.id === wanted) ?? ready[0];

  return (
    <section className="page narrow">
      <header className="page-head">
        <div>
          <h1 className="page-title">Asistanı dene</h1>
          <p className="page-sub">Bir firmanın asistanıyla müşteri gibi konuşun. Bu görüşmede alınan randevular firmanın gerçek takvimine yazılır; denemeden sonra iptal etmeyi unutmayın.</p>
        </div>
        {ready.length > 1 && tenant && (
          <div className="test-picker">
            <Select aria-label="Denenecek firma" value={tenant.id} onChange={(e) => navigate(`/asistani-dene?firma=${e.target.value}`)}>
              {ready.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </div>
        )}
      </header>
      {q.isLoading && <Loading />}
      {q.data && !tenant && <Empty title="Asistanı kurulmuş firma yok">Bir firmanın asistanı kurulunca buradan denenebilir.</Empty>}
      {tenant && <TestCallStage key={tenant.id} tenant={tenant} />}
    </section>
  );
}

function TestCallStage({ tenant }: { tenant: TestTenant }) {
  const [status, setStatus] = useState<Status>("idle");
  const [lines, setLines] = useState<Line[]>([]);
  const conv = useRef<Awaited<ReturnType<typeof Conversation.startSession>> | null>(null);
  const logRef = useRef<HTMLOListElement>(null);
  const stage = useRef<HTMLElement>(null);

  // Küre rengi, ses galerisindekiyle aynı: ses listesindeki sıraya göre
  const voices = useQuery({ queryKey: ["voices", "/api/admin/voices"], queryFn: () => api<{ voices: VoiceOption[]; enabled: boolean; defaultId: string }>("/api/admin/voices"), staleTime: 3_600_000, retry: false });
  const voiceId = tenant.voiceId ?? voices.data?.defaultId ?? "asistan";
  const ids = (voices.data?.voices ?? []).map((v) => v.id).sort();
  const hue = ids.includes(voiceId) ? HUES[ids.indexOf(voiceId) % HUES.length]! : hueFor(voiceId);

  // Not: useEffect işlevi kasıtlı olarak süslü parantezli. Tek ifadeli ok işlevi o ifadenin değerini döndürür;
  // scrollIntoView bazı tarayıcılarda bir değer (söz) döndürdüğü için React "temizleme işlevi değil" hatası verip sayfayı çökertiyordu.
  useEffect(() => {
    return () => {
      void conv.current?.endSession();
    };
  }, []);
  useEffect(() => {
    logRef.current?.lastElementChild?.scrollIntoView({ block: "nearest" });
  }, [lines]);

  // Bağlıyken ses şiddetini kürenin nefesine bağla
  useEffect(() => {
    if (status === "idle" || status === "connecting") return;
    let raf = 0;
    let smooth = 0;
    const tick = () => {
      let v = 0;
      try {
        v = (status === "speaking" ? conv.current?.getOutputVolume() : conv.current?.getInputVolume()) ?? 0;
      } catch {
        /* ses ölçümü yoksa küre yalnızca dönüşle canlı kalır */
      }
      smooth += (Math.min(1, v * 2.4) - smooth) * 0.3;
      stage.current?.style.setProperty("--amp", smooth.toFixed(3));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      stage.current?.style.setProperty("--amp", "0");
    };
  }, [status]);

  /**
   * Gerçek görüşme olmadan sahneyi denemek için: adres sonuna ?demo eklenirse ses/mikrofon kullanılmadan örnek bir
   * görüşme akışı oynatılır (durum geçişleri, mesajlar, küre). Sunucuya ve ElevenLabs'e hiçbir istek gitmez.
   */
  const demo = () => {
    setStatus("connecting");
    const timers: number[] = [];
    const at = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms));
    let speaking = false;
    conv.current = {
      endSession: async () => { timers.forEach(clearTimeout); conv.current = null; setStatus("idle"); },
      getOutputVolume: () => (speaking ? 0.2 + Math.abs(Math.sin(performance.now() / 120)) * 0.4 : 0),
      getInputVolume: () => (speaking ? 0 : 0.15 + Math.abs(Math.sin(performance.now() / 200)) * 0.3),
    } as unknown as NonNullable<typeof conv.current>;
    at(700, () => { setStatus("listening"); });
    at(2200, () => { setLines((x) => [...x, { who: "user", text: "Merhaba, yarın için randevu almak istiyorum." }]); setStatus("speaking"); speaking = true; });
    at(3200, () => setLines((x) => [...x, { who: "agent", text: "Tabii, yarın için uygun saatlere bakıyorum. Hangi saat sizin için uygun olur?" }]));
    at(6500, () => { speaking = false; setStatus("listening"); });
    at(8000, () => { setLines((x) => [...x, { who: "user", text: "Öğleden sonra olursa iyi olur." }]); setStatus("speaking"); speaking = true; });
    at(9500, () => { speaking = false; setStatus("listening"); });
  };

  const start = async () => {
    setLines([]);
    if (new URLSearchParams(location.search).has("demo")) return demo();
    setStatus("connecting");
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      const { conversationToken, dynamicVariables } = await api<{ conversationToken: string; dynamicVariables: Record<string, string> }>("/test-call", { tenant: tenant.id });
      conv.current = await Conversation.startSession({
        conversationToken,
        connectionType: "webrtc",
        dynamicVariables,
        onConnect: () => setStatus("listening"),
        onDisconnect: () => { setStatus("idle"); conv.current = null; },
        // Gelen veriler SDK'dan beklenmedik biçimde gelebilir (boş, nesne vb.); ekranı bozmasın diye metne çevrilir
        onMessage: (m: unknown) => {
          const p = (m ?? {}) as { source?: unknown; role?: unknown; message?: unknown };
          const text = typeof p.message === "string" ? p.message.trim() : "";
          if (!text) return;
          const who = p.source === "user" || p.role === "user" ? "user" : "agent";
          setLines((x) => [...x, { who, text }]);
        },
        onModeChange: (m: unknown) => setStatus((m as { mode?: unknown } | null)?.mode === "speaking" ? "speaking" : "listening"),
        onError: (e: unknown) => setLines((x) => [...x, { who: "info", text: `Hata: ${typeof e === "string" ? e : String((e as Error | undefined)?.message ?? "bilinmeyen hata")}` }]),
      } as Parameters<typeof Conversation.startSession>[0]);
    } catch (e) {
      setStatus("idle");
      const denied = e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "PermissionDeniedError");
      setLines((x) => [...x, { who: "info", text: denied ? "Mikrofon izni verilmedi. Tarayıcının adres çubuğundan mikrofona izin verip tekrar deneyin." : e instanceof Error ? e.message : "Görüşme başlatılamadı" }]);
    }
  };

  const live = status !== "idle";
  const connected = status === "listening" || status === "speaking";

  return (
    <>
      <section ref={stage} className={`card test-stage${live ? " is-live" : ""}`} aria-label="Deneme görüşmesi">
        <div className="test-stage-orb">
          <VoiceOrb id={voiceId} hue={hue} size={156} active={connected} />
        </div>
        <p className="test-stage-status" role="status">{STATUS_TEXT[status]}</p>
        <p className="muted small test-stage-hint">
          {live ? "Cümlenizi bitirince asistan cevap verir. Bitirmek için aşağıdaki düğmeyi kullanın." : "Başlattığınızda tarayıcı mikrofon izni isteyebilir."}
        </p>
        {live ? (
          <Button variant="danger" onClick={() => conv.current?.endSession()} disabled={status === "connecting"}>
            <Icon name="stop" size={16} />Görüşmeyi bitir
          </Button>
        ) : (
          <Button onClick={start}>
            <Icon name="mic" size={18} />Görüşmeyi başlat
          </Button>
        )}
      </section>

      <section className="card test-log" aria-labelledby="konusma">
        <div className="card-head"><h2 id="konusma">Konuşma</h2>{lines.some((l) => l.who !== "info") && <span className="muted small">{lines.filter((l) => l.who !== "info").length} mesaj</span>}</div>
        {lines.length ? (
          <ol className="transcript" ref={logRef}>
            {lines.map((l, i) =>
              l.who === "info" ? (
                <li key={i} className="t-event"><span>{l.text}</span></li>
              ) : (
                <li key={i} className={`t-msg t-${l.who}`}><span className="t-who">{l.who === "agent" ? "Asistan" : "Siz"}</span><p>{l.text}</p></li>
              ),
            )}
          </ol>
        ) : (
          <div className="test-empty">
            <p className="muted">{live ? "Konuşmanız burada yazıya dökülür. Konuşmaya başlayın." : "Görüşmeyi başlattığınızda konuşmanız burada yazıya dökülür."}</p>
            <p className="test-empty-label">Şunları deneyebilirsiniz</p>
            <ul className="test-ideas">
              {IDEAS.map((t) => <li key={t}>“{t}”</li>)}
            </ul>
          </div>
        )}
      </section>
    </>
  );
}
