import { useEffect, useRef, useState } from "react";

/** Grafik gerçek piksel genişliğinde çizilir: yazılar her ekranda aynı boyutta kalır */
function useWidth(fallback = 720) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => e && setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/**
 * Rapor grafikleri (kendi SVG'miz). Renkler dataviz doğrulayıcısından geçti
 * (açık zemin #fbfcfb): #2a6fb0, #3f9a73, #d48a0f. Amber'in kontrastı sınırda
 * olduğundan her grafikte açıklama + üzerine gelince değer + tablo görünümü var.
 */
export const SERIES = {
  booked: { color: "#2a6fb0", label: "Randevu alındı" },
  other: { color: "#3f9a73", label: "Diğer cevaplanan" },
  missed: { color: "#d48a0f", label: "Kaçan" },
} as const;

const BAR_MAX = 24;
const GAP = 2;

export function Legend({ items }: { items: { color: string; label: string }[] }) {
  return (
    <ul className="legend">
      {items.map((i) => (
        <li key={i.label}><span className="legend-swatch" style={{ background: i.color }} />{i.label}</li>
      ))}
    </ul>
  );
}

function Tip({ x, y, children }: { x: number; y: number; children: React.ReactNode }) {
  return <div className="chart-tip" style={{ left: x, top: y }} role="status">{children}</div>; // x: piksel
}

/** Günlük çağrılar: altta randevu, ortada diğer cevaplanan, üstte kaçan (yığılmış sütun) */
export function DailyStacked({ days }: { days: { label: string; date: string; calls: number; booked: number; missed: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [ref, W] = useWidth();
  const H = 220, PAD_L = 32, PAD_B = 26, PAD_T = 10;
  const max = Math.max(1, ...days.map((d) => d.calls + d.missed));
  const niceMax = Math.ceil(max / 5) * 5 || 5;
  const band = (W - PAD_L) / days.length;
  const bw = Math.min(BAR_MAX, band * 0.62);
  const sy = (v: number) => ((H - PAD_B - PAD_T) * v) / niceMax;
  const ticks = [0, niceMax / 2, niceMax];
  const labelEvery = Math.ceil(days.length / Math.max(2, Math.floor(W / 64)));

  return (
    <div className="chart" ref={ref} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="Günlük çağrı sayıları">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD_L} x2={W} y1={H - PAD_B - sy(t)} y2={H - PAD_B - sy(t)} className="grid" />
            <text x={PAD_L - 6} y={H - PAD_B - sy(t) + 4} className="axis" textAnchor="end">{t}</text>
          </g>
        ))}
        {days.map((d, i) => {
          const x = PAD_L + band * i + (band - bw) / 2;
          const segs = [
            { v: d.booked, c: SERIES.booked.color },
            { v: d.calls - d.booked, c: SERIES.other.color },
            { v: d.missed, c: SERIES.missed.color },
          ].filter((s) => s.v > 0);
          let base = H - PAD_B;
          return (
            <g key={d.date} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0} aria-label={`${d.label}: ${d.calls} cevaplanan, ${d.booked} randevu, ${d.missed} kaçan`}>
              <rect x={PAD_L + band * i} y={PAD_T} width={band} height={H - PAD_B - PAD_T} fill="transparent" />
              {segs.map((s, j) => {
                // Her segment kendi payını kaplar; üstteki segmentlerin altında 2px zemin boşluğu bırakılır
                const top = base - sy(s.v);
                const bottom = j > 0 ? base - GAP : base;
                const h = Math.max(bottom - top, 1);
                base = top;
                return j === segs.length - 1 ? (
                  <path key={j} d={roundedTop(x, top, bw, h, Math.min(4, h))} fill={s.c} />
                ) : (
                  <rect key={j} x={x} y={top} width={bw} height={h} fill={s.c} />
                );
              })}
              {i % labelEvery === 0 && <text x={x + bw / 2} y={H - 8} className="axis" textAnchor="middle">{d.label}</text>}
            </g>
          );
        })}
      </svg>
      {hover !== null && days[hover] && (
        <Tip x={PAD_L + band * hover + band / 2} y={8}>
          <strong>{days[hover]!.label}</strong>
          <span><i style={{ background: SERIES.booked.color }} />Randevu {days[hover]!.booked}</span>
          <span><i style={{ background: SERIES.other.color }} />Diğer {days[hover]!.calls - days[hover]!.booked}</span>
          <span><i style={{ background: SERIES.missed.color }} />Kaçan {days[hover]!.missed}</span>
        </Tip>
      )}
    </div>
  );
}

