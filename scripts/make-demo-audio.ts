/**
 * Web sitesindeki örnek görüşmeyi üretir: ajan (Duygu) ve arayan (Ozan) sesleri,
 * araya doğal boşluklar koyarak tek dosyada birleştirilir; satır zamanlamaları JSON'a yazılır.
 *   node --env-file=.env scripts/make-demo-audio.ts
 * Çıktı: web/audio/demo.wav (+ macOS'ta demo.m4a) ve web/audio/demo.json
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

const SAMPLE_RATE = 16_000;
const AGENT = process.env.ELEVENLABS_VOICE_ID ?? "MzfWWOj9g3sIKex1YFMV"; // Duygu
const CALLER = "5nr6ATQepuidiLb6OT3B"; // Ozan Karaca

const script: { who: "agent" | "caller"; text: string }[] = [
  { who: "agent", text: "Lavanta Spa, merhaba. Ben yapay zekâ asistanı Defne. Size nasıl yardımcı olabilirim?" },
  { who: "caller", text: "Merhaba, yarın akşam için masaj randevusu almak istiyorum." },
  { who: "agent", text: "Yarın akşam saat 18 ya da 19 uygun görünüyor. Hangisini tercih edersiniz?" },
  { who: "caller", text: "18 olsun." },
  { who: "agent", text: "Adınızı ve soyadınızı alabilir miyim?" },
  { who: "caller", text: "Kerem Aydın." },
  { who: "agent", text: "Yarın, saat 18, klasik masaj, Kerem Aydın adına. Onay mesajı numaranıza gelecek. Onaylıyor musunuz?" },
  { who: "caller", text: "Evet, onaylıyorum." },
  { who: "agent", text: "Randevunuz alındı. Görüşmek üzere, iyi günler dilerim." },
];

const key = process.env.ELEVENLABS_API_KEY;
if (!key) throw new Error("ELEVENLABS_API_KEY eksik");
const dict = process.env.ELEVENLABS_PRONUNCIATION_DICT_ID;

async function speak(voice: string, text: string): Promise<Buffer> {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=pcm_${SAMPLE_RATE}`, {
    method: "POST",
    headers: { "xi-api-key": key!, "content-type": "application/json" },
    body: JSON.stringify({
      text,
      model_id: "eleven_v4_turbo",
      language_code: "tr",
      ...(dict && {
        pronunciation_dictionary_locators: [
          { pronunciation_dictionary_id: dict, version_id: process.env.ELEVENLABS_PRONUNCIATION_DICT_VERSION },
        ],
      }),
    }),
  });
  if (!res.ok) throw new Error(`TTS ${res.status}: ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}

const silence = (secs: number) => Buffer.alloc(Math.round(SAMPLE_RATE * secs) * 2);
const parts: Buffer[] = [silence(0.4)];
const lines: { who: string; text: string; start: number; end: number }[] = [];
let t = 0.4;
for (const line of script) {
  const pcm = await speak(line.who === "agent" ? AGENT : CALLER, line.text);
  const dur = pcm.length / 2 / SAMPLE_RATE;
  lines.push({ ...line, start: +t.toFixed(2), end: +(t + dur).toFixed(2) });
  parts.push(pcm, silence(0.55));
  t += dur + 0.55;
}

const pcm = Buffer.concat(parts);
const header = Buffer.alloc(44);
header.write("RIFF", 0);
header.writeUInt32LE(36 + pcm.length, 4);
header.write("WAVEfmt ", 8);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(1, 22);
header.writeUInt32LE(SAMPLE_RATE, 24);
header.writeUInt32LE(SAMPLE_RATE * 2, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write("data", 36);
header.writeUInt32LE(pcm.length, 40);

mkdirSync("web/audio", { recursive: true });
writeFileSync("web/audio/demo.wav", Buffer.concat([header, pcm]));
writeFileSync("web/audio/demo.json", JSON.stringify({ duration: +t.toFixed(2), lines }, null, 2));

// Sayfa ağırlığı için AAC'ye çevir (macOS afconvert); yoksa WAV kullanılır
try {
  execFileSync("afconvert", ["-f", "m4af", "-d", "aac", "-b", "32000", "web/audio/demo.wav", "web/audio/demo.m4a"]);
  rmSync("web/audio/demo.wav");
  console.info(`web/audio/demo.m4a hazır (${t.toFixed(1)} sn, ${lines.length} satır)`);
} catch {
  console.info(`web/audio/demo.wav hazır (${t.toFixed(1)} sn); m4a dönüşümü yapılamadı`);
}
