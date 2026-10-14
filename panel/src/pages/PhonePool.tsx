import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../api.ts";
import { Button, Empty, ErrorBox, Field, Input, Loading, Textarea, useToast } from "../components/ui.tsx";
import { ActionMenu } from "../components/ActionMenu.tsx";

type PoolStatus = "available" | "assigned" | "quarantine" | "retired";
interface PoolNumber {
  number: string; kind: "real" | "test"; status: PoolStatus; tenantId: string | null; tenantName: string | null; note: string | null;
  addedAt: number; assignedAt: number | null; releasedAt: number | null; quarantineUntil: number | null; renewAt: number | null;
}
interface PoolResponse {
  stats: Record<PoolStatus, number> & { total: number; test: number };
  lowStockAt: number; quarantineDays: number; initialSize: number;
  numbers: PoolNumber[]; waiting: { id: string; name: string }[];
}
interface AddResponse {
  added: string[]; skipped: { input: string; reason: string }[];
  assigned: { tenantId: string; tenantName: string; number: string; connected: boolean }[];
}

const STATUS_LABEL: Record<PoolStatus, string> = { available: "Müsait", assigned: "Atanmış", quarantine: "Karantina", retired: "Emekli" };
/** Mevcut durum rozet sınıflarına eşleme: müsait yeşil, atanmış mavi, karantina sarı, emekli gri */
const STATUS_CLASS: Record<PoolStatus, string> = { available: "approved", assigned: "live", quarantine: "reviewing", retired: "rejected" };
const showPhone = (e164: string) => (e164.startsWith("+90") ? `0${e164.slice(3, 6)} ${e164.slice(6, 9)} ${e164.slice(9, 11)} ${e164.slice(11)}` : e164);
const day = (ms: number | null) => (ms ? new Date(ms).toLocaleDateString("tr-TR", { day: "numeric", month: "short", year: "numeric" }) : "");