/** Saat bazında çağrı yoğunluğu (tek seri: lejant yok, başlık adlandırır) */
export function HourBars({ byHour }: { byHour: { hour: number; calls: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const active = byHour.filter((h) => h.calls > 0);
  const from = active.length ? Math.min(...active.map((h) => h.hour)) : 9;
  const to = active.length ? Math.max(...active.map((h) => h.hour)) : 21;
  const hours = byHour.filter((h) => h.hour >= Math.min(from, 9) && h.hour <= Math.max(to, 20));
  const [ref, W] = useWidth();
  const H = 160, PAD_B = 22, PAD_T = 20;
  const max = Math.max(1, ...hours.map((h) => h.calls));
  const band = W / hours.length;
  const bw = Math.min(BAR_MAX, band * 0.62);
  const peak = hours.reduce((a, b) => (b.calls > a.calls ? b : a), hours[0]!);

  return (
    <div className="chart" ref={ref} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="Saatlere göre çağrı sayısı">
        <line x1={0} x2={W} y1={H - PAD_B} y2={H - PAD_B} className="grid" />
        {hours.map((h, i) => {
          const bh = ((H - PAD_B - PAD_T) * h.calls) / max;
          const x = band * i + (band - bw) / 2;
          return (
            <g key={h.hour} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0} aria-label={`${h.hour}:00 – ${h.calls} çağrı`}>
              <rect x={band * i} y={0} width={band} height={H} fill="transparent" />
              {h.calls > 0 && <path d={roundedTop(x, H - PAD_B - bh, bw, bh, Math.min(4, bh))} fill={SERIES.booked.color} />}
              {i % 2 === 0 && <text x={x + bw / 2} y={H - 6} className="axis" textAnchor="middle">{String(h.hour).padStart(2, "0")}</text>}
              {h === peak && h.calls > 0 && <text x={x + bw / 2} y={H - PAD_B - bh - 6} className="value" textAnchor="middle">{h.calls}</text>}
            </g>
          );
        })}
      </svg>
      {hover !== null && hours[hover] && (
        <Tip x={band * hover + band / 2} y={4}>
          <strong>{String(hours[hover]!.hour).padStart(2, "0")}:00–{String(hours[hover]!.hour + 1).padStart(2, "0")}:00</strong>
          <span>{hours[hover]!.calls} çağrı</span>
        </Tip>
      )}
    </div>
  );
}

/** Yatay sıralı çubuklar (sonuç dağılımı); her satır etiketli olduğu için renk tek */
export function RankBars({ rows }: { rows: { label: string; value: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="rank">
      {rows.map((r) => (
        <li key={r.label}>
          <span className="rank-label">{r.label}</span>
          <span className="rank-track"><span className="rank-bar" style={{ width: `${(r.value / max) * 100}%` }} /></span>
          <span className="rank-value">{r.value}</span>
        </li>
      ))}
    </ul>
  );
}

/** Kullanılan dakika / paket dakikası */
export function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = Math.min(100, (value / max) * 100);
  const over = value > max;
  return (
    <div className="meter" role="meter" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max} aria-label={label}>
      <span className={`meter-fill${pct >= 85 ? " is-high" : ""}`} style={{ width: `${pct}%` }} />
      {over && <span className="meter-over">Paket aşıldı</span>}
    </div>
  );
}

function roundedTop(x: number, y: number, w: number, h: number, r: number) {
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}
