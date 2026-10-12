import { useState } from "react";
import { Button, Field, Input, Select, Textarea } from "../components/ui.tsx";

type Data = Record<string, any>;

const DAYS = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"];
const WHEN: Record<string, string> = { "": "Seçilmemiş", "her-zaman": "Her zaman", "mesgul-cevapsiz": "Siz açamadığınızda", "mesai-disi": "Yalnızca mesai dışında" };

/** Boş metinleri ve boş sayıları alandan çıkarır; form şeması boş metin yerine eksik alan bekler */
function clean(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === "object") {
    const out: Data = {};
    for (const [k, v] of Object.entries(value)) {
      const c = clean(v);
      if (c === "" || c === undefined || (typeof c === "number" && Number.isNaN(c))) continue;
      out[k] = c;
    }
    return out;
  }
  return value;
}

const num = (v: string): number | "" => (v === "" ? "" : Number(v));

/**
 * Başvuru verisinin form olarak düzenlenmesi. Formda olmayan alanlar (sektör cevapları, onay vb.) olduğu gibi korunur.
 */
export function SubmissionEditor({ payload, sectors, errors, busy, onSave }: {
  payload: Data;
  sectors: Record<string, string>;
  errors: string[];
  busy: boolean;
  onSave: (data: Data) => void;
}) {
  const [d, setD] = useState<Data>(() => structuredClone(payload));

  const set = (path: (string | number)[], value: unknown) =>
    setD((prev) => {
      const next = structuredClone(prev);
      let node: any = next;
      path.slice(0, -1).forEach((k, i) => {
        node[k] ??= typeof path[i + 1] === "number" ? [] : {};
        node = node[k];
      });
      node[path[path.length - 1]!] = value;
      return next;
    });
  const text = (path: (string | number)[]) => path.reduce<any>((n, k) => n?.[k], d) ?? "";
  const txt = (label: string, path: (string | number)[], opts: { type?: string; optional?: boolean; hint?: string } = {}) => (
    <Field label={label} optional={opts.optional ?? false} {...(opts.hint ? { hint: opts.hint } : {})}>
      {(id) => <Input id={id} type={opts.type ?? "text"} value={text(path)} onChange={(e) => set(path, e.target.value)} />}
    </Field>
  );
  const area = (label: string, path: (string | number)[], rows = 3) => (
    <Field label={label} optional>{(id) => <Textarea id={id} rows={rows} value={text(path)} onChange={(e) => set(path, e.target.value)} />}</Field>
  );

  const hours: { day: number; open: boolean; from?: string; to?: string }[] = DAYS.map(
    (_, i) => (d.hours ?? []).find((h: any) => h.day === i + 1) ?? { day: i + 1, open: false },
  );
  const setHour = (day: number, patch: Data) => {
    const next = hours.map((h) => (h.day === day ? { ...h, ...patch } : h));
    set(["hours"], next);
  };
  const services: Data[] = d.services ?? [];
  const staff: Data[] = d.staff ?? [];

  return (
    <div className="editor">
      <fieldset className="editor-group">
        <legend>İşletme</legend>
        <div className="grid-2">
          {txt("İşletme adı", ["business", "name"])}
          <Field label="Sektör">
            {(id) => (
              <Select id={id} value={text(["business", "sector"]) || "diger"} onChange={(e) => set(["business", "sector"], e.target.value)}>
                {Object.entries(sectors).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            )}
          </Field>
          {txt("Adres", ["business", "address"], { optional: true })}
          {txt("Web sitesi", ["business", "website"], { optional: true })}
          {txt("İşletme yapısı", ["business", "operatedBy"], { optional: true })}
        </div>
      </fieldset>

      <fieldset className="editor-group">
        <legend>Yetkili kişi</legend>
        <div className="grid-2">
          {txt("Ad soyad", ["contact", "person"])}
          {txt("Telefon", ["contact", "phone"], { type: "tel" })}
          {txt("E-posta", ["contact", "email"], { type: "email", optional: true })}
        </div>
      </fieldset>

      <fieldset className="editor-group">
        <legend>Telefon</legend>
        <div className="grid-2">
          {txt("Aranan numara", ["phone", "publicNumber"], { optional: true })}
          <Field label="Asistan ne zaman devrede" optional>
            {(id) => (
              <Select id={id} value={text(["phone", "when"])} onChange={(e) => set(["phone", "when"], e.target.value)}>
                {Object.entries(WHEN).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            )}
          </Field>
          {txt("Aktarma numarası", ["phone", "transferNumber"], { optional: true })}
          {txt("Diller", ["phone", "languages"], { optional: true })}
        </div>
      </fieldset>

      <fieldset className="editor-group">
        <legend>Çalışma saatleri</legend>
        <div className="editor-hours">
          {hours.map((h) => (
            <div key={h.day} className="editor-hour">
              <label className="check"><input type="checkbox" checked={h.open} onChange={(e) => setHour(h.day, e.target.checked ? { open: true, from: h.from ?? "09:00", to: h.to ?? "18:00" } : { open: false })} /> <span>{DAYS[h.day - 1]}</span></label>
              {h.open ? (
                <>
                  <Input type="time" aria-label={`${DAYS[h.day - 1]} açılış`} value={h.from ?? ""} onChange={(e) => setHour(h.day, { from: e.target.value })} />
                  <span aria-hidden="true">–</span>
                  <Input type="time" aria-label={`${DAYS[h.day - 1]} kapanış`} value={h.to ?? ""} onChange={(e) => setHour(h.day, { to: e.target.value })} />
                </>
              ) : <span className="muted small">Kapalı</span>}
            </div>
          ))}
        </div>
        {area("Kapalı günler", ["closedDates"], 2)}
      </fieldset>

      <fieldset className="editor-group">
        <legend>Hizmetler ({services.length})</legend>
        {services.map((s, i) => (
          <div key={i} className="editor-row">
            <Input aria-label="Hizmet adı" placeholder="Hizmet adı" value={s.name ?? ""} onChange={(e) => set(["services", i, "name"], e.target.value)} />
            <Input aria-label="Süre (dk)" placeholder="Süre dk" type="number" min={5} value={s.durationMin ?? ""} onChange={(e) => set(["services", i, "durationMin"], num(e.target.value))} />
            <Input aria-label="Fiyat" placeholder="Fiyat" value={s.price ?? ""} onChange={(e) => set(["services", i, "price"], e.target.value)} />
            <Input aria-label="Not" placeholder="Not" value={s.note ?? ""} onChange={(e) => set(["services", i, "note"], e.target.value)} />
            <Button type="button" size="sm" variant="quiet" onClick={() => set(["services"], services.filter((_, j) => j !== i))} aria-label={`${s.name || "Hizmet"} satırını sil`}>Sil</Button>
          </div>
        ))}
        <Button type="button" size="sm" variant="quiet" onClick={() => set(["services"], [...services, { name: "" }])}>Hizmet ekle</Button>
      </fieldset>

      <fieldset className="editor-group">
        <legend>Ekip ({staff.length})</legend>
        {staff.map((s, i) => (
          <div key={i} className="editor-row">
            <Input aria-label="Ad" placeholder="Ad" value={s.name ?? ""} onChange={(e) => set(["staff", i, "name"], e.target.value)} />
            <Input aria-label="Unvan" placeholder="Unvan" value={s.title ?? ""} onChange={(e) => set(["staff", i, "title"], e.target.value)} />
            <Input aria-label="Telefon" placeholder="Telefon" value={s.phone ?? ""} onChange={(e) => set(["staff", i, "phone"], e.target.value)} />
            <Input aria-label="Yaptığı işler" placeholder="Yaptığı işler" value={s.services ?? ""} onChange={(e) => set(["staff", i, "services"], e.target.value)} />
            <Button type="button" size="sm" variant="quiet" onClick={() => set(["staff"], staff.filter((_, j) => j !== i))} aria-label={`${s.name || "Kişi"} satırını sil`}>Sil</Button>
          </div>
        ))}
        <Button type="button" size="sm" variant="quiet" onClick={() => set(["staff"], [...staff, { name: "" }])}>Kişi ekle</Button>
      </fieldset>

      <fieldset className="editor-group">
        <legend>Kurallar ve asistan</legend>
        {area("İptal kuralı", ["policies", "cancellation"])}
        {area("Ödeme", ["policies", "payment"], 2)}
        {area("Özel kurallar", ["policies", "health"])}
        {area("Sık sorulanlar", ["policies", "faq"], 5)}
        <div className="grid-2">{txt("Asistan adı", ["agent", "name"], { optional: true })}</div>
      </fieldset>

      {errors.length > 0 && <ul className="admin-json-errors" role="alert">{errors.map((t) => <li key={t}>{t}</li>)}</ul>}
      <div className="row-actions">
        <Button onClick={() => onSave(clean(d) as Data)} busy={busy}>Değişiklikleri kaydet</Button>
      </div>
    </div>
  );
}
