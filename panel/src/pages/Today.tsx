import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type Callback } from "../api.ts";
import { can, useMe, useToday } from "../App.tsx";
import { Link } from "../router.tsx";
import { Button, Empty, ErrorBox, Icon, Loading, OutcomePill } from "../components/ui.tsx";
import { AppointmentList, Schedule } from "../components/Schedule.tsx";
import { AppointmentDrawer, NewAppointmentDrawer } from "../components/AppointmentDrawers.tsx";

export function TodayPage() {
  const me = useMe();
  const today = useToday();
  const callbacks = useQuery({
    queryKey: ["callbacks", "open"],
    queryFn: () => api<{ items: Callback[] }>("/callbacks?status=open"),
    enabled: can(me, "calls.view"),
    refetchInterval: 30_000,
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  if (today.isLoading) return <Loading />;
  if (today.error || !today.data) return <section className="page"><ErrorBox error={today.error} onRetry={() => today.refetch()} /></section>;
  const t = today.data;
  const hoursText = t.open ? t.hours.map(([f, to]) => `${f}–${to}`).join(", ") : null;
  const byAssistant = t.appointments.filter((a) => a.source === "assistant").length;

  return (
    <section className="page">
      <header className="page-head">
        <div>
          <h1 className="page-title">{t.dateText}</h1>
          <p className="page-sub">{hoursText ? `Açık, ${hoursText}` : "Bugün kapalı"}</p>
        </div>
        {can(me, "appointments.edit") && (
          <Button onClick={() => setCreating(true)}><Icon name="plus" />Randevu ekle</Button>
        )}
      </header>

      {t.alerts.map((a, i) => (
        <div key={i} className={`banner banner-${a.level}`} role={a.level === "error" ? "alert" : undefined}>{a.text}{a.link && <> <Link to={a.link.to}>{a.link.label}</Link></>}</div>
      ))}

      <div className="today-grid">
        {can(me, "appointments.view") && (
          <section className="card today-schedule" aria-labelledby="bugun-randevular">
            <div className="card-head">
              <h2 id="bugun-randevular">Randevular</h2>
              <p className="muted">
                {t.appointments.length ? `${t.appointments.length} randevu${byAssistant ? `, ${byAssistant} tanesini asistan aldı` : ""}` : "Bugün randevu yok"}
              </p>
            </div>
            <div className="only-wide">
              <Schedule columns={t.staff} appointments={t.appointments} open={t.hours} nowTime={t.nowTime} onSelect={(a) => setSelected(a.id)} staffTerm={me.terms.staffTerm} />
            </div>
            <div className="only-narrow">
              <AppointmentList appointments={t.appointments} onSelect={(a) => setSelected(a.id)} empty="Bugün randevu yok." />
            </div>
          </section>
        )}

        <div className="today-side">
          {can(me, "calls.view") && (
            <section className={`card${t.counts.openCallbacks ? " card-attention" : ""}`} aria-labelledby="bugun-geri">
              <div className="card-head">
                <h2 id="bugun-geri">Geri aranacaklar</h2>
                {!!t.counts.openCallbacks && <span className="count-attention">{t.counts.openCallbacks}</span>}
              </div>
              {!callbacks.data?.items.length ? (
                <p className="muted">Bekleyen geri arama yok.</p>
              ) : (
                <ul className="mini-list">
                  {callbacks.data.items.slice(0, 4).map((c) => (
                    <li key={c.id}>
                      <span className="mini-main">{c.name ?? c.phoneText ?? "Numara yok"}</span>
                      <span className="mini-sub">{c.reason}</span>
                      <span className="mini-meta">{c.dayText} {c.timeText}</span>
                    </li>
                  ))}
                </ul>
              )}
              {!!callbacks.data?.items.length && <Link to="/geri-aramalar" className="card-link">Tümünü aç</Link>}
            </section>
          )}

          {can(me, "calls.view") && (
            <section className="card" aria-labelledby="bugun-cagri">
              <div className="card-head">
                <h2 id="bugun-cagri">Son çağrılar</h2>
                <p className="muted">Bugün {t.counts.callsToday} görüşme{t.counts.missedToday ? `, ${t.counts.missedToday} kaçan` : ""}</p>
              </div>
              {!t.recent.length ? (
                <Empty title="Henüz çağrı yok">Asistanın cevapladığı görüşmeler burada görünecek.</Empty>
              ) : (
                <ul className="mini-list">
                  {t.recent.map((c) => (
                    <li key={c.id}>
                      <Link to={c.kind === "call" ? `/cagrilar?gorusme=${c.id}` : "/cagrilar"} className="mini-link">
                        <span className="mini-main">{c.phoneText}</span>
                        <OutcomePill outcome={c.outcome} label={c.outcomeLabel} />
                        <span className="mini-meta">{c.dayText} {c.timeText}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              <Link to="/cagrilar" className="card-link">Tüm çağrılar</Link>
            </section>
          )}
        </div>
      </div>

      <AppointmentDrawer id={selected} onClose={() => setSelected(null)} />
      {can(me, "appointments.edit") && <NewAppointmentDrawer open={creating} onClose={() => setCreating(false)} initialDate={t.date} />}
    </section>
  );
}
