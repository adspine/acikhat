import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, setAdminTenant } from "../api.ts";
import { useRouter } from "../router.tsx";
import { Button, Drawer, Empty, ErrorBox, Field, Input, Loading, Segmented, Select, Textarea, useToast } from "../components/ui.tsx";
import { RankBars } from "../components/Charts.tsx";
import { SubmissionEditor } from "./SubmissionEditor.tsx";
import { ActionMenu } from "../components/ActionMenu.tsx";
import { VoicePicker, type AgentIdentity } from "../components/VoicePicker.tsx";

/* ---------------- tipler ve etiketler ---------------- */
type Status = "new" | "reviewing" | "approved" | "live" | "rejected";
type PlanId = "baslangic" | "standart" | "pro";

interface Overview {
  members: number; paid: number; mrrUsd: number; byPlan: Record<PlanId, number>;
  submissions: Record<Status, number>; tenants: number; suspended: number; salesPanel30Usd: number; calls30: number; appointments30: number;
  callsByDay: { date: string; calls: number }[];
}
interface SubmissionItem {
  reference: string; businessName: string; sector: string; contactPhone: string; status: Status; createdAt: number;
  tenantId: string | null; plan: PlanId | null; paid: boolean; member: { email: string; name: string | null } | null; note: string | null;
}
interface SubmissionDetail extends SubmissionItem {
  payload: Record<string, any>;
  checklist: string[];
}
interface TenantItem {
  id: string; name: string; vertical: string; assistantReady: boolean; hasPhone: boolean; owner: string | null;
  plan: PlanId | null; calls30: number; appointments30: number; includedMinutes: number | null; minutesUsed: number;
  phoneNumbers: string[]; voiceId: string | null; suspended: boolean; pendingPlan: PlanId | null; addonMinutes: number; planMinutes: number | null;
}

