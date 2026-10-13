/**
 * Firma ayarından ElevenLabs ajan yapılandırması üretir. Sunucu (panelde Yayınla) ve
 * terminal script'leri (scripts/build-agent.ts, push-agent.ts) aynı kodu kullanır.
 */
import type { Tenant } from "../domain/tenant.ts";
import { fill, loadVertical } from "../domain/vertical.ts";
import { renderPrompt } from "../domain/prompt.ts";
import { readFileSync } from "node:fs";

/** Konuşma tanıma ipucu: yaygın Türkçe ad ve soyadları (agent/common-names.json) */
const COMMON_NAMES: string[] = (() => {
  const j = JSON.parse(readFileSync(new URL("../../agent/common-names.json", import.meta.url), "utf8")) as { names: string[]; surnames: string[] };
  return [...new Set([...j.names, ...j.surnames])];
})();

/** Ajan yapılandırmasının ortamdan aldığı değerler (ElevenLabs kimlikleri, sunucu adresi) */
export interface AgentEnv {
  baseUrl: string;
  toolSecretId: string;
  voiceId?: string | undefined;
  postCallWebhookId?: string | undefined;
  pronunciationDict?: { id: string; version?: string | undefined } | undefined;
}

export function agentEnvFrom(e: NodeJS.ProcessEnv): AgentEnv {
  if (!e.PUBLIC_BASE_URL || !e.ELEVENLABS_TOOL_SECRET_ID) throw new Error("PUBLIC_BASE_URL ve ELEVENLABS_TOOL_SECRET_ID tanımlı olmalı");
  return {
    baseUrl: e.PUBLIC_BASE_URL,
    toolSecretId: e.ELEVENLABS_TOOL_SECRET_ID,
    voiceId: e.ELEVENLABS_VOICE_ID,
    postCallWebhookId: e.ELEVENLABS_POST_CALL_WEBHOOK_ID,
    pronunciationDict: e.ELEVENLABS_PRONUNCIATION_DICT_ID
      ? { id: e.ELEVENLABS_PRONUNCIATION_DICT_ID, version: e.ELEVENLABS_PRONUNCIATION_DICT_VERSION }
      : undefined,
  };
}

function webhookTool(env: AgentEnv, t: Tenant, name: string, description: string, properties: Record<string, unknown>, required: string[]) {
  return {
    type: "webhook",
    name,
    description,
    response_timeout_secs: 8,
    api_schema: {
      url: `${env.baseUrl}/tools/${t.id}/${name}`,
      method: "POST",
      // ElevenLabs workspace secret'ı, değeri "Bearer <TOOL_SECRET>" (POST /v1/convai/secrets)
      request_headers: { Authorization: { secret_id: env.toolSecretId } },
      request_body_schema: {
        type: "object",
        properties: {
          ...properties,
          conversation_id: { type: "string", dynamic_variable: "system__conversation_id" },
        },
        required,
      },
    },
  };
}

