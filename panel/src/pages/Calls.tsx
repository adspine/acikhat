import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type CallDetail, type CallItem, type Outcome } from "../api.ts";
import { useToday } from "../App.tsx";
import { useQueryParam } from "../router.tsx";
import { Drawer, duration, Empty, ErrorBox, Icon, Input, Loading, OutcomePill, Segmented } from "../components/ui.tsx";
import { AppointmentDrawer } from "../components/AppointmentDrawers.tsx";

const FILTERS: { value: "" | Outcome; label: string }[] = [
  { value: "", label: "Tümü" },
  { value: "booked", label: "Randevu" },
  { value: "callback", label: "Geri arama" },
  { value: "transferred", label: "Aktarıldı" },
  { value: "info", label: "Bilgi" },
  { value: "missed", label: "Kaçan" },
];

const addDays = (s: string, n: number) => new Date(new Date(`${s}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);

export function CallsPage() {
  const today = useToday();
  const todayDate = today.data?.date ?? new Date().toISOString().slice(0, 10);
  const [period, setPeriod] = useQueryParam("donem", "7");
  const [outcome, setOutcome] = useQueryParam("sonuc", "");
  const [openId, setOpenId] = useQueryParam("gorusme", "");
  const [search, setSearch] = useState("");
  const from = period === "1" ? todayDate : addDays(todayDate, -(Number(period) - 1));

  const q = useQuery({
    queryKey: ["calls", from, todayDate, outcome],
    queryFn: () => api<{ items: CallItem[] }>(`/calls?from=${from}&to=${todayDate}${outcome ? `&outcome=${outcome}` : ""}`),
    refetchInterval: 30_000,
  });
  const digits = search.replace(/\D/g, "").replace(/^0/, "");
  const items = (q.data?.items ?? []).filter((c) => !digits || (c.callerPhone ?? "").includes(digits));

  // Güne göre grupla
  const groups: { day: string; items: CallItem[] }[] = [];
  for (const c of items) {
    const last = groups.at(-1);
    if (last?.day === c.dayText) last.items.push(c);
    else groups.push({ day: c.dayText, items: [c] });
  }

  return (
    <section className="page">
      <header className="page-head">
        <div>
          <h1 className="page-title">Çağrılar</h1>
          <p className="page-sub">Asistanın cevapladığı ve kaçan tüm aramalar</p>
        </div>
      </header>

      <div className="toolbar">
        <Segmented label="Dönem" value={period} onChange={setPeriod} options={[{ value: "1", label: "Bugün" }, { value: "7", label: "7 gün" }, { value: "30", label: "30 gün" }]} />
        <div className="search">
          <Icon name="search" size={18} />
          <Input type="search" inputMode="tel" placeholder="Numara ara" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Telefon numarasına göre ara" />
        </div>
      </div>
      <div className="chips" role="radiogroup" aria-label="Sonuca göre süz">
        {FILTERS.map((f) => (
          <button key={f.value} role="radio" aria-checked={outcome === f.value} className={`chip chip-${f.value || "all"}`} onClick={() => setOutcome(f.value)}>
            {f.label}
          </button>
        ))}
      </div>

      {q.isLoading && <Loading />}
      {q.error && <ErrorBox error={q.error} onRetry={() => q.refetch()} />}
      {q.data && !items.length && (
        <Empty title="Bu süzgeçle çağrı yok">{outcome || search ? "Süzgeçleri değiştirip tekrar deneyin." : "Asistan bir çağrıya cevap verdiğinde burada görünecek."}</Empty>
      )}
      {groups.map((g) => (
        <section key={g.day} className="call-group">
          <h2 className="section-label">{g.day}</h2>
          <ul className="call-list">
            {g.items.map((c) => (
              <li key={c.id}>
                <button className={`call-row${c.kind === "missed" ? " is-missed" : ""}`} onClick={() => c.kind === "call" && setOpenId(c.id)} disabled={c.kind === "missed"}>
                  <span className="call-time">{c.timeText}</span>
                  <span className="call-main">
                    <span className="call-phone">{c.phoneText}{c.afterHours && <span className="tag">Mesai dışı</span>}</span>
                    <span className="call-summary">{c.summary ?? "Özet yok"}</span>
                  </span>
                  <span className="call-side">
                    <OutcomePill outcome={c.outcome} label={c.outcomeLabel} />
                    {c.durationSecs != null && <span className="call-duration">{duration(c.durationSecs)}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <CallDrawer id={openId || null} onClose={() => setOpenId("")} />
    </section>
  );
}

function CallDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const q = useQuery({ queryKey: ["call", id], queryFn: () => api<CallDetail>(`/calls/${id}`), enabled: !!id });
  const [appt, setAppt] = useState<string | null>(null);
  const c = q.data;
  return (
    <>
      <Drawer open={!!id} onClose={onClose} title={c ? c.phoneText : "Görüşme"} wide>
        {q.isLoading && <Loading />}
        {q.error && <ErrorBox error={q.error} />}
        {c && (
          <div className="stack">
            <div className="call-head">
              <OutcomePill outcome={c.outcome} label={c.outcomeLabel} />
              <span className="muted">{c.dayText} {c.timeText}{c.durationSecs != null ? `, ${duration(c.durationSecs)}` : ""}</span>
              {c.afterHours && <span className="tag">Mesai dışı</span>}
            </div>
            {c.summary && (
              <section>
                <h3 className="section-label">Asistanın özeti</h3>
                <p>{c.summary}</p>
              </section>
            )}
            {c.appointmentId && <button className="btn btn-quiet btn-sm" onClick={() => setAppt(c.appointmentId)}>Alınan randevuyu aç</button>}
            {c.callerPhone && <a className="btn btn-quiet btn-sm" href={`tel:${c.callerPhone}`}><Icon name="phone" size={18} />Arayanı ara</a>}
            <section>
              <h3 className="section-label">Görüşme dökümü</h3>
              <ol className="transcript">
                {c.transcript.map((t, i) =>
                  t.role === "event" ? (
                    <li key={i} className="t-event"><span>{t.text}</span></li>
                  ) : (
                    <li key={i} className={`t-msg t-${t.role}`}>
                      <span className="t-who">{t.role === "agent" ? "Asistan" : "Arayan"}</span>
                      <p>{t.text}</p>
                    </li>
                  ),
                )}
              </ol>
            </section>
          </div>
        )}
      </Drawer>
      <AppointmentDrawer id={appt} onClose={() => setAppt(null)} />
    </>
  );
}
