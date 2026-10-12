import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type VoiceOption } from "../api.ts";
import { Button, ErrorBox, Field, Icon, Input, Loading, Modal, Segmented, Textarea } from "./ui.tsx";
import { HUES, VoiceOrb } from "./VoiceOrb.tsx";
import { useVoicePlayer } from "./voice-player.ts";

const detail = (v: VoiceOption) => [v.gender === "female" ? "Kadın" : v.gender === "male" ? "Erkek" : "", ...v.tags].filter(Boolean).join(" · ");
const fillTpl = (t: string, vars: Record<string, string>) => t.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "");

export interface AgentIdentity {
  voiceId: string;
  name: string;
  /** Boşsa sektör şablonundaki varsayılan karşılama kullanılır */
  greeting: string;
}

/**
 * Asistan sesi galerisi. Üstte seçili ses büyük bir küre olarak durur; altında her ses kendi küresiyle bir kart.
 * Kartlardaki "Dinle" tüm seslerde aynı örnek cümleyi çalar. Kartın sağ üstündeki ⋮ düğmesi bir pencere açar:
 * asistanın adı ve karşılama cümlesi orada girilir, "Onayla" ses, ad ve karşılamayı birlikte taslağa yazar
 * (asistana "Yayınla" ile uygulanır).
 */
export function VoicePicker({ value, agent, defaultGreeting, firma, nameError, onApply, endpoint = "/voices" }: {
  /** Ses listesi ucu: müşteri panelinde "/voices", yönetici panelinde "/api/admin/voices" */
  endpoint?: string;
  value: string | undefined;
  agent: { name: string; greeting: string };
  defaultGreeting: string;
  firma: string;
  nameError?: string | undefined;
  onApply: (a: AgentIdentity) => void;
}) {
  const q = useQuery({ queryKey: ["voices", endpoint], queryFn: () => api<{ voices: VoiceOption[]; enabled: boolean; defaultId: string }>(endpoint), staleTime: 3_600_000, retry: false });
  const [gender, setGender] = useState<"all" | "female" | "male">("all");
  const [editing, setEditing] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const { playingId, play } = useVoicePlayer(root);

  if (q.isLoading) return <Loading label="Sesler yükleniyor" />;
  if (q.error) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data?.enabled || !q.data.voices.length) return <p className="muted small">Ses seçimi şu an kullanılamıyor. Asistanınız varsayılan sesle konuşur.</p>;

  // Her ses ayrı bir renk ailesi alır (listedeki sıraya göre; çakışma olmaz)
  const ids = q.data.voices.map((v) => v.id).sort();
  const hueOf = (id: string) => HUES[ids.indexOf(id) % HUES.length]!;
  const selectedId = value ?? q.data.defaultId;
  const current = q.data.voices.find((v) => v.id === selectedId) ?? q.data.voices[0]!;
  const voices = q.data.voices.filter((v) => gender === "all" || v.gender === gender);
  const editingVoice = q.data.voices.find((v) => v.id === editing) ?? null;
  const listen = (v: VoiceOption) => v.previewUrl && void play(v.id, v.previewUrl);

  const kebab = (v: VoiceOption) => (
    <button type="button" className="voice-kebab" onClick={() => setEditing(v.id)} aria-label={`${v.name} için asistan adı ve karşılamayı düzenle`} title="Düzenle">
      <Icon name="moreV" size={18} />
    </button>
  );

  return (
    <div className="voices" ref={root}>
      <section className={`voice-hero${playingId === current.id ? " is-playing" : ""}`} aria-label="Seçili ses">
        {kebab(current)}
        <button type="button" className="voice-hero-orb" onClick={() => listen(current)} disabled={!current.previewUrl} aria-label={`${current.name} sesini ${playingId === current.id ? "durdur" : "dinle"}`}>
          <VoiceOrb id={current.id} hue={hueOf(current.id)} size={148} active={playingId === current.id} />
        </button>
        <div className="voice-hero-text">
          <p className="voice-hero-label">Asistanınızın sesi</p>
          <h3 className="voice-hero-name">{current.name}</h3>
          <p className="muted">{detail(current) || "Türkçe ses"}</p>
          <p className="voice-hero-line">“{fillTpl(agent.greeting || defaultGreeting, { firma, ajan: agent.name })}”</p>
          {current.previewUrl && (
            <Button size="sm" variant="quiet" onClick={() => listen(current)}>
              <Icon name={playingId === current.id ? "stop" : "play"} size={16} />
              {playingId === current.id ? "Durdur" : "Dinle"}
            </Button>
          )}
        </div>
      </section>

      <div className="voice-gallery-head">
        <h3>Sesi değiştir</h3>
        <Segmented
          label="Ses cinsiyeti"
          value={gender}
          onChange={setGender}
          options={[{ value: "all", label: "Tümü" }, { value: "female", label: "Kadın" }, { value: "male", label: "Erkek" }]}
        />
      </div>

      <div className="voice-grid" role="list" aria-label="Asistan sesleri">
        {voices.map((v) => {
          const selected = v.id === selectedId;
          const playing = playingId === v.id;
          return (
            <article key={v.id} role="listitem" className={`voice-card${selected ? " is-selected" : ""}${playing ? " is-playing" : ""}`}>
              {kebab(v)}
              <button type="button" className="voice-card-orb" onClick={() => listen(v)} disabled={!v.previewUrl} aria-label={`${v.name} sesini ${playing ? "durdur" : "dinle"}`}>
                <VoiceOrb id={v.id} hue={hueOf(v.id)} size={92} active={playing} />
              </button>
              <div className="voice-card-info">
                <strong>{v.name}</strong>
                <span className="muted small">{detail(v) || "Türkçe ses"}</span>
              </div>
              <div className="voice-card-actions">
                {v.previewUrl && (
                  <button type="button" className="voice-listen" onClick={() => listen(v)} aria-label={`${v.name} sesini ${playing ? "durdur" : "dinle"}`}>
                    <Icon name={playing ? "stop" : "play"} size={16} />
                    <span>{playing ? "Durdur" : "Dinle"}</span>
                  </button>
                )}
                {selected ? (
                  <span className="voice-choose is-on"><Icon name="check" size={16} /> Seçili</span>
                ) : (
                  <button type="button" className="voice-choose" onClick={() => onApply({ voiceId: v.id, name: agent.name, greeting: agent.greeting })}>Seç</button>
                )}
              </div>
            </article>
          );
        })}
        {!voices.length && <p className="muted small">Bu seçimde ses yok.</p>}
      </div>
      <p className="muted small">Ses değişikliği "Yayınla" dediğinizde asistana uygulanır. Dinlediğiniz örnek, her sesin aynı cümleyi okuduğu hazır bir kayıttır.</p>

      <VoiceEditModal
        voice={editingVoice}
        selected={editingVoice?.id === selectedId}
        agent={agent}
        defaultGreeting={defaultGreeting}
        firma={firma}
        nameError={nameError}
        onClose={() => setEditing(null)}
        onConfirm={(a) => {
          onApply(a);
          setEditing(null);
        }}
      />
    </div>
  );
}

