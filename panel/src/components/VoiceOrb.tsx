import { useEffect, useRef, useState, type CSSProperties } from "react";

/** Her ses kendi renk ailesini taşır: kimliğinden hesaplanır, her seferinde aynıdır. */
export const HUES = [188, 268, 330, 22, 152, 214, 44, 292, 168];
export function hueFor(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return HUES[h % HUES.length]!;
}

/**
 * Prizmatik küre: yön değiştiren iki renk süpürmesi, iç ışık ve cam parlaması.
 * active=true iken (ses çalarken) hızlı süpürmeler yavaşça belirir, dışa halkalar yayılır ve küre kökteki --amp (ses şiddeti)
 * ile nefes alır. Ses bitince hızlı süpürmeler yaklaşık bir saniyede solarak kaybolur; küre aniden durmaz, yumuşakça sakinleşir.
 * (Dönüş süresi hiç değiştirilmez: süre değişince animasyon zıplar. Hız hissi, ayrı katmanın opaklığıyla verilir.)
 */
export function VoiceOrb({ id, size = 96, active = false, hue }: { id: string; size?: number; active?: boolean; hue?: number }) {
  const style = { "--size": `${size}px`, "--h": hue ?? hueFor(id) } as CSSProperties;

  // Aktiflik bitince hızlı katmanlar sönme süresi boyunca ekranda kalır
  const [settling, setSettling] = useState(false);
  const was = useRef(active);
  useEffect(() => {
    if (active) {
      setSettling(false);
    } else if (was.current) {
      setSettling(true);
      const t = setTimeout(() => setSettling(false), 1200);
      was.current = active;
      return () => clearTimeout(t);
    }
    was.current = active;
  }, [active]);
  const fast = active || settling;

  return (
    <span className={`orb${active ? " is-active" : ""}`} style={style} aria-hidden="true">
      <span className="orb-halo" />
      <span className="orb-ring" />
      <span className="orb-ring orb-ring-2" />
      <span className="orb-body">
        <span className="orb-sweep" />
        <span className="orb-sweep orb-sweep-2" />
        {fast && <span className="orb-sweep orb-sweep-fast" />}
        {fast && <span className="orb-sweep orb-sweep-fast orb-sweep-fast-2" />}
        <span className="orb-prism" />
        <span className="orb-shine" />
      </span>
    </span>
  );
}
