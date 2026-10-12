import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type OrderItem, type Usage } from "../api.ts";
import { Button, ErrorBox, Icon, Loading, Modal, useToast } from "../components/ui.tsx";
import { Meter } from "../components/Charts.tsx";

const usd = (n: number) => `$${new Intl.NumberFormat("tr-TR", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }).format(n)}`;
const dk = (n: number) => `${new Intl.NumberFormat("tr-TR").format(n)} dk`;
const when = (ms: number) => new Date(ms).toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" });

/** Onay bekleyen satın alma: kullanıcı tutarı görüp onaylar */
interface Draft {
  kind: "addon" | "plan";
  id: string;
  title: string;
  /** Modalda gösterilen özet satırları */
  lines: [string, string][];
  note: string;
  amountUsd: number;
  confirmLabel?: string;
}

/** Paketim: kullanım, paket değiştirme (yükseltme anında, düşürme dönem sonunda) ve ek dakika paketi satın alma */
export function UsagePage() {
  const q = useQuery({ queryKey: ["usage"], queryFn: () => api<Usage>("/usage"), refetchInterval: 60_000 });
  const orders = useQuery({ queryKey: ["orders"], queryFn: () => api<{ orders: OrderItem[] }>("/orders") });
  const qc = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ask = (d: Draft) => { setDraft(d); setDone(null); setOpen(true); };
  const u = q.data;
  const max = Math.max(1, ...(u?.perDay.map((d) => d.minutes) ?? [1]));
  const pct = u?.includedMinutes ? Math.min(100, Math.round((u.usedMinutes / u.includedMinutes) * 100)) : null;

  const confirm = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      if (draft.kind === "addon") {
        const r = await api<{ minutes: number }>("/addons", { method: "POST", body: { pack: draft.id } });
        setDone(`${dk(r.minutes)} ek dakika kotanıza eklendi ve hemen kullanılabilir.`);
      } else {
        const r = await api<{ kind: string; effectiveText?: string }>("/plan-change", { method: "POST", body: { plan: draft.id } });
        setDone(r.kind === "downgrade" ? `Paketiniz ${r.effectiveText} tarihinde değişecek. O zamana kadar mevcut kotanızı kullanmaya devam edersiniz.` : r.kind === "cancelled" ? "Planlanan geçiş iptal edildi; mevcut paketinizle devam ediyorsunuz." : "Paketiniz yükseltildi ve yeni kotanız hemen kullanılabilir.");
      }
      void qc.invalidateQueries({ queryKey: ["usage"] });
      void qc.invalidateQueries({ queryKey: ["orders"] });
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "İşlem tamamlanamadı", "error");
    } finally {
      setBusy(false);
    }
  };

  const closeModal = () => !busy && setOpen(false);
  const askPlan = (p: Usage["plans"][number]) => {
    if (!u) return;
    if (p.relation === "upgrade") {
      ask({ kind: "plan", id: p.id, title: `${p.name} paketine yükselt`, lines: [["Yeni paket", `${p.name} · ${dk(p.minutes)}`], ["Aylık ücret", `${usd(p.priceUsd)} (KDV dahil)`], ["Bu ay için fark", usd(p.chargeUsd)]], note: `Paketiniz hemen değişir. Ayın kalan günleri için aradaki fark tahsil edilir; sonraki aylarda ${usd(p.priceUsd)} / ay ödersiniz.`, amountUsd: p.chargeUsd });
    } else {
      ask({ kind: "plan", id: p.id, title: `${p.name} paketine geç`, lines: [["Yeni paket", `${p.name} · ${dk(p.minutes)}`], ["Geçiş tarihi", u.renewsText], ["Aylık ücret", `${usd(p.priceUsd)} (KDV dahil)`]], note: "Bu ay mevcut paketinizle devam edersiniz. Geçiş dönem sonunda kendiliğinden yapılır; ücret alınmaz.", amountUsd: 0, confirmLabel: "Dönem sonunda geç" });
    }
  };

  return (
    <section className="page">
      <header className="page-head">
        <div>
          <h1 className="page-title">Paketim</h1>
          {u && <p className="page-sub">{u.periodText} · dönem sonuna {u.daysLeft} gün</p>}
        </div>
      </header>
      {q.isLoading && <Loading />}
      {q.error && <ErrorBox error={q.error} onRetry={() => q.refetch()} />}
      {u && (
        <>
          {u.suspended && <p className="suspended-banner" role="alert">Hizmetiniz askıda; asistan aramaları karşılamıyor. Bu süre içinde satın alma yapılamaz.</p>}
          {u.testMode && <p className="usage-request" role="status">Test modu: satın almalarda ücret alınmaz. Gerçek ödeme altyapısı bağlandığında bu uyarı kalkar.</p>}

          <section className="card usage-hero">
            <div className="usage-plan">
              <p className="muted small">Mevcut paketiniz</p>
              <p className="usage-plan-name">{u.plan ? u.plan.name : "Tanımlı değil"}</p>
              {u.plan && <p className="muted">{usd(u.plan.priceUsd)} / ay · KDV dahil</p>}
              {u.pending && <p className="usage-pending">{u.renewsText} tarihinde <strong>{u.pending.name}</strong> paketine geçecek.</p>}
            </div>
            <div className="usage-meter">
              <div className="usage-numbers">
                <strong>{dk(u.usedMinutes)}</strong>
                <span className="muted">{u.includedMinutes ? `/ ${dk(u.includedMinutes)} kullanıldı${pct !== null ? ` (%${pct})` : ""}` : "kullanıldı"}</span>
              </div>
              {u.includedMinutes ? <Meter value={u.usedMinutes} max={u.includedMinutes} label="Bu ay kullanılan dakika" /> : <p className="muted small">Paket dakikanız tanımlandığında doluluk burada görünür.</p>}
              {u.addonMinutes > 0 && <p className="muted small">Kotanız: {dk(u.planMinutes ?? 0)} paket + {dk(u.addonMinutes)} ek paket</p>}
            </div>
          </section>

          <div className="stat-row stat-row-4">
            <div className="stat"><p className="stat-label">Kalan dakika</p><p className="stat-value">{u.remainingMinutes === null ? "—" : dk(u.remainingMinutes)}</p></div>
            <div className="stat"><p className="stat-label">Ay sonu tahmini</p><p className="stat-value">{dk(u.projectedMinutes)}</p><p className="stat-sub">bu hızla devam ederse</p></div>
            <div className={`stat${u.overageMinutes > 0 ? " is-attention" : ""}`}><p className="stat-label">Kota aşımı</p><p className="stat-value">{u.overageMinutes ? dk(u.overageMinutes) : "Yok"}</p>{u.overageMinutes > 0 && <p className="stat-sub">{usd(u.overageUsd)} ek ücret</p>}</div>
            <div className={`stat${u.projectedOverageUsd > 0 ? " is-attention" : ""}`}><p className="stat-label">Tahmini aşım ücreti</p><p className="stat-value">{u.projectedOverageUsd ? usd(u.projectedOverageUsd) : "Yok"}</p><p className="stat-sub">ay sonu için</p></div>
          </div>

          {u.includedMinutes !== null && u.projectedMinutes > u.includedMinutes && (
            <p className="usage-warn" role="status">
              Bu hızla gidilirse ay sonunda kotanızı yaklaşık {dk(u.projectedMinutes - u.includedMinutes)} aşacaksınız. Aşağıdan ek dakika paketi alarak ya da bir üst pakete geçerek aşım ücretinden kaçınabilirsiniz.
            </p>
          )}

          <Modal
            open={open}
            onClose={closeModal}
            dismissible={!busy}
            title={done ? "İşlem tamamlandı" : (draft?.title ?? "")}
            footer={
              done ? (
                <Button onClick={() => setOpen(false)} data-autofocus>Tamam</Button>
              ) : (
                <>
                  <Button variant="ghost" onClick={closeModal} disabled={busy}>Vazgeç</Button>
                  <Button onClick={confirm} busy={busy} data-autofocus>{draft?.confirmLabel ?? (draft && draft.amountUsd > 0 ? `${usd(draft.amountUsd)} öde` : "Onayla")}</Button>
                </>
              )
            }
          >
            {done ? (
              <div className="buy-done" role="status">
                <span className="done-mark" aria-hidden="true"><svg width="30" height="30" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4.5 10.5 8 14l7.5-8" /></svg></span>
                <p>{done}</p>
              </div>
            ) : (
              draft && (
                <>
                  <ul className="buy-lines">
                    {draft.lines.map(([k, v]) => <li key={k}><span>{k}</span><strong>{v}</strong></li>)}
                    <li className="is-total"><span>{draft.amountUsd > 0 ? "Şimdi ödenecek" : "Şimdi ödenecek tutar"}</span><strong>{draft.amountUsd > 0 ? usd(draft.amountUsd) : "Yok"}</strong></li>
                  </ul>
                  <p className="buy-note">{draft.note}{draft.amountUsd > 0 && u.testMode ? " Test modunda ücret alınmaz." : ""}</p>
                </>
              )
            )}
          </Modal>

          <section className="card" aria-labelledby="ek-paketler">
            <div className="card-head"><h2 id="ek-paketler">Ek dakika paketleri</h2><span className="muted small">tek seferlik · KDV dahil</span></div>
            <p className="muted small">Kotanız biterken ihtiyaç duyduğunuz kadar ek dakika alın. Satın alma anında kotanıza eklenir, yalnızca bu dönem geçerlidir ve sonraki aya devretmez. Ek dakika, aşım ücretinden ({usd(u.overagePerMinuteUsd)} / dk) daha uygundur.</p>
            <div className="plan-cards">
              {u.packs.map((p) => (
                <div key={p.id} className="plan-card">
                  <p className="plan-card-name">{dk(p.minutes)}</p>
                  <p className="plan-card-price">{usd(p.priceUsd)}</p>
                  <p className="muted small">dakikası {usd(Math.round((p.priceUsd / p.minutes) * 100) / 100)}</p>
                  <Button size="sm" variant="quiet" disabled={u.suspended || busy} onClick={() => ask({ kind: "addon", id: p.id, title: `${dk(p.minutes)} ek paket`, lines: [["Ürün", `${dk(p.minutes)} ek dakika`], ["Geçerlilik", "Bu dönem sonuna kadar"], ["Tutar", `${usd(p.priceUsd)} (KDV dahil)`]], note: "Dakikalar satın alma anında kotanıza eklenir. Dönem sonunda kullanılmayan kısım sonraki aya devretmez.", amountUsd: p.priceUsd })}>Satın al</Button>
                </div>
              ))}
            </div>
          </section>

          <section className="card" aria-labelledby="paketler">
            <div className="card-head"><h2 id="paketler">Paketler</h2><span className="muted small">KDV dahil, aylık</span></div>
            <p className="muted small">Yükseltme hemen geçerli olur, ayın kalan günleri için fark ödenir. Düşürme ücretsizdir ve dönem sonunda kendiliğinden uygulanır; o zamana kadar mevcut kotanızı kullanırsınız.</p>
            <div className="plan-cards">
              {u.plans.map((p) => {
                const current = p.relation === "same";
                const scheduled = u.pending?.plan === p.id;
                return (
                  <div key={p.id} className={`plan-card${current ? " is-current" : ""}`}>
                    <p className="plan-card-name">{p.name}{current && <span className="pill"> Mevcut</span>}</p>
                    <p className="plan-card-price">{usd(p.priceUsd)}<span className="muted small"> / ay</span></p>
                    <p className="muted small">{dk(p.minutes)} dahil</p>
                    {current && u.pending && (
                      <Button size="sm" variant="quiet" disabled={busy} onClick={() => ask({ kind: "plan", id: p.id, title: "Planlanan geçişi iptal et", lines: [["Planlanan", `${u.pending!.name} paketine geçiş`], ["Devam edilecek", `${p.name} paketi`]], note: "Geçiş iptal edilir, paketiniz değişmeden devam eder.", amountUsd: 0, confirmLabel: "Geçişi iptal et" })}>Geçişi iptal et</Button>
                    )}
                    {!current && (
                      <Button size="sm" variant="quiet" disabled={scheduled || u.suspended || busy} onClick={() => askPlan(p)}>
                        {scheduled ? "Dönem sonunda geçilecek" : p.relation === "upgrade" ? `Yükselt · ${usd(p.chargeUsd)} fark` : "Dönem sonunda bu pakete geç"}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="card">
            <div className="card-head"><h2>Günlük kullanım</h2><span className="muted small">dakika</span></div>
            <div className="admin-bars" style={{ gridTemplateColumns: `repeat(${u.perDay.length}, minmax(0, 1fr))` }} role="img" aria-label="Bu ayın günlük dakika kullanımı">
              {u.perDay.map((d) => (
                <span key={d.date} className="admin-bar" title={`${d.label}. gün: ${d.minutes} dk`}>
                  <span style={{ height: `${(d.minutes / max) * 100}%` }} />
                </span>
              ))}
            </div>
            {u.usedMinutes === 0 && <p className="muted small">Bu ay henüz görüşme yok.</p>}
          </section>

          {!!orders.data?.orders.length && (
            <section className="card" aria-labelledby="siparisler">
              <div className="card-head"><h2 id="siparisler">Satın alma geçmişi</h2></div>
              <table className="data-table">
                <thead><tr><th scope="col">Tarih</th><th scope="col">Ürün</th><th scope="col">Tutar</th></tr></thead>
                <tbody>
                  {orders.data.orders.map((o) => (
                    <tr key={o.id}><td>{when(o.paidAt)}</td><td>{o.label}</td><td>{usd(o.amountUsd)}</td></tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          <p className="muted small usage-foot">
            Dakikalar her ayın başında yenilenir. Kota bitince her ek dakika {usd(u.overagePerMinuteUsd)} (KDV dahil) olarak hesaplanır. Sorularınız için <a href="mailto:destek@acikhat.ai">destek@acikhat.ai</a>.
          </p>
        </>
      )}
    </section>
  );
}