/** Seçilen ses için asistan adı, karşılama cümlesi ve canlı önizleme; "Onayla" sesi bu bilgilerle seçer */
function VoiceEditModal({ voice, selected, agent, defaultGreeting, firma, nameError, onClose, onConfirm }: {
  voice: VoiceOption | null;
  selected: boolean;
  agent: { name: string; greeting: string };
  defaultGreeting: string;
  firma: string;
  nameError?: string | undefined;
  onClose: () => void;
  onConfirm: (a: AgentIdentity) => void;
}) {
  const [name, setName] = useState(agent.name);
  const [greeting, setGreeting] = useState(agent.greeting);
  const [touched, setTouched] = useState(false);

  // Pencere her açıldığında kayıtlı değerlerle başlar
  useEffect(() => {
    if (voice) {
      setName(agent.name);
      setGreeting(agent.greeting);
      setTouched(false);
    }
  }, [voice?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const nameProblem = !name.trim() ? "Asistanın adını yazın" : name.trim().length > 40 ? "Ad en fazla 40 karakter olabilir" : undefined;
  const confirm = () => {
    setTouched(true);
    if (nameProblem || !voice) return;
    onConfirm({ voiceId: voice.id, name: name.trim(), greeting: greeting.trim() });
  };

  return (
    <Modal
      open={!!voice}
      onClose={onClose}
      size="md"
      title={voice ? `${voice.name} sesi` : "Ses"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Vazgeç</Button>
          <Button onClick={confirm} data-autofocus>{selected ? "Onayla" : "Onayla ve bu sesi seç"}</Button>
        </>
      }
    >
      <Field label="Asistanın adı" hint="Müşterilere bu adla tanışır." error={(touched ? nameProblem : undefined) ?? nameError}>
        {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />}
      </Field>
      <Field label="Karşılama cümlesi" optional hint="Boş bırakırsanız varsayılan kullanılır. {firma} ve {ajan} yerine işletme ve asistan adı yazılır. Yapay zekâ ve kayıt bilgilendirmesi KVKK gereği kalmalıdır.">
        {(id, d) => <Textarea id={id} aria-describedby={d} rows={3} value={greeting} placeholder={defaultGreeting} onChange={(e) => setGreeting(e.target.value)} />}
      </Field>
      <p className="preview"><span>Önizleme</span>{fillTpl(greeting.trim() || defaultGreeting, { firma, ajan: name.trim() || "—" })}</p>
    </Modal>
  );
}
