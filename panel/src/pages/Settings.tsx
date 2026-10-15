import { DatePicker } from "../components/DatePicker.tsx";
import { useEffect, useRef, useState } from "react";
import { VoicePicker } from "../components/VoicePicker.tsx";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type SettingsResponse, type TenantConfig } from "../api.ts";
import { useMe } from "../App.tsx";
import { useQueryParam } from "../router.tsx";
import { Button, Checkbox, ErrorBox, Field, Icon, Input, Loading, Select, Textarea, useToast } from "../components/ui.tsx";

type Hours = TenantConfig["hours"];
type DayKey = keyof Hours;
const DAYS: [DayKey, string][] = [["1", "Pazartesi"], ["2", "Salı"], ["3", "Çarşamba"], ["4", "Perşembe"], ["5", "Cuma"], ["6", "Cumartesi"], ["7", "Pazar"]];

const SECTIONS = [
  { id: "isletme", label: "İşletme" },
  { id: "saatler", label: "Çalışma saatleri" },
  { id: "hizmetler", label: "Hizmetler ve fiyatlar" },
  { id: "ekip", label: "Ekip" },
  { id: "odalar", label: "Odalar ve alanlar" },
  { id: "sss", label: "Sık sorulanlar" },
  { id: "asistan", label: "Asistan" },
  { id: "telefon", label: "Telefon ve aktarma" },
  { id: "bildirimler", label: "Bildirimler" },
] as const;

