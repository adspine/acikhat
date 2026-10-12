/**
 * Asistan sesleri: ElevenLabs hesabındaki Türkçe sesler (panelde seçilir, önizleme dinlenir).
 * Liste bir saat bellekte tutulur; ElevenLabs'e ulaşılamazsa eski liste kullanılır.
 */
export interface Voice {
  id: string;
  name: string;
  gender: "female" | "male" | "neutral";
  /** "Genç", "Orta yaş" gibi okunur etiketler */
  tags: string[];
  previewUrl: string | null;
}

export type VoiceCatalog = () => Promise<Voice[]>;

const TTL_MS = 3_600_000;
const STYLE: Record<string, string> = {
  casual: "Samimi", professional: "Profesyonel", confident: "Kendinden emin", cute: "Sevimli", calm: "Sakin",
  warm: "Sıcak", classy: "Zarif", mature: "Olgun", formal: "Resmî", chill: "Rahat",
};
const AGE: Record<string, string> = { young: "Genç", middle_aged: "Orta yaş", old: "Olgun yaş" };

const title = (s: string) =>
  s
    .split(/\s+/)
    .map((w) => w.charAt(0).toLocaleUpperCase("tr") + w.slice(1).toLocaleLowerCase("tr"))
    .join(" ");

type Raw = { voice_id: string; name: string; labels?: Record<string, string>; preview_url?: string | null };

export function createVoiceCatalog(apiKey: string, fetchFn: typeof fetch = fetch): VoiceCatalog {
  let cache: { at: number; voices: Voice[] } | null = null;
  return async () => {
    if (cache && Date.now() - cache.at < TTL_MS) return cache.voices;
    try {
      const res = await fetchFn("https://api.elevenlabs.io/v2/voices?page_size=100", { headers: { "xi-api-key": apiKey }, signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`ElevenLabs ${res.status}`);
      const raw = ((await res.json()) as { voices?: Raw[] }).voices ?? [];
      const voices = raw
        .filter((v) => v.labels?.language === "tr")
        .map((v): Voice => {
          const g = v.labels?.gender;
          return {
            id: v.voice_id,
            // Panelde yalnızca ilk ad gösterilir ("Duygu Eris" → "Duygu"); açıklama eki (" - Genç, samimi") ve soyad atılır
            name: title((v.name.split(/\s+-\s+/)[0] ?? v.name).trim().split(/\s+/)[0] ?? v.name),
            gender: g === "male" ? "male" : g === "female" ? "female" : "neutral",
            tags: [AGE[v.labels?.age ?? ""], STYLE[v.labels?.descriptive ?? ""]].filter((x): x is string => !!x),
            previewUrl: v.preview_url ?? null,
          };
        });
      cache = { at: Date.now(), voices };
      return voices;
    } catch (err) {
      if (cache) return cache.voices;
      throw err;
    }
  };
}
