import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type VoiceOption } from "../api.ts";
import { ErrorBox, Icon, Loading, Segmented } from "./ui.tsx";

/** Asistanın sesini seçtirir: cinsiyete göre süzer, önizleme dinletir. */
export function VoicePicker({ value, onChange }: { value: string | undefined; onChange: (id: string) => void }) {
  const q = useQuery({ queryKey: ["voices"], queryFn: () => api<{ voices: VoiceOption[]; enabled: boolean; defaultId: string }>("/voices"), staleTime: 3_600_000, retry: false });
  const [gender, setGender] = useState<"all" | "female" | "male">("all");
  const [playing, setPlaying] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => () => audio.current?.pause(), []);

  if (q.isLoading) return <Loading label="Sesler yükleniyor" />;
  if (q.error) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data?.enabled || !q.data.voices.length) return <p className="muted small">Ses seçimi şu an kullanılamıyor. Asistanınız varsayılan sesle konuşur.</p>;

  const selected = value ?? q.data.defaultId;
  const voices = q.data.voices.filter((v) => gender === "all" || v.gender === gender);

  const preview = (v: VoiceOption) => {
    if (!v.previewUrl) return;
    audio.current?.pause();
    if (playing === v.id) return setPlaying(null);
    const a = new Audio(v.previewUrl);
    audio.current = a;
    setPlaying(v.id);
    a.addEventListener("ended", () => setPlaying((p) => (p === v.id ? null : p)));
    void a.play().catch(() => setPlaying(null));
  };

  return (
    <div className="voices">
      <Segmented
        label="Ses cinsiyeti"
        value={gender}
        onChange={setGender}
        options={[{ value: "all", label: "Tümü" }, { value: "female", label: "Kadın" }, { value: "male", label: "Erkek" }]}
      />
      <div className="voice-grid" role="radiogroup" aria-label="Asistan sesi">
        {voices.map((v) => (
          <div key={v.id} className={`voice${selected === v.id ? " is-selected" : ""}`}>
            <button type="button" role="radio" aria-checked={selected === v.id} className="voice-pick" onClick={() => onChange(v.id)}>
              <strong>{v.name}</strong>
              <span className="muted small">{[v.gender === "female" ? "Kadın" : v.gender === "male" ? "Erkek" : "", ...v.tags].filter(Boolean).join(" · ")}</span>
            </button>
            {v.previewUrl && (
              <button type="button" className="voice-play" onClick={() => preview(v)} aria-label={`${v.name} sesini ${playing === v.id ? "durdur" : "dinle"}`}>
                <Icon name={playing === v.id ? "stop" : "play"} size={18} />
              </button>
            )}
          </div>
        ))}
        {!voices.length && <p className="muted small">Bu seçimde ses yok.</p>}
      </div>
      <p className="muted small">Ses değişikliği "Yayınla" dediğinizde asistana uygulanır.</p>
    </div>
  );
}
