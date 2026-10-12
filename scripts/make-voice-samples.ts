/**
 * Panelde "Asistan sesi" kartlarında çalınan ses örneklerini üretir. Her Türkçe ses aynı metni söyler:
 *   "Açık Hat, merhaba. Ben yapay zekâ asistanı <ses adı>. Size nasıl yardımcı olabilirim?"
 * Örnekler bir kere üretilip web/audio/voices/<ses-kimliği>.mp3 olarak kaydedilir (depoya girer); panel bunları kullanır,
 * böylece her dinlemede ElevenLabs'ten tekrar ücret kesilmez ve müşteriler tek bir tutarlı metinle seçim yapar.
 *
 *   node --env-file=.env scripts/make-voice-samples.ts            # yalnızca eksik olanları üretir
 *   node --env-file=.env scripts/make-voice-samples.ts --force    # hepsini yeniden üretir
 *   node --env-file=.env scripts/make-voice-samples.ts --dry-run  # ne üretileceğini listeler
 * Yeni bir ses eklenirse ya da metin değişirse yeniden çalıştırıp çıkan dosyaları commitleyin.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createVoiceCatalog } from "../src/integrations/voices.ts";

const OUT = new URL("../web/audio/voices/", import.meta.url);
const force = process.argv.includes("--force");
const dry = process.argv.includes("--dry-run");

const key = process.env.ELEVENLABS_API_KEY;
if (!key) throw new Error("ELEVENLABS_API_KEY eksik");
const dict = process.env.ELEVENLABS_PRONUNCIATION_DICT_ID;

/** Ses adından örnek metin: ad tek kelimelik ilk addır ("Duygu Eris" → "Duygu") */
export const sampleText = (name: string) => `Açık Hat, merhaba. Ben yapay zekâ asistanı ${name.split(" ")[0]}. Size nasıl yardımcı olabilirim?`;

async function speak(voiceId: string, text: string): Promise<Buffer> {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": key!, "content-type": "application/json" },
    body: JSON.stringify({
      text,
      model_id: "eleven_v4_turbo",
      language_code: "tr",
      ...(dict && { pronunciation_dictionary_locators: [{ pronunciation_dictionary_id: dict, version_id: process.env.ELEVENLABS_PRONUNCIATION_DICT_VERSION }] }),
    }),
  });
  if (!res.ok) throw new Error(`TTS ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return Buffer.from(await res.arrayBuffer());
}

mkdirSync(OUT, { recursive: true });
const voices = await createVoiceCatalog(key)();
console.info(`${voices.length} Türkçe ses bulundu.`);
let made = 0;
for (const v of voices) {
  const file = new URL(`${v.id}.mp3`, OUT);
  if (!force && existsSync(file)) {
    console.info(`  = ${v.name}: örnek zaten var`);
    continue;
  }
  const text = sampleText(v.name);
  if (dry) {
    console.info(`  + ${v.name}: "${text}"`);
    continue;
  }
  writeFileSync(file, await speak(v.id, text));
  made++;
  console.info(`  ✓ ${v.name}: üretildi`);
}
console.info(dry ? "Deneme bitti, hiçbir şey üretilmedi." : `Bitti: ${made} yeni örnek.`);
