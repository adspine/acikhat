import { DatePicker } from "./DatePicker.tsx";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type Appointment } from "../api.ts";
import { can, useMe } from "../App.tsx";
import { Button, Checkbox, Drawer, ErrorBox, Field, Input, Loading, Select, Textarea, tl, useToast } from "./ui.tsx";
import { Link } from "../router.tsx";

const HISTORY_LABELS: Record<string, string> = {
  "appointment.create": "Panelden oluşturdu",
  "appointment.cancel": "İptal etti",
  "appointment.note": "Notu güncelledi",
};

const sameDay = (ms: number) => new Date(ms).toLocaleString("tr-TR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

/** Randevu detayı: bilgiler, not, iptal, değişiklik geçmişi */
export function AppointmentDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["appointment", id], queryFn: () => api<Appointment>(`/appointments/${id}`), enabled: !!id });
  const [note, setNote] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [notifyCancel, setNotifyCancel] = useState(true);
  useEffect(() => {
    setNote(q.data?.note ?? "");
    setConfirmCancel(false);
  }, [q.data?.id, q.data?.note]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["appointments"] });
    qc.invalidateQueries({ queryKey: ["today"] });
    qc.invalidateQueries({ queryKey: ["appointment", id] });
  };
  const cancel = useMutation({
    mutationFn: () => api<Appointment>(`/appointments/${id}/cancel`, { method: "POST", body: { notify: notifyCancel } }),
    onSuccess: () => {
      refresh();
      toast("Randevu iptal edildi");
    },
    onError: (e) => toast(e.message, "error"),
  });
  const saveNote = useMutation({
    mutationFn: () => api<Appointment>(`/appointments/${id}`, { method: "PATCH", body: { note } }),
    onSuccess: () => {
      refresh();
      toast("Not kaydedildi");
    },
    onError: (e) => toast(e.message, "error"),
  });

  const a = q.data;
  const editable = can(me, "appointments.edit") && a?.status === "confirmed";
  return (
    <Drawer open={!!id} onClose={onClose} title={a ? a.customerName : "Randevu"}>
      {q.isLoading && <Loading />}
      {q.error && <ErrorBox error={q.error} />}
      {a && (
        <div className="stack">
          {a.status === "cancelled" && <div className="banner banner-error">Bu randevu iptal edildi{a.cancelledBy ? ` (${a.cancelledBy})` : ""}.</div>}
          <dl className="facts">
            <div><dt>Tarih</dt><dd>{a.dateText}, {a.startText}–{a.endText}</dd></div>
            <div><dt>Hizmet</dt><dd>{a.serviceName}{a.price ? `, ${tl(a.price)}` : ""}</dd></div>
            <div><dt>{me.terms.staffLabel}</dt><dd>{a.staff.map((s) => s.name).join(" ve ")}</dd></div>
            {a.room && <div><dt>{me.terms.roomLabel}</dt><dd>{a.room.label}</dd></div>}
            <div>
              <dt>Telefon</dt>
              <dd>{a.phoneText ? <a href={`tel:${a.customerPhone}`}>{a.phoneText}</a> : "—"}</dd>
            </div>
            <div>
              <dt>Kaynak</dt>
              <dd>
                {a.source === "assistant" ? "Telefon asistanı aldı" : "Panelden girildi"}
                {a.conversationId && <Link to={`/cagrilar?gorusme=${a.conversationId}`} className="dd-link">Görüşmeyi aç</Link>}
              </dd>
            </div>
            {me.tenant.calendar === "google" && <div><dt>Google Takvim</dt><dd>{a.syncedToCalendar ? "Takvime yazıldı" : "Yazılmayı bekliyor"}</dd></div>}
          </dl>

          {can(me, "appointments.edit") && (
            <Field label="Not" optional>
              {(fid) => (
                <>
                  <Textarea id={fid} rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Örn. müşteri 10 dk geç kalacak" />
                  {note !== (a.note ?? "") && (
                    <Button variant="quiet" size="sm" busy={saveNote.isPending} onClick={() => saveNote.mutate()}>Notu kaydet</Button>
                  )}
                </>
              )}
            </Field>
          )}

          {editable && !confirmCancel && <Button variant="danger" onClick={() => setConfirmCancel(true)}>Randevuyu iptal et</Button>}
          {editable && confirmCancel && (
            <div className="confirm">
              <p><strong>{a.customerName}</strong> adına {a.dateText} {a.startText} randevusu iptal edilecek.</p>
              <Checkbox label="Müşteriye iptal mesajı gönder" checked={notifyCancel} onChange={setNotifyCancel} />
              <div className="row-actions">
                <Button variant="ghost" onClick={() => setConfirmCancel(false)}>Vazgeç</Button>
                <Button variant="danger" busy={cancel.isPending} onClick={() => cancel.mutate()}>İptal et</Button>
              </div>
            </div>
          )}

          {!!a.history?.length && (
            <section>
              <h3 className="section-label">Geçmiş</h3>
              <ul className="history">
                {a.history.map((h, i) => (
                  <li key={i}><span>{h.user ?? "Sistem"}: {HISTORY_LABELS[h.action] ?? h.action}</span><time>{sameDay(h.at)}</time></li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </Drawer>
  );
}

interface Availability {
  date: string;
  dateText: string;
  service: { id: string; name: string; durationMin: number; staffCount: number };
  times: { time: string; staff: { id: string; name: string }[] }[];
}

/** Elle randevu: hizmet → gün → boş saat → müşteri. Asistanla aynı çakışma koruması sunucuda. */
export function NewAppointmentDrawer({ open, onClose, initialDate }: { open: boolean; onClose: () => void; initialDate: string }) {
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const [serviceId, setServiceId] = useState(me.services[0]?.id ?? "");
  const [date, setDate] = useState(initialDate);
  const [staffId, setStaffId] = useState("");
  const [time, setTime] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [notify, setNotify] = useState(true);
  const [error, setError] = useState<string>();
  const [alternatives, setAlternatives] = useState<{ date: string; time: string; text: string }[]>([]);

  useEffect(() => {
    if (open) {
      setDate(initialDate);
      setTime("");
      setError(undefined);
      setAlternatives([]);
    }
  }, [open, initialDate]);

  const service = me.services.find((s) => s.id === serviceId);
  const qualified = me.staff.filter((s) => s.services.includes(serviceId));
  const avail = useQuery({
    queryKey: ["availability", serviceId, date, staffId],
    queryFn: () => api<Availability>(`/availability?serviceId=${serviceId}&date=${date}${staffId ? `&staffId=${staffId}` : ""}`),
    enabled: open && !!serviceId && !!date,
  });

  const create = useMutation({
    mutationFn: () =>
      api<Appointment>("/appointments", {
        method: "POST",
        body: { serviceId, date, time, staffId: staffId || undefined, customerName: name, customerPhone: phone, note: note || undefined, notify },
      }),
    onSuccess: (a) => {
      qc.invalidateQueries({ queryKey: ["appointments"] });
      qc.invalidateQueries({ queryKey: ["today"] });
      toast(`Randevu oluşturuldu: ${a.dateText} ${a.startText}`);
      setName("");
      setPhone("");
      setNote("");
      onClose();
    },
    onError: (e) => {
      setError(e.message);
      if (e instanceof ApiError && Array.isArray(e.body.alternatives)) setAlternatives(e.body.alternatives as typeof alternatives);
      qc.invalidateQueries({ queryKey: ["availability"] });
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(undefined);
    setAlternatives([]);
    if (!time) return setError("Bir saat seçin");
    create.mutate();
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Yeni randevu"
      footer={
        <div className="row-actions">
          <Button variant="ghost" onClick={onClose}>Vazgeç</Button>
          <Button type="submit" form="new-appt" busy={create.isPending}>Randevuyu oluştur</Button>
        </div>
      }
    >
      <form id="new-appt" className="stack" onSubmit={submit}>
        <Field label="Hizmet">
          {(id) => (
            <Select id={id} value={serviceId} onChange={(e) => { setServiceId(e.target.value); setTime(""); setStaffId(""); }}>
              {me.services.map((s) => <option key={s.id} value={s.id}>{s.name}{s.staffCount > 1 ? ` (${s.staffCount} kişi)` : ""}</option>)}
            </Select>
          )}
        </Field>
        <div className="grid-2">
          <Field label="Gün">{(id) => <DatePicker id={id} value={date} onChange={(e) => { setDate(e.target.value); setTime(""); }} required />}</Field>
          <Field label={me.terms.staffTerm.charAt(0).toLocaleUpperCase("tr") + me.terms.staffTerm.slice(1)} optional>
            {(id) => (
              <Select id={id} value={staffId} onChange={(e) => { setStaffId(e.target.value); setTime(""); }}>
                <option value="">Fark etmez</option>
                {qualified.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            )}
          </Field>
        </div>

        <fieldset className="field">
          <legend className="field-label">Saat</legend>
          {avail.isLoading && <Loading />}
          {avail.data && !avail.data.times.length && <p className="muted">Bu gün {service?.name} için boş saat yok.</p>}
          {avail.data && (
            <div className="time-grid" role="radiogroup" aria-label="Boş saatler">
              {avail.data.times.map((t) => (
                <button
                  key={t.time}
                  type="button"
                  role="radio"
                  aria-checked={time === t.time}
                  className="time-chip"
                  onClick={() => setTime(t.time)}
                  title={t.staff.map((s) => s.name).join(", ")}
                >
                  <span>{t.time}</span>
                  {!staffId && <small>{t.staff.length === 1 ? t.staff[0]!.name : `${t.staff.length} kişi`}</small>}
                </button>
              ))}
            </div>
          )}
        </fieldset>

        <Field label="Müşterinin adı soyadı">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" required minLength={2} />}</Field>
        <Field label="Telefon" hint="Cep numarasıysa onay mesajı gönderilebilir">
          {(id, d) => <Input id={id} aria-describedby={d} type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="05xx xxx xx xx" required />}
        </Field>
        <Field label="Not" optional>{(id) => <Textarea id={id} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
        <Checkbox label="Müşteriye onay mesajı gönder" checked={notify} onChange={setNotify} />

        {error && (
          <div className="banner banner-error" role="alert">
            <p>{error}</p>
            {!!alternatives.length && (
              <div className="alt-list">
                <p>En yakın boş saatler:</p>
                {alternatives.map((alt) => (
                  <button key={alt.date + alt.time} type="button" className="time-chip" onClick={() => { setDate(alt.date); setTime(alt.time); setError(undefined); setAlternatives([]); }}>
                    {alt.text}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </form>
    </Drawer>
  );
}
