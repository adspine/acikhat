import type { Appointment } from "../api.ts";

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h! * 60 + m!;
};
const timeOf = (iso: string) => iso.slice(11, 16);
const PX_PER_MIN = 1.1;

export interface ScheduleColumn {
  id: string;
  name: string;
  working: boolean;
  hours: [string, string][];
}

/**
 * Günlük takvim: personel sütunları × saat satırları.
 * Randevu bloğunun altındaki açık bölüm hazırlık/temizlik süresidir (o saat neden boş değil sorusunun cevabı).
 */
export function Schedule({
  columns, appointments, open, nowTime, onSelect, staffTerm,
}: {
  columns: ScheduleColumn[];
  appointments: Appointment[];
  open: [string, string][];
  nowTime?: string | undefined;
  onSelect: (a: Appointment) => void;
  staffTerm: string;
}) {
  const working = columns.filter((c) => c.working || appointments.some((a) => a.staff.some((s) => s.id === c.id)));
  const bounds = [...open, ...working.flatMap((c) => c.hours)];
  if (!bounds.length && !appointments.length) return null;
  const startMin = Math.min(...bounds.map(([f]) => toMin(f)), ...appointments.map((a) => toMin(a.startText))) ;
  const endMin = Math.max(...bounds.map(([, t]) => toMin(t)), ...appointments.map((a) => toMin(timeOf(a.blockEnd))));
  const first = Math.floor(startMin / 60) * 60;
  const last = Math.ceil(endMin / 60) * 60;
  const hours = Array.from({ length: (last - first) / 60 }, (_, i) => first + i * 60);
  const y = (min: number) => (min - first) * PX_PER_MIN;
  const height = (last - first) * PX_PER_MIN;

  return (
    <div className="schedule" role="region" aria-label="Günlük takvim">
      <div className="schedule-head" style={{ gridTemplateColumns: `52px repeat(${working.length}, minmax(140px, 1fr))` }}>
        <span />
        {working.map((c) => (
          <div key={c.id} className="schedule-col-head">
            <span className="schedule-col-name">{c.name}</span>
            <span className="schedule-col-hours">{c.working ? c.hours.map(([f, t]) => `${f}–${t}`).join(", ") : "Çalışmıyor"}</span>
          </div>
        ))}
      </div>
      <div className="schedule-body" style={{ gridTemplateColumns: `52px repeat(${working.length}, minmax(140px, 1fr))`, height }}>
        <div className="schedule-times">
          {hours.map((h) => (
            <span key={h} style={{ top: y(h) }}>{String(h / 60).padStart(2, "0")}:00</span>
          ))}
        </div>
        {working.map((c) => (
          <div key={c.id} className="schedule-col">
            {hours.map((h) => <span key={h} className="schedule-line" style={{ top: y(h) }} />)}
            {/* Çalışma saati dışı gri */}
            <OffHours hours={c.hours} y={y} first={first} last={last} />
            {appointments
              .filter((a) => a.staff.some((s) => s.id === c.id))
              .map((a) => {
                const top = y(toMin(a.startText));
                const h = (toMin(a.endText) - toMin(a.startText)) * PX_PER_MIN;
                const buffer = (toMin(timeOf(a.blockEnd)) - toMin(a.endText)) * PX_PER_MIN;
                const partners = a.staff.filter((s) => s.id !== c.id).map((s) => s.name);
                return (
                  <button
                    key={a.id}
                    className={`appt appt-${a.source}${h < 58 ? " appt-compact" : ""}`}
                    style={{ top, height: h }}
                    onClick={() => onSelect(a)}
                    aria-label={`${a.startText} ${a.serviceName}, ${a.customerName}${partners.length ? `, ${partners.join(" ve ")} ile` : ""}`}
                  >
                    <span className="appt-time">{a.startText}–{a.endText}</span>
                    <span className="appt-title">{a.customerName}</span>
                    <span className="appt-sub">{a.serviceName}{partners.length ? `, ${partners.join(" ve ")} ile` : ""}</span>
                    {a.source === "assistant" && <span className="appt-src" title="Asistan aldı">Asistan</span>}
                    {buffer > 0 && <span className="appt-buffer" style={{ height: buffer }} title="Hazırlık süresi" />}
                  </button>
                );
              })}
            {nowTime && toMin(nowTime) >= first && toMin(nowTime) <= last && <span className="now-line" style={{ top: y(toMin(nowTime)) }} />}
          </div>
        ))}
      </div>
      {!working.length && <p className="muted">Bugün çalışan {staffTerm} yok.</p>}
    </div>
  );
}

function OffHours({ hours, y, first, last }: { hours: [string, string][]; y: (m: number) => number; first: number; last: number }) {
  const ranges: [number, number][] = [];
  let cur = first;
  for (const [f, t] of [...hours].sort()) {
    if (toMin(f) > cur) ranges.push([cur, toMin(f)]);
    cur = Math.max(cur, toMin(t));
  }
  if (cur < last) ranges.push([cur, last]);
  return (
    <>
      {ranges.map(([a, b]) => (
        <span key={a} className="schedule-off" style={{ top: y(a), height: y(b) - y(a) }} />
      ))}
    </>
  );
}

/** Telefonda takvim yerine sade liste */
export function AppointmentList({ appointments, onSelect, empty }: { appointments: Appointment[]; onSelect: (a: Appointment) => void; empty: string }) {
  if (!appointments.length) return <p className="muted">{empty}</p>;
  return (
    <ul className="appt-list">
      {appointments.map((a) => (
        <li key={a.id}>
          <button className={`appt-row${a.status === "cancelled" ? " is-cancelled" : ""}`} onClick={() => onSelect(a)}>
            <span className="appt-row-time">{a.startText}</span>
            <span className="appt-row-main">
              <span className="appt-row-title">{a.customerName}</span>
              <span className="appt-row-sub">{a.serviceName}, {a.staff.map((s) => s.name).join(" ve ")}</span>
            </span>
            {a.status === "cancelled" ? <span className="pill pill-cancelled">İptal</span> : a.source === "assistant" && <span className="pill pill-assistant">Asistan</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}
