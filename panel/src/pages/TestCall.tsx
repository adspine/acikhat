import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Conversation } from "@elevenlabs/client";
import { api, type VoiceOption } from "../api.ts";
import { useMe } from "../App.tsx";
import { Button, Empty, Icon } from "../components/ui.tsx";
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
 * Asistanla tarayıcıdan sesli test görüşmesi: yapılan randevular gerçek takvime yazılır.
 * Sahnenin ortasında asistanın sesinin küresi durur; bağlıyken küre canlanır ve konuşan tarafın ses şiddetiyle nefes alır
 * (asistan konuşurken çıkış, siz konuşurken giriş sesi).
 */
export function TestCallPage() {
  const me = useMe();
  const [status, setStatus] = useState<Status>("idle");
  const [lines, setLines] = useState<Line[]>([]);
  const conv = useRef<Awaited<ReturnType<typeof Conversation.startSession>> | null>(null);
  const logRef = useRef<HTMLOListElement>(null);
  const stage = useRef<HTMLElement>(null);

  // Küre rengi, ses galerisindekiyle aynı: ses listesindeki sıraya göre
  const voices = useQuery({ queryKey: ["voices"], queryFn: () => api<{ voices: VoiceOption[]; enabled: boolean; defaultId: string }>("/voices"), staleTime: 3_600_000, retry: false });
  const voiceId = me.tenant.voiceId ?? voices.data?.defaultId ?? "asistan";
  const ids = (voices.data?.voices ?? []).map((v) => v.id).sort();
  const hue = ids.includes(voiceId) ? HUES[ids.indexOf(voiceId) % HUES.length]! : hueFor(voiceId);

  useEffect(() => () => void conv.current?.endSession(), []);
  useEffect(() => logRef.current?.lastElementChild?.scrollIntoView({ block: "nearest" }), [lines]);

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

  const start = async () => {
    setLines([]);
    setStatus("connecting");
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      const { conversationToken, dynamicVariables } = await api<{ conversationToken: string; dynamicVariables: Record<string, string> }>("/test-call");
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

  if (!me.testCallEnabled) {
    return <section className="page narrow"><Empty title="Asistan henüz kurulmadı">Kurulum tamamlandığında buradan sesli deneyebilirsiniz.</Empty></section>;
  }
  const live = status !== "idle";
  const connected = status === "listening" || status === "speaking";

  return (
    <section className="page narrow">
      <header className="page-head">
        <div>
          <h1 className="page-title">Asistanı dene</h1>
          <p className="page-sub">Müşteriniz gibi konuşun. Bu görüşmede alınan randevular gerçek takviminize yazılır; denemeden sonra iptal etmeyi unutmayın.</p>
        </div>
      </header>

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
    </section>
  );
}