export const SECTOR_LABELS: Record<string, string> = {
  spa: "Spa ve wellness", guzellik: "Güzellik, kuaför", saglik: "Diş ve sağlık kliniği", emlak: "Gayrimenkul", otel: "Otel",
  restoran: "Restoran, kafe", fitness: "Spor salonu", servis: "Oto ve teknik servis", danismanlik: "Avukat, danışmanlık", diger: "Diğer",
};
const STATUS_LABELS: Record<Status, string> = { new: "Yeni", reviewing: "İnceleniyor", approved: "Onaylandı", live: "Canlıda", rejected: "Reddedildi" };
const PLAN_LABELS: Record<PlanId, string> = { baslangic: "Başlangıç", standart: "Standart", pro: "Pro" };
const usd = (n: number) => `$${new Intl.NumberFormat("tr-TR").format(n)}`;
const when = (ms: number) => new Date(ms).toLocaleString("tr-TR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

const StatusPill = ({ status }: { status: Status }) => <span className={`pill admin-status admin-status-${status}`}>{STATUS_LABELS[status]}</span>;

function Stat({ label, value, sub, attention }: { label: string; value: number | string; sub?: string; attention?: boolean }) {
  return (
    <div className={`stat${attention ? " is-attention" : ""}`}>
      <p className="stat-label">{label}</p>
      <p className="stat-value">{value}</p>
      {sub && <p className="stat-sub">{sub}</p>}
    </div>
  );
}

/* ---------------- genel bakış ---------------- */
export function AdminOverviewPage({ go }: { go: (to: string) => void }) {
  const q = useQuery({ queryKey: ["admin", "overview"], queryFn: () => api<Overview>("/api/admin/overview"), refetchInterval: 60_000 });
  const o = q.data;
  const max = Math.max(1, ...(o?.callsByDay.map((d) => d.calls) ?? [1]));
  return (
    <section className="page">
      <header className="page-head">
        <div>
          <h1 className="page-title">Genel bakış</h1>
          <p className="page-sub">Üyelik, satış ve kullanım özeti</p>
        </div>
      </header>
      {q.isLoading && <Loading />}
      {q.error && <ErrorBox error={q.error} onRetry={() => q.refetch()} />}
      {o && (
        <>
          <div className="stat-row stat-row-var" style={{ "--cols": o.salesPanel30Usd > 0 ? 7 : 6 } as React.CSSProperties}>
            <Stat label="Üye" value={o.members} />
            <Stat label="Ödenen paket" value={o.paid} sub={o.members ? `üyelerin %${Math.round((o.paid / o.members) * 100)}'i` : undefined} />
            <Stat label="Aylık gelir" value={usd(o.mrrUsd)} sub="ödenen paketlerden" />
            <Stat label="Bekleyen başvuru" value={o.submissions.new + o.submissions.reviewing} attention={o.submissions.new > 0} sub={o.submissions.new ? `${o.submissions.new} yeni` : undefined} />
            <Stat label="Firma" value={o.tenants} sub={o.suspended ? `${o.suspended} askıda` : undefined} />
            {o.salesPanel30Usd > 0 && <Stat label="Panel satışı" value={usd(o.salesPanel30Usd)} sub="son 30 gün, ek paket ve yükseltme" />}
            <Stat label="Çağrı (30 gün)" value={o.calls30} sub={`${o.appointments30} randevu`} />
          </div>

          <div className="grid-2-wide">
            <section className="card">
              <div className="card-head"><h2>Son 30 gün çağrı</h2><span className="muted small">tüm firmalar</span></div>
              <div className="admin-bars" role="img" aria-label="Günlük çağrı sayısı, son 30 gün">
                {o.callsByDay.map((d) => (
                  <span key={d.date} className="admin-bar" title={`${d.date}: ${d.calls}`}>
                    <span style={{ height: `${(d.calls / max) * 100}%` }} />
                  </span>
                ))}
              </div>
              {o.calls30 === 0 && <p className="muted small">Henüz çağrı yok. Firmalar yayına alınınca burada görünecek.</p>}
            </section>
            <section className="card">
              <div className="card-head"><h2>Paket dağılımı</h2></div>
              {o.paid ? (
                <RankBars rows={(Object.keys(PLAN_LABELS) as PlanId[]).map((p) => ({ label: PLAN_LABELS[p], value: o.byPlan[p] }))} />
              ) : (
                <p className="muted">Henüz ödenen paket yok.</p>
              )}
            </section>
          </div>

          <section className="card">
            <div className="card-head"><h2>Başvurular</h2><button className="link-quiet" onClick={() => go("/basvurular")}>Hepsini gör</button></div>
            <div className="admin-pills">
              {(Object.keys(STATUS_LABELS) as Status[]).map((s) => (
                <button key={s} className="admin-count" onClick={() => go(`/basvurular?durum=${s}`)}>
                  <strong>{o.submissions[s]}</strong>
                  <span>{STATUS_LABELS[s]}</span>
                </button>
              ))}
            </div>
          </section>
        </>
      )}
    </section>
  );
}

/* ---------------- başvurular ---------------- */
export function AdminSubmissionsPage({ initialStatus }: { initialStatus: string }) {
  const [filter, setFilter] = useState<string>(initialStatus);
  const [openRef, setOpenRef] = useState("");
  const q = useQuery({ queryKey: ["admin", "submissions"], queryFn: () => api<{ submissions: SubmissionItem[] }>("/api/admin/submissions"), refetchInterval: 30_000 });
  const rows = (q.data?.submissions ?? []).filter((s) => !filter || s.status === filter);
  return (
    <section className="page">
      <header className="page-head">
        <div>
          <h1 className="page-title">Başvurular</h1>
          <p className="page-sub">Kurulum formunu dolduran işletmeler. Onaylayınca firma oluşur ve üye kendi panosuna girer.</p>
        </div>
        <Segmented
          label="Durum"
          value={filter}
          onChange={setFilter}
          options={[{ value: "", label: "Tümü" }, { value: "new", label: "Yeni" }, { value: "reviewing", label: "İnceleniyor" }, { value: "approved", label: "Onaylı" }, { value: "rejected", label: "Reddedilen" }]}
        />
      </header>
      {q.isLoading && <Loading />}
      {q.error && <ErrorBox error={q.error} onRetry={() => q.refetch()} />}
      {q.data && !rows.length && <Empty title="Başvuru yok">Bu filtreye uyan başvuru bulunmuyor.</Empty>}
      {rows.length > 0 && (
        <div className="card admin-table-card">
          <table className="data-table admin-table">
            <thead>
              <tr><th>İşletme</th><th>Sektör</th><th>Üye</th><th>Paket</th><th>Durum</th><th>Tarih</th></tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.reference} tabIndex={0} onClick={() => setOpenRef(s.reference)} onKeyDown={(e) => e.key === "Enter" && setOpenRef(s.reference)}>
                  <td className="cell-main"><strong>{s.businessName}</strong><span className="muted small admin-ref">{s.reference}</span></td>
                  <td data-label="Sektör">{SECTOR_LABELS[s.sector] ?? s.sector}</td>
                  <td data-label="Üye">{s.member ? s.member.email : <span className="muted">Üyesiz</span>}</td>
                  <td data-label="Paket">{s.plan ? <>{PLAN_LABELS[s.plan]}{s.paid ? <span className="admin-paid"> ödendi</span> : <span className="muted"> bekliyor</span>}</> : <span className="muted">—</span>}</td>
                  <td data-label="Durum"><StatusPill status={s.status} /></td>
                  <td className="muted" data-label="Tarih">{when(s.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <SubmissionDrawer reference={openRef} onClose={() => setOpenRef("")} />
    </section>
  );
}

const DAYS = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];

function Detail({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="admin-detail">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function SubmissionDrawer({ reference, onClose }: { reference: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState<Status>("new");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadedRef, setLoadedRef] = useState("");
  const [created, setCreated] = useState<{ tenantId: string; checklist: string[] } | null>(null);
  const [editing, setEditing] = useState(false);
  const [json, setJson] = useState("");
  const [jsonErrors, setJsonErrors] = useState<string[]>([]);

  const q = useQuery({
    queryKey: ["admin", "submission", reference],
    queryFn: () => api<SubmissionDetail>(`/api/admin/submissions/${reference}`),
    enabled: !!reference,
  });
  const d = q.data;
  if (d && loadedRef !== reference) {
    setLoadedRef(reference);
    setStatus(d.status);
    setNote(d.note ?? "");
    setCreated(null);
    setJson(JSON.stringify(d.payload, null, 2));
    setJsonErrors([]);
    setEditing(false);
  }
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["admin"] });
  };

  const save = async () => {
    setBusy(true);
    try {
      await api(`/api/admin/submissions/${reference}`, { method: "PATCH", body: { status, note } });
      toast("Kaydedildi");
      refresh();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Kaydedilemedi", "error");
    } finally {
      setBusy(false);
    }
  };
  const savePayload = async (payload: unknown, done?: () => void) => {
    setJsonErrors([]);
    setBusy(true);
    try {
      await api(`/api/admin/submissions/${reference}`, { method: "PATCH", body: { payload } });
      toast("Başvuru verisi kaydedildi");
      done?.();
      refresh();
    } catch (e) {
      if (e instanceof ApiError && Array.isArray(e.body.issues)) setJsonErrors(e.body.issues as string[]);
      else setJsonErrors([e instanceof ApiError ? e.message : "Kaydedilemedi"]);
    } finally {
      setBusy(false);
    }
  };
  const saveJson = () => {
    try {
      void savePayload(JSON.parse(json));
    } catch {
      setJsonErrors(["JSON okunamadı: parantez veya tırnak hatası olabilir."]);
    }
  };
  const createTenant = async () => {
    setBusy(true);
    try {
      const r = await api<{ tenantId: string; linkedMember: boolean; checklist: string[] }>(`/api/admin/submissions/${reference}/create-tenant`, { method: "POST" });
      setCreated({ tenantId: r.tenantId, checklist: r.checklist });
      toast(r.linkedMember ? "Firma oluşturuldu, üye firmaya bağlandı" : "Firma oluşturuldu (başvuru üyesiz; kullanıcıyı elle bağlayın)");
      refresh();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Firma oluşturulamadı", "error");
    } finally {
      setBusy(false);
    }
  };

  const p = d?.payload ?? {};
  const extras = Object.entries((p.extras ?? {}) as Record<string, string | string[] | number>);
  return (
    <Drawer open={!!reference} onClose={onClose} wide title={d ? d.businessName : "Başvuru"}>
      {q.isLoading && <Loading />}
      {q.error && <ErrorBox error={q.error} />}
      {d && (
        <div className="admin-drawer">
          <p className="muted">
            {SECTOR_LABELS[d.sector] ?? d.sector} · {d.reference} · {when(d.createdAt)}
          </p>

          <div className="admin-actions card">
            <div className="grid-2">
              <Field label="Durum">{(id) => <Select id={id} value={status} onChange={(e) => setStatus(e.target.value as Status)}>{(Object.keys(STATUS_LABELS) as Status[]).map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}</Select>}</Field>
              <div className="admin-member">
                <p className="muted small">Üye ve paket</p>
                <p>{d.member ? d.member.email : "Üyesiz başvuru"}</p>
                <p>{d.plan ? `${PLAN_LABELS[d.plan]} · ${d.paid ? "ödendi" : "ödeme bekliyor"}` : "Paket seçilmemiş"}</p>
              </div>
            </div>
            <Field label="Not (yalnızca yöneticiler görür)">{(id) => <Textarea id={id} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
            <div className="row-actions">
              <Button variant="quiet" onClick={save} busy={busy}>Durumu kaydet</Button>
              {d.tenantId ? (
                <Button onClick={() => { setAdminTenant(d.tenantId!); location.assign("/panel/"); }}>Müşteri panelini aç</Button>
              ) : (
                <Button onClick={createTenant} busy={busy}>Onayla ve firmayı oluştur</Button>
              )}
            </div>
            {created && (
              <div className="admin-created" role="status">
                <p><strong>Firma oluşturuldu:</strong> {created.tenantId}. Üye artık kendi panosuna girebilir; ayarları kontrol edip yayınlayın.</p>
              </div>
            )}
          </div>

          {!d.tenantId && (
            <div className="row-actions">
              <Button variant="quiet" onClick={() => setEditing(!editing)}>{editing ? "Düzenlemeyi kapat" : "Başvuru verisini düzenle"}</Button>
            </div>
          )}

          {editing && !d.tenantId ? (
            <SubmissionEditor key={reference} payload={d.payload} sectors={SECTOR_LABELS} errors={jsonErrors} busy={busy} onSave={(data) => void savePayload(data, () => setEditing(false))} />
          ) : (
          <>
          {d.checklist.length > 0 && (
            <Detail title="Kurulumdan önce kontrol et">
              <ul className="admin-list">{d.checklist.map((t) => <li key={t}>{t}</li>)}</ul>
            </Detail>
          )}

          <Detail title="İşletme ve iletişim">
            <dl className="admin-dl">
              <dt>Ad</dt><dd>{p.business?.name}</dd>
              {p.business?.operatedBy && (<><dt>Yapı</dt><dd>{p.business.operatedBy}</dd></>)}
              {p.business?.address && (<><dt>Adres</dt><dd>{p.business.address}</dd></>)}
              {p.business?.website && (<><dt>Web</dt><dd>{p.business.website}</dd></>)}
              <dt>Yetkili</dt><dd>{p.contact?.person}, {p.contact?.phone}{p.contact?.email ? `, ${p.contact.email}` : ""}</dd>
            </dl>
          </Detail>

          <Detail title="Telefon ve çalışma saatleri">
            <dl className="admin-dl">
              {p.phone?.publicNumber && (<><dt>Aranan numara</dt><dd>{p.phone.publicNumber}</dd></>)}
              {p.phone?.when && (<><dt>Asistan</dt><dd>{{ "mesgul-cevapsiz": "Siz açamadığınızda", "mesai-disi": "Yalnızca mesai dışında", "her-zaman": "Her zaman" }[p.phone.when as string] ?? p.phone.when}</dd></>)}
              {p.phone?.transferNumber && (<><dt>Aktarma</dt><dd>{p.phone.transferNumber}</dd></>)}
              {p.phone?.languages && (<><dt>Diller</dt><dd>{p.phone.languages}</dd></>)}
              <dt>Saatler</dt>
              <dd>{(p.hours ?? []).map((h: any) => `${DAYS[h.day - 1]} ${h.open ? `${h.from}–${h.to}` : "kapalı"}`).join(" · ") || "—"}</dd>
              {p.closedDates && (<><dt>Kapalı günler</dt><dd>{p.closedDates}</dd></>)}
            </dl>
          </Detail>

          <Detail title={`Hizmetler (${(p.services ?? []).length})`}>
            <ul className="admin-list">
              {(p.services ?? []).map((s: any, i: number) => (
                <li key={i}>{[s.name, s.durationMin && `${s.durationMin} dk`, s.capacity && `${s.capacity} kişi`, s.price, s.note].filter(Boolean).join(" · ")}</li>
              ))}
            </ul>
          </Detail>

          <Detail title={`Ekip (${(p.staff ?? []).length})`}>
            <ul className="admin-list">
              {(p.staff ?? []).map((s: any, i: number) => (
                <li key={i}>{[s.name, s.title, s.phone, s.services && `(${s.services})`].filter(Boolean).join(" · ")}</li>
              ))}
            </ul>
          </Detail>

          {extras.length > 0 && (
            <Detail title="Sektöre özel cevaplar">
              <dl className="admin-dl">
                {extras.map(([k, v]) => (
                  <div key={k} className="admin-dl-row"><dt>{k}</dt><dd>{Array.isArray(v) ? v.join(", ") : String(v)}</dd></div>
                ))}
              </dl>
            </Detail>
          )}

          <Detail title="Kurallar ve asistan">
            <dl className="admin-dl">
              {p.policies?.cancellation && (<><dt>İptal</dt><dd>{String(p.policies.cancellation).replace(/\n/g, "; ")}</dd></>)}
              {p.policies?.payment && (<><dt>Ödeme</dt><dd>{p.policies.payment}</dd></>)}
              {p.policies?.health && (<><dt>Özel kurallar</dt><dd>{String(p.policies.health).replace(/\n/g, "; ")}</dd></>)}
              {p.policies?.faq && (<><dt>Sık sorulanlar</dt><dd className="admin-pre">{p.policies.faq}</dd></>)}
              <dt>Bildirim</dt><dd>{(p.notifications?.channels ?? []).join(", ") || "yok"}</dd>
              {p.agent?.name && (<><dt>Asistan adı</dt><dd>{p.agent.name}</dd></>)}
              {p.agent?.voice && (<><dt>Ses</dt><dd>{p.agent.voice}</dd></>)}
            </dl>
          </Detail>

          </>
          )}

          <details className="admin-raw">
            <summary>Gelişmiş: ham veri (JSON)</summary>
            <Textarea className="input admin-json" rows={16} value={json} onChange={(e) => setJson(e.target.value)} spellCheck={false} disabled={!!d.tenantId} aria-label="Başvuru verisi (JSON)" />
            {jsonErrors.length > 0 && (
              <ul className="admin-json-errors" role="alert">{jsonErrors.map((t) => <li key={t}>{t}</li>)}</ul>
            )}
            <div className="row-actions">
              {d.tenantId ? <p className="muted small">Firma oluşturuldu; ayarları müşteri panelinden düzenleyin.</p> : <Button variant="quiet" onClick={saveJson} busy={busy}>Veriyi kaydet</Button>}
            </div>
          </details>
        </div>
      )}
    </Drawer>
  );
}

/* ---------------- müşteriler ---------------- */
function TenantDrawer({ tenant, onClose }: { tenant: TenantItem | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [plan, setPlan] = useState<PlanId | "">("");
  const [minutes, setMinutes] = useState("");
  const [phones, setPhones] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState("");
  if (tenant && loaded !== tenant.id) {
    setLoaded(tenant.id);
    setPlan(tenant.plan ?? "");
    setMinutes(tenant.planMinutes ? String(tenant.planMinutes) : "");
    setPhones(tenant.phoneNumbers.join("\n"));
  }
  const patch = async (body: Record<string, unknown>, ok: string) => {
    if (!tenant) return;
    setBusy(true);
    try {
      await api(`/api/admin/tenants/${tenant.id}`, { method: "PATCH", body });
      toast(ok);
      void qc.invalidateQueries({ queryKey: ["admin"] });
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Kaydedilemedi", "error");
    } finally {
      setBusy(false);
    }
  };
  const savePlan = () => {
    if (!plan) return toast("Önce paket seçin", "error");
    void patch({ plan, ...(minutes && { includedMinutes: Number(minutes) }) }, "Paket güncellendi");
  };
  const savePhones = () => void patch({ phoneNumbers: phones.split(/[\n,]/).map((x) => x.trim()).filter(Boolean) }, "Telefon hattı kaydedildi");

  return (
    <Drawer open={!!tenant} onClose={onClose} title={tenant?.name ?? "Firma"}>
      {tenant && (
        <div className="admin-drawer">
          <p className="muted">{SECTOR_LABELS[tenant.vertical] ?? tenant.vertical} · {tenant.id}{tenant.owner ? ` · ${tenant.owner}` : ""}</p>

          {tenant.pendingPlan && <p className="muted">Dönem sonunda {PLAN_LABELS[tenant.pendingPlan]} paketine geçecek (müşteri düşürme seçti).</p>}

          <div className="row-actions">
            <Button onClick={() => { setAdminTenant(tenant.id); location.assign("/panel/"); }}>Müşteri panelini aç</Button>
          </div>

          <Detail title="Paket">
            <div className="grid-2">
              <Field label="Paket">{(id) => <Select id={id} value={plan} onChange={(e) => { setPlan(e.target.value as PlanId | ""); setMinutes(""); }}><option value="">Seçin</option>{(Object.keys(PLAN_LABELS) as PlanId[]).map((p) => <option key={p} value={p}>{PLAN_LABELS[p]}</option>)}</Select>}</Field>
              <Field label="Dahil dakika" optional hint="Boş bırakırsanız paketin kendi dakikası yazılır.">{(id) => <Input id={id} type="number" min={0} value={minutes} onChange={(e) => setMinutes(e.target.value)} />}</Field>
            </div>
            <div className="row-actions"><Button variant="quiet" onClick={savePlan} busy={busy}>Paketi kaydet</Button></div>
          </Detail>

          <Detail title="Telefon hattı">
            <Field label="Asistanın karşıladığı numaralar" hint="Her satıra bir numara. 0850 ... ya da +90 ... yazabilirsiniz.">{(id) => <Textarea id={id} rows={3} value={phones} onChange={(e) => setPhones(e.target.value)} />}</Field>
            <div className="row-actions"><Button variant="quiet" onClick={savePhones} busy={busy}>Numaraları kaydet</Button></div>
          </Detail>

          <Detail title="Hizmet durumu">
            <p className="muted">{tenant.suspended ? "Hizmet askıda: asistan gelen aramaları karşılamıyor. Müşteri panelde uyarı görüyor." : "Hizmet açık."}</p>
            <div className="row-actions">
              <Button variant={tenant.suspended ? "primary" : "quiet"} onClick={() => void patch({ suspended: !tenant.suspended }, tenant.suspended ? "Hizmet yeniden açıldı" : "Hizmet askıya alındı")} busy={busy}>
                {tenant.suspended ? "Hizmeti yeniden aç" : "Hizmeti askıya al"}
              </Button>
            </div>
          </Detail>
        </div>
      )}
    </Drawer>
  );
}

/** Firmanın asistanı: ses, ad ve karşılama. Burada yapılan değişiklik taslak beklemeden canlıya uygulanır. */
function AssistantDrawer({ tenant, onClose }: { tenant: TenantItem | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const q = useQuery({
    queryKey: ["admin", "agent", tenant?.id],
    queryFn: () => api<{ voiceId: string | null; name: string; greeting: string; defaultGreeting: string; firma: string; ready: boolean }>(`/api/admin/tenants/${tenant!.id}/agent`),
    enabled: !!tenant,
  });
  const apply = async (a: AgentIdentity) => {
    if (!tenant) return;
    setBusy(true);
    try {
      await api(`/api/admin/tenants/${tenant.id}`, { method: "PATCH", body: { agent: { voiceId: a.voiceId, name: a.name, greeting: a.greeting || null } } });
      toast(q.data?.ready ? "Asistan güncellendi ve canlıya alındı" : "Asistan ayarı kaydedildi (asistan kurulunca geçerli olur)");
      await qc.invalidateQueries({ queryKey: ["admin", "agent"] });
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Güncellenemedi", "error");
    } finally {
      setBusy(false);
    }
  };
  const d = q.data;
  return (
    <Drawer open={!!tenant} onClose={onClose} wide title={tenant ? `${tenant.name} · Asistan` : "Asistan"}>
      {q.isLoading && <Loading />}
      {q.error && <ErrorBox error={q.error} />}
      {d && (
        <div className="admin-drawer" aria-busy={busy}>
          <p className="muted small">Burada yaptığınız değişiklik, müşterinin taslağını beklemeden canlıya uygulanır{d.ready ? " ve ElevenLabs'teki asistan güncellenir" : ""}. Seçtiğiniz sesi dinleyip kartın ⋮ düğmesinden adı ve karşılamayı da değiştirebilirsiniz.</p>
          <VoicePicker
            endpoint="/api/admin/voices"
            value={d.voiceId ?? undefined}
            agent={{ name: d.name, greeting: d.greeting }}
            defaultGreeting={d.defaultGreeting}
            firma={d.firma}
            onApply={apply}
          />
        </div>
      )}
    </Drawer>
  );
}

export function AdminCustomersPage() {
  const { navigate } = useRouter();
  const q = useQuery({ queryKey: ["admin", "tenants"], queryFn: () => api<{ tenants: TenantItem[] }>("/api/admin/tenants"), refetchInterval: 60_000 });
  const rows = q.data?.tenants ?? [];
  const [openId, setOpenId] = useState("");
  const [assistantId, setAssistantId] = useState("");
  const qc = useQueryClient();
  const toast = useToast();
  const setup = async (t: TenantItem) => {
    try {
      const r = await api<{ created: boolean }>(`/api/admin/tenants/${t.id}/assistant`, { method: "POST" });
      toast(r.created ? `${t.name} için asistan kuruldu` : `${t.name} asistanı güncellendi`);
      await qc.invalidateQueries({ queryKey: ["admin"] });
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Asistan kurulamadı", "error");
    }
  };
  const open = rows.find((t) => t.id === openId) ?? null;
  const assistantTenant = rows.find((t) => t.id === assistantId) ?? null;
  return (
    <section className="page">
      <header className="page-head">
        <div>
          <h1 className="page-title">Müşteriler</h1>
          <p className="page-sub">Kurulmuş firmalar, bu ayın dakika kullanımı ve paket talepleri. Satıra tıklayınca paket, telefon hattı ve hizmet durumunu yönetirsiniz.</p>
        </div>
      </header>
      {q.isLoading && <Loading />}
      {q.error && <ErrorBox error={q.error} onRetry={() => q.refetch()} />}
      {q.data && !rows.length && <Empty title="Henüz firma yok">Bir başvuruyu onaylayınca firma burada görünür.</Empty>}
      {rows.length > 0 && (
        <div className="card admin-table-card">
          <table className="data-table admin-table">
            <thead>
              <tr><th>Firma</th><th>Sektör</th><th>Paket</th><th>Asistan</th><th>Bu ay kullanım</th><th>Çağrı (30 gün)</th><th>Randevu</th><th className="sr-only">İşlemler</th></tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} tabIndex={0} onClick={() => setOpenId(t.id)} onKeyDown={(e) => e.key === "Enter" && setOpenId(t.id)}>
                  <td className="cell-main">
                    <strong>{t.name}</strong>
                    <span className="muted small admin-ref">{t.owner ?? t.id}</span>
                    {t.suspended && <span className="pill admin-status admin-status-rejected">Askıda</span>}
                  </td>
                  <td data-label="Sektör">{SECTOR_LABELS[t.vertical] ?? t.vertical}</td>
                  <td data-label="Paket">
                    {t.plan ? PLAN_LABELS[t.plan] : <span className="muted">—</span>}
                    {t.pendingPlan && <span className="pill admin-status admin-status-reviewing">Sonra {PLAN_LABELS[t.pendingPlan]}</span>}
                  </td>
                  <td data-label="Asistan">{t.assistantReady ? (t.hasPhone ? "Hazır" : "Hat bekliyor") : <span className="muted">Kurulacak</span>}</td>
                  <td data-label="Bu ay kullanım">{t.includedMinutes ? <span className={t.minutesUsed > t.includedMinutes ? "admin-over" : undefined}>{t.minutesUsed} / {t.includedMinutes} dk</span> : <span className="muted">{t.minutesUsed} dk</span>}</td>
                  <td data-label="Çağrı (30 gün)">{t.calls30}</td>
                  <td data-label="Randevu">{t.appointments30}</td>
                  <td className="cell-actions" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                    <ActionMenu
                      label={`${t.name} için işlemler`}
                      actions={[
                        { label: "Yönet", icon: "settings", onClick: () => setOpenId(t.id) },
                        ...(t.assistantReady ? [{ label: "Asistanı düzenle", icon: "users", onClick: () => setAssistantId(t.id) }] : [{ label: "Asistanı kur", icon: "mic", onClick: () => void setup(t) }]),
                        { label: "Müşteri panelini aç", icon: "chart", onClick: () => { setAdminTenant(t.id); location.assign("/panel/"); } },
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <TenantDrawer tenant={open} onClose={() => setOpenId("")} />
      <AssistantDrawer tenant={assistantTenant} onClose={() => setAssistantId("")} />
    </section>
  );
}