export function SettingsPage() {
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const [section, setSection] = useQueryParam("bolum", "isletme");
  const q = useQuery({ queryKey: ["settings"], queryFn: () => api<SettingsResponse>("/settings"), refetchOnWindowFocus: false });
  const [config, setConfig] = useState<TenantConfig | null>(null);
  const [state, setState] = useState<Pick<SettingsResponse, "hasDraft" | "changes" | "issues"> | null>(null);
  const [saving, setSaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (q.data && !config) {
      setConfig(q.data.config);
      setState({ hasDraft: q.data.hasDraft, changes: q.data.changes, issues: q.data.issues });
    }
  }, [q.data, config]);

  /** Her değişiklik kısa bir gecikmeyle taslak olarak kaydedilir */
  const update = (next: TenantConfig) => {
    setConfig(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setSaving(true);
      try {
        const res = await api<SettingsResponse>("/settings", { method: "PUT", body: { config: next } });
        setState({ hasDraft: res.hasDraft, changes: res.changes, issues: res.issues });
        // Sunucunun verdiği kimlikleri al (yeni hizmet/personel)
        setConfig((cur) => (cur === next ? res.config : cur));
      } catch (e) {
        toast(e instanceof Error ? e.message : "Taslak kaydedilemedi", "error");
      } finally {
        setSaving(false);
      }
    }, 700);
  };

  const publish = useMutation({
    mutationFn: async () => {
      clearTimeout(timer.current);
      if (config) await api("/settings", { method: "PUT", body: { config } });
      return api<{ version: number; changes: string[] }>("/settings/publish", { method: "POST" });
    },
    onSuccess: (r) => {
      toast(`Yayınlandı: ${r.changes.join(", ") || "değişiklikler"}. Asistan yeni bilgilerle konuşuyor.`);
      setState({ hasDraft: false, changes: [], issues: [] });
      qc.invalidateQueries({ queryKey: ["me"] });
      qc.invalidateQueries({ queryKey: ["today"] });
    },
    onError: (e) => {
      if (e instanceof ApiError && Array.isArray(e.body.issues)) setState((s) => s && { ...s, issues: e.body.issues as SettingsResponse["issues"] });
      toast(e.message, "error");
    },
  });
  const discard = useMutation({
    mutationFn: () => api("/settings/discard", { method: "POST" }),
    onSuccess: async () => {
      const fresh = await qc.fetchQuery({ queryKey: ["settings"], queryFn: () => api<SettingsResponse>("/settings") });
      setConfig(fresh.config);
      setState({ hasDraft: false, changes: [], issues: [] });
      toast("Değişikliklerden vazgeçildi");
    },
  });

  if (q.isLoading || !config || !state) return q.error ? <section className="page"><ErrorBox error={q.error} /></section> : <Loading />;
  const meta = q.data!.meta;
  const issue = (prefix: string) => state.issues.find((i) => i.path === prefix || i.path.startsWith(`${prefix}.`))?.message;
  const set = <K extends keyof TenantConfig>(k: K, v: TenantConfig[K]) => update({ ...config, [k]: v });

  return (
    <section className="page settings">
      <header className="page-head">
        <div>
          <h1 className="page-title">Kurulum</h1>
          <p className="page-sub">Asistanınızı ve işletme bilgilerinizi buradan kurarsınız. Değişiklikler önce taslak olarak kaydedilir; yayınladığınızda asistan yeni bilgilerle konuşur.</p>
        </div>
        <div className="publish-status" role="status" aria-live="polite">
          <span className={`pill ${!me.testCallEnabled ? "pill-info" : state.hasDraft ? "pill-draft" : "pill-live"}`}>
            {!me.testCallEnabled ? "Asistan hazırlanıyor" : state.hasDraft ? "Yayınlanmamış değişiklik" : "Yayında"}
          </span>
          {state.hasDraft ? (
            <>
              <Button size="sm" variant="ghost" onClick={() => discard.mutate()} busy={discard.isPending}>Taslağı at</Button>
              <Button size="sm" onClick={() => publish.mutate()} busy={publish.isPending} disabled={state.issues.length > 0}>Yayınla</Button>
            </>
          ) : (
            <>
              {me.testCallEnabled && q.data?.publishedAt && <span className="muted small">Son yayın: {new Date(q.data.publishedAt).toLocaleString("tr-TR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>}
              <Button size="sm" variant="quiet" disabled title="Yayınlanacak değişiklik yok">Yayınla</Button>
            </>
          )}
        </div>
      </header>

      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Ayar bölümleri">
          {SECTIONS.map((s) => (
            <button key={s.id} aria-current={section === s.id ? "page" : undefined} onClick={() => setSection(s.id)}>
              {s.id === "ekip" ? meta.staffLabel : s.id === "odalar" ? meta.roomLabelPlural : s.label}
              {state.issues.some((i) => sectionOf(i.path) === s.id) && <span className="dot-error" aria-label="hata var" />}
            </button>
          ))}
        </nav>

        <div className="settings-body card">
          {section === "isletme" && (
            <Group title="İşletme bilgileri">
              <Field label="İşletmenin adı" hint="Asistan telefonu bu adla açar" error={issue("name")}>
                {(id, d) => <Input id={id} aria-describedby={d} value={config.name} onChange={(e) => set("name", e.target.value)} />}
              </Field>
            </Group>
          )}

          {section === "saatler" && (
            <>
              <Group title="Haftalık çalışma saatleri" hint="Asistan yalnızca bu saatler içinde randevu önerir.">
                <WeekEditor hours={config.hours} onChange={(h) => set("hours", h)} />
              </Group>
              <Group title="Kapalı günler" hint="Bayram, bakım gibi özel günler">
                <ClosedDates dates={config.closedDates} onChange={(d) => set("closedDates", d)} />
              </Group>
              <Group title="Randevu kuralları">
                <div className="grid-3">
                  <Field label="En az kaç dk önceden" hint="Aynı gün için" error={issue("minLeadMinutes")}>
                    {(id, d) => <Input id={id} aria-describedby={d} type="number" min={0} step={15} value={config.minLeadMinutes} onChange={(e) => set("minLeadMinutes", Number(e.target.value))} />}
                  </Field>
                  <Field label="En fazla kaç gün ileri" error={issue("maxDaysAhead")}>
                    {(id) => <Input id={id} type="number" min={1} value={config.maxDaysAhead} onChange={(e) => set("maxDaysAhead", Number(e.target.value))} />}
                  </Field>
                  <Field label="Saat aralığı" hint="Önerilen saatlerin adımı">
                    {(id, d) => (
                      <Select id={id} aria-describedby={d} value={config.slotStepMinutes} onChange={(e) => set("slotStepMinutes", Number(e.target.value))}>
                        {[10, 15, 20, 30, 60].map((m) => <option key={m} value={m}>{m} dakika</option>)}
                      </Select>
                    )}
                  </Field>
                </div>
              </Group>
            </>
          )}

          {section === "hizmetler" && (
            <Group title="Hizmetler ve fiyatlar" hint="Süreye hazırlık ve temizlik dahil değildir; onu ayrıca girin." error={issue("services")}>
              <Rows
                items={config.services}
                onChange={(v) => set("services", v)}
                addLabel="Hizmet ekle"
                blank={() => ({ name: "", aliases: [], durationMin: 60, bufferMin: 15, priceTRY: 0, roomType: Object.keys(meta.roomTypes)[0] ?? "tek", staffCount: 1 })}
                render={(s, i, patch) => (
                  <>
                    <div className="grid-svc">
                      <Field label="Hizmet adı" error={issue(`services.${i}.name`)}>{(id) => <Input id={id} value={s.name} onChange={(e) => patch({ name: e.target.value })} />}</Field>
                      <Field label="Süre (dk)" error={issue(`services.${i}.durationMin`)}>{(id) => <Input id={id} type="number" min={5} value={s.durationMin} onChange={(e) => patch({ durationMin: Number(e.target.value) })} />}</Field>
                      <Field label="Hazırlık (dk)">{(id) => <Input id={id} type="number" min={0} value={s.bufferMin} onChange={(e) => patch({ bufferMin: Number(e.target.value) })} />}</Field>
                      <Field label="Fiyat (TL)" error={issue(`services.${i}.priceTRY`)}>{(id) => <Input id={id} type="number" min={0} value={s.priceTRY} onChange={(e) => patch({ priceTRY: Number(e.target.value) })} />}</Field>
                      <Field label={`Nerede (${meta.roomLabel.toLocaleLowerCase("tr")})`} error={issue(`services.${i}.roomType`)}>
                        {(id) => (
                          <Select id={id} value={s.roomType} onChange={(e) => patch({ roomType: e.target.value })}>
                            {Object.entries(meta.roomTypes).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                          </Select>
                        )}
                      </Field>
                      <Field label={`Kaç ${meta.staffTerm}`} error={issue(`services.${i}.staffCount`)}>
                        {(id) => (
                          <Select id={id} value={s.staffCount} onChange={(e) => patch({ staffCount: Number(e.target.value) })}>
                            {[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
                          </Select>
                        )}
                      </Field>
                    </div>
                    <Field label="Müşterilerin kullandığı diğer adlar" hint="Virgülle ayırın; asistan bu kelimeleri de anlar" optional>
                      {(id, d) => <Input id={id} aria-describedby={d} value={s.aliases.join(", ")} onChange={(e) => patch({ aliases: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} />}
                    </Field>
                  </>
                )}
              />
            </Group>
          )}

          {section === "ekip" && (
            <Group title={meta.staffLabel} hint="Kim hangi hizmeti yapıyor? Asistan aynı saatte aynı kişiye iki randevu vermez.">
              <Rows
                items={config.staff}
                onChange={(v) => set("staff", v)}
                addLabel="Kişi ekle"
                blank={() => ({ name: "", gender: "kadin" as const, services: [] })}
                render={(p, i, patch) => (
                  <>
                    <div className="grid-2">
                      <Field label="Adı" error={issue(`staff.${i}.name`)}>{(id) => <Input id={id} value={p.name} onChange={(e) => patch({ name: e.target.value })} />}</Field>
                      <Field label="Cinsiyeti" hint="Kadın/erkek tercihi soran müşteriler için">
                        {(id, d) => (
                          <Select id={id} aria-describedby={d} value={p.gender} onChange={(e) => patch({ gender: e.target.value as "kadin" | "erkek" })}>
                            <option value="kadin">Kadın</option>
                            <option value="erkek">Erkek</option>
                          </Select>
                        )}
                      </Field>
                    </div>
                    <fieldset className="field">
                      <legend className="field-label">Yaptığı hizmetler</legend>
                      <div className="tags">
                        {config.services.filter((s) => s.id).map((s) => (
                          <label key={s.id} className="tag-check">
                            <input type="checkbox" checked={p.services.includes(s.id!)} onChange={(e) => patch({ services: e.target.checked ? [...p.services, s.id!] : p.services.filter((x) => x !== s.id) })} />
                            {s.name}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    <Checkbox
                      label="İşletme saatlerinden farklı çalışıyor"
                      checked={!!p.hours}
                      onChange={(v) => patch({ hours: v ? structuredClone(config.hours) : undefined })}
                    />
                    {p.hours && <WeekEditor hours={p.hours} onChange={(h) => patch({ hours: h })} compact />}
                  </>
                )}
              />
            </Group>
          )}

          {section === "odalar" && (
            <Group title={meta.roomLabelPlural} hint="Aynı anda kaç randevu yapılabileceğini belirler." error={issue("rooms")}>
              <RoomCounts rooms={config.rooms} types={meta.roomTypes} onChange={(r) => set("rooms", r)} />
            </Group>
          )}

          {section === "sss" && (
            <Group title="Sık sorulanlar ve kurallar" hint="Asistan yalnızca buradaki bilgilerle cevap verir; burada olmayan soru için sizin aramanız için not bırakır.">
              <Rows
                items={config.faq}
                onChange={(v) => set("faq", v)}
                addLabel="Soru ekle"
                blank={() => ({ q: "", a: "" })}
                render={(f, i, patch) => (
                  <>
                    <Field label="Soru veya konu" error={issue(`faq.${i}.q`)}>{(id) => <Input id={id} value={f.q} onChange={(e) => patch({ q: e.target.value })} placeholder="Örn. Otopark" />}</Field>
                    <Field label="Cevap" error={issue(`faq.${i}.a`)}>{(id) => <Textarea id={id} rows={2} value={f.a} onChange={(e) => patch({ a: e.target.value })} />}</Field>
                  </>
                )}
              />
            </Group>
          )}

          {section === "asistan" && (
            <Group title="Asistan">
              <VoicePicker
                value={config.agent.voiceId}
                agent={{ name: config.agent.name, greeting: config.agent.greeting ?? "" }}
                defaultGreeting={meta.defaultGreeting}
                firma={config.name}
                nameError={issue("agent.name")}
                onApply={(a) => set("agent", { ...config.agent, voiceId: a.voiceId, name: a.name, greeting: a.greeting || undefined } as TenantConfig["agent"])}
              />
            </Group>
          )}

          {section === "telefon" && (
            <Group title="Telefon ve aktarma">
              <AssistantNumber tenantId={config.id} numbers={meta.phoneNumbers} canEdit={me.user.role === "agency"} onSaved={() => void qc.invalidateQueries({ queryKey: ["settings"] })} />

              <div className="phone-block">
                <h3 className="phone-sub">Mevcut numaranızı yönlendirin</h3>
                <PublicNumber assistantNumber={meta.phoneNumbers[0]} value={config.handoff.publicNumber} onChange={(v) => set("handoff", { ...config.handoff, publicNumber: v } as TenantConfig["handoff"])} error={issue("handoff.publicNumber")} />
              </div>

              <div className="phone-block">
                <h3 className="phone-sub">Yetkiliye aktarma</h3>
                <Field
                  label="Aktarma numarası"
                  hint="Müşteri bir yetkiliyle görüşmek isterse çağrı buraya aktarılır. Asistanın numarasından ve yönlendirdiğiniz numaradan farklı olmalı. Boş bırakırsanız asistan geri arama notu alır."
                  error={issue("handoff")}
                  optional
                >
                  {(id, d) => <Input id={id} aria-describedby={d} type="tel" placeholder="+905xxxxxxxxx" value={config.handoff.transferNumber ?? ""} onChange={(e) => set("handoff", { ...config.handoff, transferNumber: e.target.value.trim() || undefined } as TenantConfig["handoff"])} />}
                </Field>
                <Checkbox
                  label="Kaçan çağrılar için otomatik geri arama notu aç"
                  hint="Hat doluyken bekleyip kapatan arayanlar Geri aramalar listesine düşer"
                  checked={config.calls.callbackOnMissed}
                  onChange={(v) => set("calls", { ...config.calls, callbackOnMissed: v })}
                />
              </div>
            </Group>
          )}

          {section === "bildirimler" && (
            <Group title="Müşteriye onay mesajı">
              <fieldset className="field">
                <legend className="field-label">Kanal</legend>
                <Checkbox label="WhatsApp" checked={config.notifications.channels.includes("whatsapp")} onChange={(v) => set("notifications", { ...config.notifications, channels: toggle(config.notifications.channels, "whatsapp", v) })} />
                <Checkbox label="SMS" hint="WhatsApp seçiliyse ulaşamazsa SMS gider" checked={config.notifications.channels.includes("sms")} onChange={(v) => set("notifications", { ...config.notifications, channels: toggle(config.notifications.channels, "sms", v) })} />
                {issue("notifications") && <p className="field-error">{issue("notifications")}</p>}
              </fieldset>
              <Field label="Mesaj metni" hint="{firma} {isim} {hizmet} {zaman} {personel} yerine bilgiler yazılır" optional>
                {(id, d) => <Textarea id={id} aria-describedby={d} rows={3} value={config.notifications.confirmationTemplate ?? ""} placeholder={meta.defaultConfirmation} onChange={(e) => set("notifications", { ...config.notifications, confirmationTemplate: e.target.value || undefined } as TenantConfig["notifications"])} />}
              </Field>
              <p className="preview"><span>Önizleme</span>{fillTpl(config.notifications.confirmationTemplate || meta.defaultConfirmation, { firma: config.name, isim: "Zeynep Kaya", hizmet: config.services[0]?.name ?? "Hizmet", zaman: "14 Ekim Çarşamba, saat 15", personel: config.staff[0] ? ` (${config.staff[0].name})` : "" })}</p>
            </Group>
          )}
        </div>
      </div>

      {state.hasDraft && (
        <div className="publish-bar" role="region" aria-label="Yayınlanmamış değişiklikler">
          <div>
            <p className="publish-title">Yayınlanmamış değişiklikler{saving ? " (kaydediliyor…)" : ""}</p>
            <p className="publish-sub">{state.issues.length ? `${state.issues.length} alan düzeltilmeli: ${state.issues[0]!.message}` : state.changes.join(", ")}</p>
          </div>
          <div className="row-actions">
            <Button variant="ghost" onClick={() => discard.mutate()} busy={discard.isPending}>Vazgeç</Button>
            <Button onClick={() => publish.mutate()} busy={publish.isPending} disabled={state.issues.length > 0}>Yayınla</Button>
          </div>
        </div>
      )}
    </section>
  );
}

/* ---------------- yardımcılar ---------------- */
const sectionOf = (path: string) => {
  const head = path.split(".")[0];
  return ({ name: "isletme", hours: "saatler", closedDates: "saatler", minLeadMinutes: "saatler", maxDaysAhead: "saatler", slotStepMinutes: "saatler", services: "hizmetler", staff: "ekip", rooms: "odalar", faq: "sss", agent: "asistan", handoff: "telefon", calls: "telefon", notifications: "bildirimler", sms: "bildirimler" } as Record<string, string>)[head ?? ""];
};
const toggle = <T,>(arr: T[], v: T, on: boolean) => (on ? [...new Set([...arr, v])] : arr.filter((x) => x !== v));
const fillTpl = (t: string, vars: Record<string, string>) => t.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "");

function Group({ title, hint, error, children }: { title: string; hint?: string; error?: string | undefined; children: React.ReactNode }) {
  return (
    <section className="settings-group">
      <h2>{title}</h2>
      {hint && <p className="muted">{hint}</p>}
      {error && <p className="field-error">{error}</p>}
      <div className="stack">{children}</div>
    </section>
  );
}

function Rows<T>({ items, onChange, render, blank, addLabel }: {
  items: T[]; onChange: (v: T[]) => void; render: (item: T, i: number, patch: (p: Partial<T>) => void) => React.ReactNode; blank: () => T; addLabel: string;
}) {
  return (
    <div className="rows">
      {items.map((item, i) => (
        <div key={i} className="row-item">
          {render(item, i, (p) => onChange(items.map((x, j) => (j === i ? { ...x, ...p } : x))))}
          <button type="button" className="link-danger" onClick={() => onChange(items.filter((_, j) => j !== i))}>Kaldır</button>
        </div>
      ))}
      <Button type="button" variant="quiet" size="sm" onClick={() => onChange([...items, blank()])}><Icon name="plus" size={18} />{addLabel}</Button>
    </div>
  );
}

function WeekEditor({ hours, onChange, compact }: { hours: Hours; onChange: (h: Hours) => void; compact?: boolean }) {
  return (
    <div className={`week${compact ? " week-compact" : ""}`}>
      {DAYS.map(([k, name]) => {
        const win = hours[k][0];
        const open = !!win;
        const setDay = (v: [string, string][]) => onChange({ ...hours, [k]: v });
        return (
          <div key={k} className={`week-row${open ? "" : " is-closed"}`}>
            <label className="week-day">
              <input type="checkbox" checked={open} onChange={(e) => setDay(e.target.checked ? [["10:00", "20:00"]] : [])} />
              {name}
            </label>
            {open ? (
              <>
                <input className="input" type="time" aria-label={`${name} açılış`} value={win![0]} onChange={(e) => setDay([[e.target.value, win![1]], ...hours[k].slice(1)])} />
                <span className="muted">–</span>
                <input className="input" type="time" aria-label={`${name} kapanış`} value={win![1]} onChange={(e) => setDay([[win![0], e.target.value], ...hours[k].slice(1)])} />
              </>
            ) : (
              <span className="muted">Kapalı</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ClosedDates({ dates, onChange }: { dates: string[]; onChange: (d: string[]) => void }) {
  const [v, setV] = useState("");
  return (
    <div className="stack">
      <div className="inline-form">
        <DatePicker value={v} onChange={(e) => setV(e.target.value)} aria-label="Kapalı gün" placeholder="Kapalı günü seç" />
        <Button type="button" variant="quiet" size="sm" disabled={!v || dates.includes(v)} onClick={() => { onChange([...dates, v].sort()); setV(""); }}>Ekle</Button>
      </div>
      {!!dates.length && (
        <ul className="date-tags">
          {dates.map((d) => (
            <li key={d}>
              {new Date(`${d}T00:00:00Z`).toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}
              <button type="button" aria-label={`${d} kaldır`} onClick={() => onChange(dates.filter((x) => x !== d))}><Icon name="close" size={14} /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Odalar: tip başına adet (kimlikleri sunucu verir) */
function RoomCounts({ rooms, types, onChange }: { rooms: TenantConfig["rooms"]; types: Record<string, string>; onChange: (r: TenantConfig["rooms"]) => void }) {
  const count = (t: string) => rooms.filter((r) => r.type === t).length;
  const setCount = (t: string, n: number) => {
    const same = rooms.filter((r) => r.type === t);
    const others = rooms.filter((r) => r.type !== t);
    const next = n <= same.length ? same.slice(0, n) : [...same, ...Array.from({ length: n - same.length }, () => ({ type: t }))];
    onChange([...others, ...next]);
  };
  return (
    <div className="grid-3">
      {Object.entries(types).map(([t, label]) => (
        <Field key={t} label={label}>
          {(id) => <Input id={id} type="number" min={0} max={50} value={count(t)} onChange={(e) => setCount(t, Math.max(0, Number(e.target.value)))} />}
        </Field>
      ))}
    </div>
  );
}

/** +908503038332 → 0850 303 83 32 */
const showPhone = (e164: string) => {
  const d = e164.replace("+90", "");
  return d.length === 10 ? `0${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6, 8)} ${d.slice(8)}` : e164;
};

/** Müşteri kendi 0850 numarasını kullanmak isterse yöneticiye talep iletir; numara kendiliğinden değişmez */
function OwnNumberRequest() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [number, setNumber] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      await api("/api/panel/phone-request", { method: "POST", body: { number, note } });
      toast("Talebiniz iletildi. Numarayı doğrulayıp size döneceğiz.");
      setOpen(false);
      setNumber("");
      setNote("");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Talep iletilemedi", "error");
    } finally {
      setBusy(false);
    }
  };
  if (!open) return <div className="row-actions"><Button variant="quiet" onClick={() => setOpen(true)}>Kendi 0850 numaramı kullanmak istiyorum</Button></div>;
  return (
    <div className="phone-block">
      <p className="muted small">Kendi aboneliğinizde bir 0850 numaranız varsa bildirin. Ekibimiz numarayı doğrular ve tanımlar; numara kendiliğinden değişmez.</p>
      <Field label="Numaranız">{(id) => <Input id={id} type="tel" placeholder="0850 000 00 00" value={number} onChange={(e) => setNumber(e.target.value)} />}</Field>
      <Field label="Not (isteğe bağlı)">{(id) => <Input id={id} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
      <div className="row-actions">
        <Button onClick={() => void send()} busy={busy} disabled={!number.trim()}>Talebi ilet</Button>
        <Button variant="quiet" onClick={() => setOpen(false)}>Vazgeç</Button>
      </div>
    </div>
  );
}

/**
 * Müşterinin kendi hattında kuracağı yönlendirme kodları, numarası yazılmış olarak. Önerilen: koşullu (meşgul, cevapsız, kapalı).
 * Kod biçimleri Turkcell ve Türk Telekom sayfalarındandır; numara biçimi operatörlere göre değişebilir (operatör testi sürüyor).
 */
function ForwardingCodes({ number }: { number: string }) {
  const toast = useToast();
  if (number.startsWith("+90850999")) return <p className="muted small">Bu bir deneme numarasıdır, gerçek aramaları karşılamaz.</p>;
  const rows: [string, string][] = [
    ["Meşgulken", `**67*${number}#`],
    ["15 saniye cevap verilmezse", `**61*${number}**15#`],
    ["Telefon kapalı ya da kapsama dışındayken", `**62*${number}#`],
  ];
  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      toast("Kod kopyalandı. Telefonunuzun arama ekranına yapıştırıp arayın.");
    } catch {
      toast("Kopyalanamadı; kodu elle yazın", "error");
    }
  };
  return (
    <details className="phone-codes">
      <summary>Yönlendirme kodlarım</summary>
      <p className="muted small">Önerilen kurulum <strong>koşullu</strong> yönlendirmedir: telefonu siz açarsınız, yalnızca açamadığınız çağrıları asistan karşılar. Aşağıdaki kodlardan birini <strong>kendi işletme telefonunuzdan</strong> arama ekranına yazıp arayın. Önce asistanı deneyin.</p>
      <table className="data-table">
        <tbody>
          {rows.map(([label, code]) => (
            <tr key={label}>
              <td>{label}</td>
              <td><code>{code}</code></td>
              <td className="cell-actions"><Button variant="quiet" size="sm" onClick={() => void copy(code)}>Kopyala</Button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">İptal etmek için <code>##002#</code> tuşlayıp arayın. Kod kabul edilmezse numarayı <code>{`0${number.replace("+90", "")}`}</code> biçiminde yazın.</p>
      <p className="muted small">Yönlendirilen çağrıyı operatörünüz ücretlendirebilir (örneğin Turkcell yönlendirme servis ücreti alıyor). Güncel ücreti operatörünüzden öğrenin.</p>
    </details>
  );
}

/**
 * Asistanın 0850 numarası. Numara sunucuda korunan alandır: yalnızca yönetici değiştirebilir,
 * kaydedince ElevenLabs'te asistana da bağlanır. Firma sahibi yalnızca görür.
 */
function AssistantNumber({ tenantId, numbers, canEdit, onSaved }: { tenantId: string; numbers: string[]; canEdit: boolean; onSaved: () => void }) {
  const toast = useToast();
  const key = numbers.join(", ");
  const [value, setValue] = useState(key);
  const [busy, setBusy] = useState(false);
  useEffect(() => setValue(key), [key]);
  const save = async () => {
    setBusy(true);
    try {
      const r = await api<{ phone?: { connected: boolean; error?: string } }>(`/api/admin/tenants/${tenantId}`, {
        method: "PATCH",
        body: { phoneNumbers: value.split(/[\n,]/).map((x) => x.trim()).filter(Boolean) },
      });
      if (r.phone && !r.phone.connected) toast(`Numara kaydedildi ama asistana bağlanamadı: ${r.phone.error}`, "error");
      else toast(r.phone ? "Numara kaydedildi ve asistana bağlandı" : "Numara kaydedildi");
      onSaved();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Kaydedilemedi", "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="phone-block">
      <h3 className="phone-sub">Asistanın numarası</h3>
      {canEdit ? (
        <>
          <Field label="0850 numarası" hint="Birden fazla numara varsa virgülle ayırın. Kaydedince asistana bağlanır; bu değişiklik taslağı beklemeden canlıya uygulanır.">
            {(id, d) => <Input id={id} aria-describedby={d} type="tel" placeholder="0850 000 00 00" value={value} onChange={(e) => setValue(e.target.value)} />}
          </Field>
          <div className="row-actions"><Button variant="quiet" onClick={() => void save()} busy={busy}>Numarayı kaydet ve bağla</Button></div>
        </>
      ) : numbers.length ? (
        <>
          <p className="phone-number">{numbers.map(showPhone).join(" · ")}</p>
          <ForwardingCodes number={numbers[0]!} />
          <OwnNumberRequest />
        </>
      ) : (
        <p className="muted">Henüz bağlanmadı. Hat açıldığında numara burada görünür.</p>
      )}
      <p className="muted small">Müşterileriniz bu numarayı aradığında ya da numaranız buraya yönlendirildiğinde asistan cevap verir.</p>
    </div>
  );
}

/** Firmanın mevcut numarası ve oraya çağrı yönlendirme kodları (kapalı açılır liste) */
function PublicNumber({ assistantNumber, value, onChange, error }: { assistantNumber?: string; value?: string | undefined; onChange: (v: string | undefined) => void; error?: string | undefined }) {
  // Operatör kodlarında numara başında 0 ile yazılır
  const dial = assistantNumber ? assistantNumber.replace("+90", "0") : "0850XXXXXXX";
  return (
    <>
      <Field label="Şu an müşterilerin aradığı numara" hint="Yalnızca kayıt içindir; yönlendirmeyi operatörden siz yaparsınız." error={error} optional>
        {(id, d) => <Input id={id} aria-describedby={d} type="tel" placeholder="0212 000 00 00 ya da 05xx xxx xx xx" value={value ?? ""} onChange={(e) => onChange(e.target.value.trim() || undefined)} />}
      </Field>
      <details className="note">
        <summary>Yönlendirme kodları</summary>
        <p>Yönlendirilecek telefondan tuşlayıp arayın:</p>
        <ul>
          <li>Tüm aramalar: <code>**21*{dial}#</code></li>
          <li>Açılmazsa: <code>**61*{dial}#</code></li>
          <li>Meşgulse: <code>**67*{dial}#</code></li>
          <li>Ulaşılamıyorsa: <code>**62*{dial}#</code></li>
          <li>Hepsini kapatmak için: <code>##002#</code></li>
        </ul>
        <p className="muted small">Sabit hatlarda (0212 gibi) kodlar operatöre göre değişir; operatörünüzden çağrı yönlendirme isteyin. Tüm aramaları yönlendirirseniz o numaradan size ulaşılamaz.</p>
      </details>
    </>
  );
}
