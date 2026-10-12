import type { CSSProperties } from "react";

/** Her ses kendi renk ailesini taşır: kimliğinden hesaplanır, her seferinde aynıdır. */
export const HUES = [188, 268, 330, 22, 152, 214, 44, 292, 168];
export function hueFor(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return HUES[h % HUES.length]!;
}

/**
 * Prizmatik küre: yön değiştiren iki renk süpürmesi, iç ışık ve cam parlaması.
 * active=true iken (ses çalarken) süpürme hızlanır, dışa halkalar yayılır ve kürenin boyu kökteki --amp (ses şiddeti) ile nefes alır.
 */
export function VoiceOrb({ id, size = 96, active = false, hue }: { id: string; size?: number; active?: boolean; hue?: number }) {
  const style = { "--size": `${size}px`, "--h": hue ?? hueFor(id) } as CSSProperties;
  return (
    <span className={`orb${active ? " is-active" : ""}`} style={style} aria-hidden="true">
      <span className="orb-halo" />
      <span className="orb-ring" />
      <span className="orb-ring orb-ring-2" />
      <span className="orb-body">
        <span className="orb-sweep" />
        <span className="orb-sweep orb-sweep-2" />
        <span className="orb-prism" />
        <span className="orb-shine" />
      </span>
    </span>
  );
}
