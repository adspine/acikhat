import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type VoiceOption } from "../api.ts";
import { Button, ErrorBox, Icon, Loading, Segmented } from "./ui.tsx";
import { HUES, VoiceOrb } from "./VoiceOrb.tsx";
import { useVoicePlayer } from "./voice-player.ts";

const detail = (v: VoiceOption) => [v.gender === "female" ? "Kadın" : v.gender === "male" ? "Erkek" : "", ...v.tags].filter(Boolean).join(" · ");

/**
 * Asistan sesi galerisi. Üstte seçili ses büyük bir küre olarak durur; altında her ses kendi küresiyle bir kart.
 * Kartlardaki "Dinle" tüm seslerde aynı örnek cümleyi çalar, küre konuşurken canlanır. "Seç" sesi taslağa yazar
 * (asistana "Yayınla" ile uygulanır).
 */
export function VoicePicker({ value, onChange, assistantName }: { value: string | undefined; onChange: (id: string) => void; assistantName: string }) {
  const q = useQuery({ queryKey: ["voices"], queryFn: () => api<{ voices: VoiceOption[]; enabled: boolean; defaultId: string }>("/voices"), staleTime: 3_600_000, retry: false });
  const [gender, setGender] = useState<"all" | "female" | "male">("all");
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
  const listen = (v: VoiceOption) => v.previewUrl && void play(v.id, v.previewUrl);

  return (
    <div className="voices" ref={root}>
      <section className={`voice-hero${playingId === current.id ? " is-playing" : ""}`} aria-label="Seçili ses">
        <button type="button" className="voice-hero-orb" onClick={() => listen(current)} disabled={!current.previewUrl} aria-label={`${current.name} sesini ${playingId === current.id ? "durdur" : "dinle"}`}>
          <VoiceOrb id={current.id} hue={hueOf(current.id)} size={148} active={playingId === current.id} />
        </button>
        <div className="voice-hero-text">
          <p className="voice-hero-label">Asistanınızın sesi</p>
          <h3 className="voice-hero-name">{current.name}</h3>
          <p className="muted">{detail(current) || "Türkçe ses"}</p>
          <p className="voice-hero-line">“Açık Hat, merhaba. Ben yapay zekâ asistanı {current.name.split(" ")[0]}…” <span className="muted small">{assistantName ? `Müşterilerinize ${assistantName} adıyla tanışır.` : ""}</span></p>
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

      <div className="voice-grid" role="radiogroup" aria-label="Asistan sesi">
        {voices.map((v) => {
          const selected = v.id === selectedId;
          const playing = playingId === v.id;
          return (
            <article key={v.id} className={`voice-card${selected ? " is-selected" : ""}${playing ? " is-playing" : ""}`}>
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
                <button type="button" role="radio" aria-checked={selected} className={`voice-choose${selected ? " is-on" : ""}`} onClick={() => onChange(v.id)} disabled={selected}>
                  {selected ? <><Icon name="check" size={16} /> Seçili</> : "Seç"}
                </button>
              </div>
            </article>
          );
        })}
        {!voices.length && <p className="muted small">Bu seçimde ses yok.</p>}
      </div>
      <p className="muted small">Ses değişikliği "Yayınla" dediğinizde asistana uygulanır. Dinlediğiniz örnek, her sesin aynı cümleyi okuduğu hazır bir kayıttır.</p>
    </div>
  );
}
