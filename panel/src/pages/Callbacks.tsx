import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Callback } from "../api.ts";
import { can, useMe } from "../App.tsx";
import { Link, useQueryParam } from "../router.tsx";
import { Button, Empty, ErrorBox, Icon, Input, Loading, Segmented, useToast } from "../components/ui.tsx";

export function CallbacksPage() {
  const me = useMe();
  const [status, setStatus] = useQueryParam("durum", "open") as ["open" | "closed", (v: "open" | "closed") => void];
  const q = useQuery({
    queryKey: ["callbacks", status],
    queryFn: () => api<{ items: Callback[] }>(`/callbacks?status=${status}`),
    refetchInterval: 30_000,
  });

  return (
    <section className="page narrow">
      <header className="page-head">
        <div>
          <h1 className="page-title">Geri aramalar</h1>
          <p className="page-sub">Asistanın cevaplayamadığı sorular, iptal talepleri ve kaçan çağrılar</p>
        </div>
      </header>
      <div className="toolbar">
        <Segmented label="Durum" value={status} onChange={setStatus} options={[{ value: "open", label: "Bekleyenler" }, { value: "closed", label: "Arananlar" }]} />
      </div>

      {q.isLoading && <Loading />}
      {q.error && <ErrorBox error={q.error} onRetry={() => q.refetch()} />}
      {q.data && !q.data.items.length && (
        <Empty title={status === "open" ? "Geri aranacak kimse yok" : "Henüz kapatılan geri arama yok"}>
          {status === "open" ? "Asistan bir müşteri için not bıraktığında burada görünür." : undefined}
        </Empty>
      )}
      <ul className="callback-list">
        {q.data?.items.map((c) => <CallbackCard key={c.id} c={c} editable={can(me, "callbacks.edit")} />)}
      </ul>
    </section>
  );
}

function CallbackCard({ c, editable }: { c: Callback; editable: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [closing, setClosing] = useState(false);
  const [note, setNote] = useState("");
  const done = () => {
    qc.invalidateQueries({ queryKey: ["callbacks"] });
    qc.invalidateQueries({ queryKey: ["today"] });
  };
  const close = useMutation({
    mutationFn: () => api(`/callbacks/${c.id}/close`, { method: "POST", body: { note: note || undefined } }),
    onSuccess: () => { done(); toast("Arandı olarak işaretlendi"); },
    onError: (e) => toast(e.message, "error"),
  });
  const reopen = useMutation({
    mutationFn: () => api(`/callbacks/${c.id}/reopen`, { method: "POST" }),
    onSuccess: () => { done(); toast("Bekleyenlere geri alındı"); },
  });

  return (
    <li className={`callback${c.status === "open" ? " is-open" : ""}`}>
      <div className="callback-main">
        <p className="callback-who">{c.name ?? c.phoneText ?? "İsim ve numara yok"}</p>
        <p className="callback-reason">{c.reason}</p>
        <p className="callback-meta">
          {c.dayText} {c.timeText}
          {c.conversationId && <Link to={`/cagrilar?gorusme=${c.conversationId}`} className="callback-link">Görüşmeyi aç</Link>}
        </p>
        {c.status === "closed" && (
          <p className="callback-closed"><Icon name="check" size={16} />{c.closedBy ?? "Bilinmiyor"} aradı{c.closeNote ? `: ${c.closeNote}` : ""}</p>
        )}
      </div>
      <div className="callback-actions">
        {c.phone && (
          <a className="btn btn-primary btn-sm" href={`tel:${c.phone}`}><Icon name="phone" size={18} />{c.phoneText}</a>
        )}
        {editable && c.status === "open" && !closing && <Button variant="quiet" size="sm" onClick={() => setClosing(true)}>Arandı</Button>}
        {editable && c.status === "closed" && <Button variant="ghost" size="sm" busy={reopen.isPending} onClick={() => reopen.mutate()}>Geri al</Button>}
      </div>
      {closing && (
        <form className="callback-close" onSubmit={(e) => { e.preventDefault(); close.mutate(); }}>
          <Input autoFocus placeholder="Kısa not (isteğe bağlı): örn. perşembeye alındı" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Not" />
          <Button type="submit" size="sm" busy={close.isPending}>Kaydet</Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setClosing(false)}>Vazgeç</Button>
        </form>
      )}
    </li>
  );
}