/** Yönetici: Netgsm'den alınan numaraların envanteri, atama ve bırakma. Ayrıntı ve hukuki çerçeve: docs/hat-havuzu.md */
export function PhonePoolPage() {
  const q = useQuery({ queryKey: ["admin", "phone-pool"], queryFn: () => api<PoolResponse>("/api/admin/phone-pool"), refetchInterval: 60_000 });
  const qc = useQueryClient();
  const toast = useToast();
  const [numbers, setNumbers] = useState("");
  const [note, setNote] = useState("");
  const [renewAt, setRenewAt] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin"] });
  const d = q.data;

  const add = async () => {
    setBusy(true);
    try {
      const r = await api<AddResponse>("/api/admin/phone-pool", { method: "POST", body: { numbers, ...(note.trim() && { note: note.trim() }), ...(renewAt && { renewAt }) } });
      const parts = [`${r.added.length} numara eklendi`];
      if (r.skipped.length) parts.push(`${r.skipped.length} atlandı (${[...new Set(r.skipped.map((s) => s.reason))].join(", ")})`);
      if (r.assigned.length) parts.push(`hat bekleyen ${r.assigned.map((a) => a.tenantName).join(", ")} firmasına atandı`);
      toast(parts.join("; "), r.added.length ? "ok" : "error");
      if (r.added.length) setNumbers("");
      await refresh();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Numaralar eklenemedi", "error");
    } finally {
      setBusy(false);
    }
  };

  const act = async (path: string, ok: string) => {
    try {
      const r = await api<{ warning?: string }>(path, { method: "POST" });
      toast(r.warning ?? ok, r.warning ? "error" : "ok");
      await refresh();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "İşlem tamamlanamadı", "error");
    }
  };
  const enc = (n: string) => encodeURIComponent(n);
  const low = d && d.stats.available <= d.lowStockAt;

  return (
    <section className="page">
      <header className="page-head">
        <div>
          <h1 className="page-title">Hat havuzu</h1>
          <p className="page-sub">Netgsm'den aldığınız 0850 numaraları. Ödemesi doğrulanmış firmaya numara kendiliğinden atanır; müşteri bu numarayı yayınlamaz, yalnızca yönlendirme hedefi olarak kullanılır.</p>
        </div>
      </header>

      {q.isLoading && <Loading />}
      {q.error && <ErrorBox error={q.error} onRetry={() => q.refetch()} />}

      {d && (
        <>
          {(low || d.waiting.length > 0) && (
            <p className="suspended-banner" role="alert">
              {d.waiting.length > 0 && <>Hat bekleyen firma: <strong>{d.waiting.map((w) => w.name).join(", ")}</strong>. </>}
              {low && <>Müsait numara {d.stats.available === 0 ? "kalmadı" : `${d.stats.available} adet kaldı`}; Netgsm'den numara alıp aşağıdan ekleyin (en az {d.lowStockAt + 1} yedek tutun). Eklenince bekleyen firmalara kendiliğinden atanır.</>}
            </p>
          )}

          <div className="stat-row stat-row-4">
            <div className={`stat${low ? " is-attention" : ""}`}><p className="stat-label">Müsait</p><p className="stat-value">{d.stats.available}</p><p className="stat-sub">atanabilir</p></div>
            <div className="stat"><p className="stat-label">Atanmış</p><p className="stat-value">{d.stats.assigned}</p><p className="stat-sub">firmalarda</p></div>
            <div className="stat"><p className="stat-label">Karantina</p><p className="stat-value">{d.stats.quarantine}</p><p className="stat-sub">{d.quarantineDays} gün kimseye verilmez</p></div>
            <div className="stat"><p className="stat-label">Toplam</p><p className="stat-value">{d.stats.total}</p><p className="stat-sub">emekliler dahil{d.stats.test ? `, ${d.stats.test} deneme hariç` : ""}</p></div>
          </div>

          <section className="card">
            <h2 className="card-title">Numara ekle</h2>
            <p className="muted small">Netgsm'den numara aldıktan sonra buraya yapıştırın. İlk seferde {d.initialSize} numara önerilir (yıllık yaklaşık 249 TL/numara). Yenileme tarihini girerseniz 30 gün önce hatırlatırız: yenilenmeyen numara düşer ve o numaraya yönlendiren müşterilerin çağrıları kaybolur.</p>
            <Field label="Numaralar" hint="Her satıra bir numara. 0850 ... ya da +90 ... yazabilirsiniz.">{(id) => <Textarea id={id} rows={4} value={numbers} onChange={(e) => setNumbers(e.target.value)} placeholder={"0850 300 00 01\n0850 300 00 02"} />}</Field>
            <div className="field-row">
              <Field label="Not" optional>{(id) => <Input id={id} value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="Netgsm sipariş no" />}</Field>
              <Field label="Yıllık yenileme tarihi" optional>{(id) => <Input id={id} type="date" value={renewAt} onChange={(e) => setRenewAt(e.target.value)} />}</Field>
            </div>
            <div className="form-actions"><Button onClick={() => void add()} busy={busy} disabled={!numbers.trim()}>Havuza ekle</Button></div>
          </section>

          {!d.numbers.length ? (
            <Empty title="Havuz boş">Netgsm'den aldığınız ilk numaraları yukarıdan ekleyin.</Empty>
          ) : (
            <div className="card admin-table-card">
              <table className="data-table admin-table">
                <thead><tr><th>Numara</th><th>Durum</th><th>Firma</th><th>Yenileme</th><th>Not</th><th className="sr-only">İşlemler</th></tr></thead>
                <tbody>
                  {d.numbers.map((n) => (
                    <tr key={n.number}>
                      <td className="cell-main"><strong>{showPhone(n.number)}</strong></td>
                      <td data-label="Durum">
                        <span className={`pill admin-status admin-status-${STATUS_CLASS[n.status]}`}>{STATUS_LABEL[n.status]}</span>
                        {n.kind === "test" && <span className="pill admin-status admin-status-new" title="Gerçek bir hat değildir; aramaları karşılamaz">Deneme</span>}
                        {n.status === "quarantine" && n.quarantineUntil && <span className="muted small"> {day(n.quarantineUntil)} tarihine kadar</span>}
                      </td>
                      <td data-label="Firma">{n.tenantName ?? (n.tenantId ? n.tenantId : <span className="muted">—</span>)}</td>
                      <td data-label="Yenileme">{n.renewAt ? day(n.renewAt) : <span className="muted">—</span>}</td>
                      <td data-label="Not">{n.note ?? <span className="muted">—</span>}</td>
                      <td className="cell-actions">
                        {(n.status === "assigned" || n.status === "available" || n.status === "quarantine") && (
                          <ActionMenu
                            label={`${showPhone(n.number)} için işlemler`}
                            actions={[
                              ...(n.status === "assigned" && n.kind === "test"
                                ? [{ label: "Deneme numarasını sil", icon: "close", danger: true, onClick: () => { if (confirm(`${showPhone(n.number)} bir deneme numarasıdır. Silinecek ve firma hat bekleyenler listesine düşecek. Devam edilsin mi?`)) void act(`/api/admin/phone-pool/${enc(n.number)}/release`, "Deneme numarası silindi"); } }]
                                : []),
                              ...(n.status === "assigned" && n.kind !== "test"
                                ? [{ label: "Bırak (karantinaya al)", icon: "close", danger: true, onClick: () => { if (confirm(`${showPhone(n.number)} firmadan alınıp ${d.quarantineDays} gün karantinaya alınacak ve ElevenLabs'ten kaldırılacak. Firma hat bekleyenler listesine düşer. Devam edilsin mi?`)) void act(`/api/admin/phone-pool/${enc(n.number)}/release`, "Numara karantinaya alındı"); } }]
                                : []),
                              ...(n.status !== "assigned" && n.kind !== "test"
                                ? [{ label: "Emekli et (Netgsm'de bırakıldı)", icon: "close", danger: true, onClick: () => { if (confirm(`${showPhone(n.number)} havuzdan kalıcı çıkarılacak. Netgsm aboneliğini de bıraktıysanız devam edin.`)) void act(`/api/admin/phone-pool/${enc(n.number)}/retire`, "Numara emekli edildi"); } }]
                                : []),
                            ]}
                          />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
