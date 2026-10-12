import { DatePicker } from "../components/DatePicker.tsx";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type Appointment } from "../api.ts";
import { can, useMe, useToday } from "../App.tsx";
import { useQueryParam } from "../router.tsx";
import { Button, Checkbox, Empty, ErrorBox, Icon, Loading, Segmented } from "../components/ui.tsx";
import { AppointmentList, Schedule } from "../components/Schedule.tsx";
import { AppointmentDrawer, NewAppointmentDrawer } from "../components/AppointmentDrawers.tsx";

const DAYS = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"];
const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

// Tarih hesabı yalnızca takvim günü düzeyinde (saat dilimi sunucuda); UTC ile kayma olmaz
const parse = (s: string) => new Date(`${s}T00:00:00Z`);
const fmt = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => fmt(new Date(parse(s).getTime() + n * 86_400_000));
const weekday = (s: string) => (parse(s).getUTCDay() + 6) % 7; // 0 = Pazartesi
const label = (s: string) => {
  const d = parse(s);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${DAYS[weekday(s)]}`;
};

type View = "gun" | "hafta" | "liste";

export function AppointmentsPage() {
  const me = useMe();
  const today = useToday();
  const todayDate = today.data?.date ?? fmt(new Date());
  const [date, setDate] = useQueryParam("tarih", todayDate);
  const [view, setView] = useQueryParam("gorunum", "gun") as [View, (v: View) => void];
  const [showCancelled, setShowCancelled] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const range = useMemo(() => {
    if (view === "gun") return { from: date, to: date };
    const monday = addDays(date, -weekday(date));
    return view === "hafta" ? { from: monday, to: addDays(monday, 6) } : { from: date, to: addDays(date, 13) };
  }, [view, date]);

  const q = useQuery({
    queryKey: ["appointments", range.from, range.to, showCancelled],
    queryFn: () => api<{ appointments: Appointment[]; day?: { open: [string, string][]; staff: { id: string; name: string; working: boolean; hours: [string, string][] }[] } }>(`/appointments?from=${range.from}&to=${range.to}${showCancelled ? "&cancelled=1" : ""}`),
    refetchInterval: 30_000,
  });

  const step = view === "gun" ? 1 : 7;
  const title =
    view === "gun"
      ? label(date)
      : `${label(range.from).split(" ").slice(0, 2).join(" ")} – ${label(range.to).split(" ").slice(0, 2).join(" ")}`;
  const isToday = date === todayDate;

  // Gün görünümünde sütunlar ve çalışma saatleri o gün için sunucudan gelir
  const columns = q.data?.day?.staff ?? [];

  return (
    <section className="page">
      <header className="page-head">
        <div>
          <h1 className="page-title">Randevular</h1>
          <p className="page-sub">{title}</p>
        </div>
        {can(me, "appointments.edit") && <Button onClick={() => setCreating(true)}><Icon name="plus" />Randevu ekle</Button>}
      </header>

      <div className="toolbar">
        <div className="date-nav">
          <button className="icon-btn" onClick={() => setDate(addDays(date, -step))} aria-label="Önceki"><Icon name="left" /></button>
          <Button variant="quiet" size="sm" onClick={() => setDate(todayDate)} disabled={isToday}>Bugün</Button>
          <button className="icon-btn" onClick={() => setDate(addDays(date, step))} aria-label="Sonraki"><Icon name="right" /></button>
          <DatePicker className="input-date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Tarih seç" />
        </div>
        <Segmented
          label="Görünüm"
          value={view}
          onChange={setView}
          options={[{ value: "gun", label: "Gün" }, { value: "hafta", label: "Hafta" }, { value: "liste", label: "Liste" }]}
        />
        <Checkbox label="İptalleri göster" checked={showCancelled} onChange={setShowCancelled} />
      </div>

      {q.isLoading && <Loading />}
      {q.error && <ErrorBox error={q.error} onRetry={() => q.refetch()} />}
      {q.data && view === "gun" && (
        <div className="card">
          <div className="only-wide">
            {q.data.appointments.length || isToday ? (
              <Schedule
                columns={columns}
                appointments={q.data.appointments.filter((a) => a.status === "confirmed")}
                open={q.data.day?.open ?? []}
                nowTime={isToday ? today.data?.nowTime : undefined}
                onSelect={(a) => setSelected(a.id)}
                staffTerm={me.terms.staffTerm}
              />
            ) : (
              <Empty title="Bu gün randevu yok" action={can(me, "appointments.edit") ? <Button variant="quiet" onClick={() => setCreating(true)}>Randevu ekle</Button> : undefined} />
            )}
            {showCancelled && q.data.appointments.some((a) => a.status === "cancelled") && (
              <>
                <h3 className="section-label">İptal edilenler</h3>
                <AppointmentList appointments={q.data.appointments.filter((a) => a.status === "cancelled")} onSelect={(a) => setSelected(a.id)} empty="" />
              </>
            )}
          </div>
          <div className="only-narrow">
            <AppointmentList appointments={q.data.appointments} onSelect={(a) => setSelected(a.id)} empty="Bu gün randevu yok." />
          </div>
        </div>
      )}
      {q.data && view !== "gun" && (
        <DayGroups from={range.from} to={range.to} appointments={q.data.appointments} onSelect={(a) => setSelected(a.id)} todayDate={todayDate} onPickDay={(d) => { setDate(d); setView("gun"); }} />
      )}

      <AppointmentDrawer id={selected} onClose={() => setSelected(null)} />
      {can(me, "appointments.edit") && <NewAppointmentDrawer open={creating} onClose={() => setCreating(false)} initialDate={date} />}
    </section>
  );
}

/** Hafta ve liste görünümü: günlere bölünmüş sade liste */
function DayGroups({ from, to, appointments, onSelect, todayDate, onPickDay }: {
  from: string; to: string; appointments: Appointment[]; onSelect: (a: Appointment) => void; todayDate: string; onPickDay: (d: string) => void;
}) {
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  return (
    <div className="day-groups">
      {days.map((d) => {
        const list = appointments.filter((a) => a.date === d);
        return (
          <section key={d} className={`card day-group${d === todayDate ? " is-today" : ""}`}>
            <div className="card-head">
              <h2><button className="link-quiet" onClick={() => onPickDay(d)}>{label(d)}</button></h2>
              <p className="muted">{(() => { const n = list.filter((a) => a.status === "confirmed").length; return n ? `${n} randevu` : "Randevu yok"; })()}</p>
            </div>
            {!!list.length && <AppointmentList appointments={list} onSelect={onSelect} empty="" />}
          </section>
        );
      })}
    </div>
  );
}
