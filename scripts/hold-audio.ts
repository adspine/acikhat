/**
 * Hat doluyken kuyrukta bekleyen arayana çalınacak anonsu firmanın ajan sesiyle üretip yükler.
 *   node --env-file=.env scripts/hold-audio.ts <tenant-id>
 * Anons döngüyle çalındığı için sonuna sessizlik eklenir (her ~20 sn'de bir duyulur).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { TenantRegistry } from "../src/store/tenants.ts";
import { fill, loadVertical } from "../src/domain/vertical.ts";

const SAMPLE_RATE = 16_000;
const SILENCE_SECS = 12;

const key = process.env.ELEVENLABS_API_KEY;
if (!key) throw new Error("ELEVENLABS_API_KEY eksik");
const tenantId = process.argv[2];
const tenant = tenantId ? TenantRegistry.fromDir("tenants").get(tenantId) : undefined;
if (!tenant?.agentIds[0]) throw new Error("Kullanım: node --env-file=.env scripts/hold-audio.ts <tenant-id> (agentIds dolu olmalı)");

const text = fill(loadVertical(tenant.vertical).holdMessage, { firma: tenant.name });
const voiceId = tenant.agent.voiceId ?? process.env.ELEVENLABS_VOICE_ID;
if (!voiceId) throw new Error("Ses tanımlı değil (tenant.agent.voiceId veya ELEVENLABS_VOICE_ID)");

const dict = process.env.ELEVENLABS_PRONUNCIATION_DICT_ID;
const tts = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=pcm_${SAMPLE_RATE}`, {
  method: "POST",
  headers: { "xi-api-key": key, "content-type": "application/json" },
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
if (!tts.ok) throw new Error(`Seslendirme başarısız: ${tts.status} ${await tts.text()}`);
const speech = Buffer.from(await tts.arrayBuffer()); // 16-bit mono PCM

const pcm = Buffer.concat([speech, Buffer.alloc(SAMPLE_RATE * 2 * SILENCE_SECS)]);
const header = Buffer.alloc(44);
header.write("RIFF", 0);
header.writeUInt32LE(36 + pcm.length, 4);
header.write("WAVEfmt ", 8);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20); // PCM
header.writeUInt16LE(1, 22); // mono
header.writeUInt32LE(SAMPLE_RATE, 24);
header.writeUInt32LE(SAMPLE_RATE * 2, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write("data", 36);
header.writeUInt32LE(pcm.length, 40);
const wav = Buffer.concat([header, pcm]);

mkdirSync("build/hold-audio", { recursive: true });
const file = `build/hold-audio/${tenant.id}.wav`;
writeFileSync(file, wav);

const form = new FormData();
form.append("hold_audio_file", new Blob([wav], { type: "audio/wav" }), `${tenant.id}-bekleme.wav`);
const up = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${tenant.agentIds[0]}/hold-audio`, {
  method: "POST",
  headers: { "xi-api-key": key },
  body: form,
});
if (!up.ok) throw new Error(`Yükleme başarısız: ${up.status} ${await up.text()}`);
console.info(`Bekleme anonsu yüklendi (${(speech.length / 2 / SAMPLE_RATE).toFixed(1)} sn konuşma + ${SILENCE_SECS} sn sessizlik): "${text}"\nDinlemek için: ${file}`);
