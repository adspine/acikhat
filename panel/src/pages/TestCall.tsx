import { useEffect, useRef, useState } from "react";
import { Conversation } from "@elevenlabs/client";
import { api } from "../api.ts";
import { useMe } from "../App.tsx";
import { Button, Empty } from "../components/ui.tsx";

type Line = { who: "agent" | "user" | "info"; text: string };

/** Asistanla tarayıcıdan sesli test görüşmesi: yapılan randevular gerçek takvime yazılır */
export function TestCallPage() {
  const me = useMe();
  const [status, setStatus] = useState<"idle" | "connecting" | "listening" | "speaking">("idle");
  const [lines, setLines] = useState<Line[]>([]);
  const conv = useRef<Awaited<ReturnType<typeof Conversation.startSession>> | null>(null);
  const logRef = useRef<HTMLOListElement>(null);

  useEffect(() => () => void conv.current?.endSession(), []);
  useEffect(() => logRef.current?.lastElementChild?.scrollIntoView({ block: "nearest" }), [lines]);

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
        onMessage: (m: { source: string; message: string }) => setLines((x) => [...x, { who: m.source === "user" ? "user" : "agent", text: m.message }]),
        onModeChange: (m: { mode: string }) => setStatus(m.mode === "speaking" ? "speaking" : "listening"),
        onError: (e: unknown) => setLines((x) => [...x, { who: "info", text: `Hata: ${String((e as Error)?.message ?? e)}` }]),
      } as Parameters<typeof Conversation.startSession>[0]);
    } catch (e) {
      setStatus("idle");
      setLines((x) => [...x, { who: "info", text: e instanceof Error ? e.message : "Görüşme başlatılamadı" }]);
    }
  };

  if (!me.testCallEnabled) {
    return <section className="page narrow"><Empty title="Asistan henüz kurulmadı">Kurulum tamamlandığında buradan sesli deneyebilirsiniz.</Empty></section>;
  }
  const live = status !== "idle";
  return (
    <section className="page narrow">
      <header className="page-head">
        <div>
          <h1 className="page-title">Asistanı dene</h1>
          <p className="page-sub">Müşteriniz gibi konuşun. Bu görüşmede alınan randevular gerçek takviminize yazılır; denemeden sonra iptal etmeyi unutmayın.</p>
        </div>
      </header>
      <section className={`card test-call${live ? " is-live" : ""}`}>
        <div className="test-call-head">
          <span className={`lamp${live ? " lamp-on" : ""}`} aria-hidden="true" />
          <p role="status">
            {status === "idle" && "Hazır"}
            {status === "connecting" && "Bağlanıyor…"}
            {status === "listening" && "Dinliyor, konuşabilirsiniz"}
            {status === "speaking" && "Asistan konuşuyor"}
          </p>
          {live ? <Button variant="danger" onClick={() => conv.current?.endSession()}>Görüşmeyi bitir</Button> : <Button onClick={start}>Görüşmeyi başlat</Button>}
        </div>
        <ol className="transcript" ref={logRef}>
          {lines.map((l, i) =>
            l.who === "info" ? (
              <li key={i} className="t-event"><span>{l.text}</span></li>
            ) : (
              <li key={i} className={`t-msg t-${l.who}`}><span className="t-who">{l.who === "agent" ? "Asistan" : "Siz"}</span><p>{l.text}</p></li>
            ),
          )}
        </ol>
      </section>
    </section>
  );
}
