import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type Report } from "../api.ts";
import { useToday } from "../App.tsx";
import { useQueryParam } from "../router.tsx";
import { duration, Empty, ErrorBox, Loading, percent, Segmented, tl } from "../components/ui.tsx";
import { DailyStacked, HourBars, Legend, Meter, RankBars, SERIES } from "../components/Charts.tsx";

const addDays = (s: string, n: number) => new Date(new Date(`${s}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);

export function ReportsPage() {
  const today = useToday();
  const todayDate = today.data?.date ?? new Date().toISOString().slice(0, 10);
  const [period, setPeriod] = useQueryParam("donem", "ay");
  const [table, setTable] = useState(false);
  const from = period === "hafta" ? addDays(todayDate, -6) : period === "30" ? addDays(todayDate, -29) : `${todayDate.slice(0, 8)}01`;

  const q = useQuery({ queryKey: ["reports", from, todayDate], queryFn: () => api<Report>(`/reports?from=${from}&to=${todayDate}`) });
  const r = q.data;

  return (
    <section className="page">
      <header className="page-head">
        <div>
          <h1 className="page-title">Raporlar</h1>
          {r && <p className="page-sub">{r.fromText} – {r.toText}</p>}
        </div>
        <Segmented label="Dönem" value={period} onChange={setPeriod} options={[{ value: "hafta", label: "Son 7 gün" }, { value: "ay", label: "Bu ay" }, { value: "30", label: "Son 30 gün" }]} />
      </header>

      {q.isLoading && <Loading />}
      {q.error && <ErrorBox error={q.error} onRetry={() => q.refetch()} />}
      {r && r.totals.incoming === 0 && r.totals.panelBookings === 0 && (
        <Empty title="Bu dönemde çağrı yok">Asistan çağrılara cevap vermeye başladığında sonuçlar burada görünecek.</Empty>
      )}
      {r && (r.totals.incoming > 0 || r.totals.panelBookings > 0) && (
        <>
          {/* Satış argümanı: asistanın kazandırdığı */}
          <section className="card report-hero" aria-labelledby="kazanc">
            <h2 id="kazanc" className="sr-only">Asistanın katkısı</h2>
            <div className="hero-stat">
              <p className="hero-number">{r.totals.assistantBookings}</p>
              <p className="hero-label">randevuyu asistan aldı{r.totals.assistantRevenue ? `, tahmini ${tl(r.totals.assistantRevenue)}` : ""}</p>
            </div>
            <div className="hero-stat">
              <p className="hero-number">{r.totals.afterHoursBookings}</p>
              <p className="hero-label">tanesi mesai dışındaydı{r.totals.afterHoursRevenue ? `, tahmini ${tl(r.totals.afterHoursRevenue)}` : ""}</p>
            </div>
            <p className="hero-note">Tahmini tutar, iptal edilmeyen randevuların hizmet fiyatlarından hesaplanır.</p>
          </section>

          <div className="stat-row">
            <Stat label="Gelen arama" value={r.totals.incoming} />
            <Stat label="Cevaplanan" value={r.totals.answered} />
            <Stat label="Kaçan" value={r.totals.missed} sub={r.totals.incoming ? percent(r.totals.missedRate) : undefined} attention={r.totals.missed > 0} />
            <Stat label="Randevuya dönüşen" value={percent(r.totals.conversionRate)} sub="cevaplanan çağrıların" />
            <Stat label="Ortalama görüşme" value={duration(r.totals.avgDurationSecs)} />
            <Stat label="Panelden girilen" value={r.totals.panelBookings} sub="randevu" />
          </div>

          <section className="card" aria-labelledby="gunluk">
            <div className="card-head">
              <h2 id="gunluk">Günlük çağrılar</h2>
              <button className="link-quiet" onClick={() => setTable(!table)}>{table ? "Grafik olarak göster" : "Tablo olarak göster"}</button>
            </div>
            <Legend items={[SERIES.booked, SERIES.other, SERIES.missed]} />
            {table ? (
              <table className="data-table">
                <thead><tr><th scope="col">Gün</th><th scope="col">Cevaplanan</th><th scope="col">Randevu</th><th scope="col">Kaçan</th></tr></thead>
                <tbody>
                  {r.days.map((d) => (
                    <tr key={d.date}><td>{d.label}</td><td>{d.calls}</td><td>{d.booked}</td><td>{d.missed}</td></tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <DailyStacked days={r.days} />
            )}
          </section>

          <div className="grid-2-wide">
            <section className="card" aria-labelledby="saatler">
              <div className="card-head">
                <h2 id="saatler">Çağrıların geldiği saatler</h2>
              </div>
              <HourBars byHour={r.byHour} />
            </section>

            <section className="card" aria-labelledby="sonuc">
              <div className="card-head"><h2 id="sonuc">Görüşmelerin sonucu</h2></div>
              <RankBars
                rows={[
                  { label: "Randevu alındı", value: r.byOutcome.booked ?? 0 },
                  { label: "Bilgi verildi", value: r.byOutcome.info ?? 0 },
                  { label: "Geri arama istendi", value: r.byOutcome.callback ?? 0 },
                  { label: "Yetkiliye aktarıldı", value: r.byOutcome.transferred ?? 0 },
                  { label: "Kaçan", value: r.totals.missed },
                ]}
              />
            </section>
          </div>

          <section className="card" aria-labelledby="dakika">
            <div className="card-head">
              <h2 id="dakika">Kullanılan dakika</h2>
              <p className="muted">
                {r.totals.minutesUsed} dk{r.totals.includedMinutes ? ` / paketinizde ${r.totals.includedMinutes} dk` : ""}
              </p>
            </div>
            {r.totals.includedMinutes ? (
              <Meter value={r.totals.minutesUsed} max={r.totals.includedMinutes} label="Kullanılan dakika" />
            ) : (
              <p className="muted small">Paket dakikanız tanımlandığında doluluk burada görünecek.</p>
            )}
          </section>
        </>
      )}
    </section>
  );
}

function Stat({ label, value, sub, attention }: { label: string; value: number | string; sub?: string | undefined; attention?: boolean }) {
  return (
    <div className={`stat${attention ? " is-attention" : ""}`}>
      <p className="stat-label">{label}</p>
      <p className="stat-value">{value}</p>
      {sub && <p className="stat-sub">{sub}</p>}
    </div>
  );
}