export function buildAgent(t: Tenant, env: AgentEnv) {
  const vertical = loadVertical(t.vertical);
  const serviceIds = t.services.map((s) => s.id);
  return {
    name: `${t.name} – Telefon asistanı`,
    tags: ["resepsiyonist", t.id],
    conversation_config: {
      agent: {
        language: "tr",
        first_message: fill(t.agent.greeting ?? vertical.greeting, { firma: t.name, ajan: t.agent.name }),
        // KVKK bilgilendirmesi kesilmeden duyulsun
        disable_first_message_interruptions: true,
        dynamic_variables: {
          dynamic_variable_placeholders: {
            tenant_id: t.id,
            today: "",
            now_time: "",
            date_table: "",
            caller_phone: "",
            caller_phone_spoken: "bilinmiyor",
          },
        },
        prompt: {
          prompt: renderPrompt(t),
          // 11 Ekim 2026 karşılaştırması (13 senaryo): flash-lite 12/13, flash 11/13, haiku-4-5 10/13
          // (haiku kaydetmeden "randevunuz alındı" dedi). Ayrıntı: build/evals/
          llm: "gemini-3.5-flash-lite",
          // Ana model yanıt vermezse; karşılaştırmada kritik hata yapmayan model
          backup_llm_config: { preference: "override", order: ["gemini-3.5-flash"] },
          temperature: 0.3,
          timezone: t.timezone,
          tools: [
            webhookTool(
              env, t, "check_availability",
              "Bir hizmet için takvimdeki uygun randevu saatlerini getirir. Saat önermeden önce mutlaka çağır.",
              {
                service_id: { type: "string", enum: serviceIds, description: "İstenen hizmetin id'si" },
                date_from: { type: "string", description: "İlk gün, YYYY-MM-DD. Tarih tablosundan al." },
                date_to: { type: "string", description: "Son gün, YYYY-MM-DD. Tek gün isteniyorsa date_from ile aynı." },
                part_of_day: { type: "string", enum: ["sabah", "ogle", "aksam"], description: "Müşteri gün içi tercih belirttiyse" },
                preferred_time: { type: "string", description: "Müşteri belirli bir saat söylediyse HH:MM (24 saat)" },
                staff_id: { type: "string", enum: t.staff.map((s) => s.id), description: `Müşteri belirli bir ${vertical.staffTerm} istediyse` },
                staff_gender: { type: "string", enum: ["kadin", "erkek"], description: `Müşteri kadın/erkek ${vertical.staffTerm} istediyse` },
              },
              ["service_id"],
            ),
            webhookTool(
              env, t, "prepare_confirmation",
              "Randevudan önce son teyit cümlesini hazırlar. Ad soyad ve cep numarası belli olunca çağır; dönen cümleyi müşteriye aynen oku.",
              {
                slot_id: { type: "string", description: "Müşterinin seçtiği seçeneğin slot_id değeri, aynen" },
                customer_name: { type: "string", description: "Müşterinin adı soyadı" },
                customer_phone: { type: "string", description: "Müşterinin cep numarası, rakamlarla" },
              },
              ["slot_id", "customer_name", "customer_phone"],
            ),
            webhookTool(
              env, t, "book_appointment",
              "Müşterinin son teyit cümlesine açıkça onay verdiği randevuyu kaydeder ve onay mesajı gönderir. Önce prepare_confirmation çağrılmış olmalı.",
              {
                slot_id: { type: "string", description: "check_availability'den gelen seçeneğin slot_id değeri, aynen" },
                customer_name: { type: "string", description: "prepare_confirmation cevabındaki customer_name, aynen" },
                customer_phone: { type: "string", description: "prepare_confirmation cevabındaki customer_phone, aynen" },
                confirmation_token: { type: "string", description: "prepare_confirmation cevabındaki confirmation_token, aynen" },
                confirmed_by_caller: { type: "boolean", description: "YALNIZCA müşteri prepare_confirmation'ın verdiği cümleye açıkça evet dediyse true. Başka bir soruya verilen evet sayılmaz." },
              },
              ["slot_id", "customer_name", "customer_phone", "confirmation_token", "confirmed_by_caller"],
            ),
            webhookTool(
              env, t, "log_callback_request",
              "Yetkilinin müşteriyi geri araması için not bırakır (iptal/değişiklik, cevaplanamayan soru, sistem hatası).",
              {
                reason: { type: "string", description: "Talebin kısa özeti" },
                customer_name: { type: "string", description: "Müşterinin adı soyadı, biliniyorsa" },
                customer_phone: { type: "string", description: "Geri aranacak cep numarası, rakamlarla" },
              },
              ["reason"],
            ),
            // Sistem araçları da "tools" içinde olmalı: ElevenLabs aynı istekte tools ile built_in_tools gelirse built_in_tools'u
            // siliyor (13 Ekim: canlı aramada end_call çalışmadı). "type: system" de şart.
            {
              type: "system",
              name: "end_call",
              description: "Müşteri vedalaştığında veya başka isteği olmadığında görüşmeyi bitirir.",
              params: { system_tool_type: "end_call" },
            },
            // Aktarma numarası yoksa araç eklenmez; ajan geri arama notu alır
            ...(t.handoff?.transferNumber
              ? [
                  {
                    type: "system",
                    name: "transfer_to_number",
                    description: "Görüşmeyi işletmedeki bir yetkiliye aktarır.",
                    params: {
                      system_tool_type: "transfer_to_number",
                      transfers: [
                        {
                          transfer_destination: { type: "phone", phone_number: t.handoff.transferNumber },
                          condition: "Şikâyet, öfke, hassas konu, insan/yetkili talebi veya iki kez anlaşılamama durumunda",
                        },
                      ],
                    },
                  },
                ]
              : []),
          ],
        },
      },
      tts: {
        // Duygu Eris - Warm, Encouraging and Soft (Ekim 2026 ses denemesinde seçildi; bildirim süresi 365 gün)
        voice_id: t.agent.voiceId ?? env.voiceId ?? "MzfWWOj9g3sIKex1YFMV",
        model_id: "eleven_v4_turbo",
        // Açıkken model cümlelere [slow]/[fast] etiketleri ekliyor ve konuşma ağırlaşıyordu (test, 12 Ekim)
        expressive_mode: false,
        // agent/pronunciation.json: SMS → "esemes", TL → "lira"
        ...(env.pronunciationDict && {
          pronunciation_dictionary_locators: [
            { pronunciation_dictionary_id: env.pronunciationDict.id, version_id: env.pronunciationDict.version },
          ],
        }),
      },
      asr: {
        // Firmaya özel sözcükler önce gelir; ardından yaygın ad ve soyadlar (telefonda isim yanlış duyulmasın)
        keywords: [...new Set([t.name, ...t.services.flatMap((s) => [s.name.split(" (")[0]!, ...s.aliases]), ...t.staff.map((s) => s.name), ...vertical.asrKeywords, ...COMMON_NAMES])],
      },
      turn: {
        // "patient" her tura gecikme ekliyordu ("Onaylıyorum" sonrası 6 sn, 12 Ekim). Soyadı kesilmesine karşı
        // sabırlı bekleme yalnızca isim/numara söylenirken: spelling_patience.
        turn_eagerness: "normal",
        spelling_patience: "auto",
        silence_end_call_timeout: 20,
        soft_timeout_config: { timeout_seconds: 2, message: "Hemen bakıyorum." },
      },
      conversation: {
        // Dakika yakan çağrılara üst sınır (pilotta gerçek dağılıma göre ayarlanacak)
        max_duration_seconds: 420,
      },
    },
    platform_settings: {
      // Telefon (SIP) aramalarında arama başında bizim init webhook'umuz çağrılır:
      // tarih tablosu ve arayan numarası buradan gelir. Tarayıcı testinde sayfa bunu kendisi verir.
      // Yönetici "Asistanı dene" sayfası başka sesleri asistanı değiştirmeden denemek için ses geçersiz kılar
      // Landing test görüşmesi (src/agent/demo-call.ts) arama başına karşılama, süre sınırı ve süre dolunca söylenecek cümleyi geçersiz kılar
      overrides: {
        enable_conversation_initiation_client_data_from_webhook: true,
        conversation_config_override: {
          tts: { voice_id: true },
          agent: { first_message: true, max_conversation_duration_message: true },
          conversation: { max_duration_seconds: true },
        },
      },
      workspace_overrides: {
        conversation_initiation_client_data_webhook: {
          url: `${env.baseUrl}/webhooks/elevenlabs/init`,
          request_headers: { Authorization: { secret_id: env.toolSecretId } },
        },
        // Görüşme sonu kaydı ve kurulamayan çağrılar (scripts/setup-webhooks.ts ile oluşturulur)
        ...(env.postCallWebhookId && {
          webhooks: {
            post_call_webhook_id: env.postCallWebhookId,
            events: ["transcript", "call_initiation_failure"],
            transcript_format: "json",
          },
        }),
      },
      summary_language: "tr",
      call_limits: { agent_concurrency_limit: t.calls.maxConcurrent, bursting_enabled: false },
      // Hat dolunca arayan reddedilmez, bekleme anonsu dinler (anons: scripts/hold-audio.ts)
      queueing_config: { enabled: t.calls.queueWaitSeconds > 0, wait_timeout_seconds: Math.max(1, t.calls.queueWaitSeconds) },
      // Transkript maskeleme (conversation_history_redaction) yalnızca Enterprise planda var (Ekim 2026).
      guardrails: {
        version: "1",
        focus: { is_enabled: true },
        // Yerleşik prompt_injection tetiklenince görüşmeyi tek kelime söylemeden kapatıyor ve
        // bu davranış ayarlanamıyor (yalnızca is_enabled var). "retry" seçenekli özel koruma ise yalnızca
        // blocking modda çalışıyor ve her tura gecikme ekliyor. Saldırıya prompt kuralı + focus koruması yetiyor
        // (eval senaryosu 06 ile doğrulanır).
        prompt_injection: { is_enabled: false },
        content: {
          config: {
            medical_and_legal_information: { is_enabled: true, threshold: 0.5 },
            harassment: { is_enabled: true, threshold: 0.5 },
          },
        },
      },
    },
  };
}

