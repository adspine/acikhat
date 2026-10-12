import type { Tenant } from "../domain/tenant.ts";

export type Channel = Tenant["notifications"]["channels"][number];

/** Tek bir mesaj kanalı (SMS, WhatsApp). Ulaşamazsa hata fırlatır. */
export interface MessageChannel {
  send(to: string, text: string, tenant: Tenant): Promise<void>;
}

/** Geliştirme/pilot için: mesajı loglar. Gerçek sağlayıcı adaptörleri sağlayıcı seçilince eklenecek. */
export class ConsoleChannel implements MessageChannel {
  readonly sent: { to: string; text: string; tenantId: string }[] = [];
  private readonly name: Channel;
  constructor(name: Channel) {
    this.name = name;
  }

  async send(to: string, text: string, tenant: Tenant) {
    this.sent.push({ to, text, tenantId: tenant.id });
    console.info(`[${this.name}] ${tenant.id} → ${to}: ${text}`);
  }
}

/** Firmanın kanal sırasını dener: ilki başarısız olursa sıradakine geçer. */
export class Notifier {
  private readonly channels: Partial<Record<Channel, MessageChannel>>;
  constructor(channels: Partial<Record<Channel, MessageChannel>>) {
    this.channels = channels;
  }

  async send(to: string, text: string, tenant: Tenant): Promise<Channel> {
    let lastError: unknown = new Error("Kanal tanımlı değil");
    for (const name of tenant.notifications.channels) {
      const channel = this.channels[name];
      if (!channel) continue;
      try {
        await channel.send(to, text, tenant);
        return name;
      } catch (err) {
        lastError = err;
        console.warn(`[notify] ${name} başarısız, sıradaki kanal deneniyor`, err);
      }
    }
    throw lastError;
  }
}

export function createNotifier(env: NodeJS.ProcessEnv): Notifier {
  const sms = env.SMS_PROVIDER ?? "console";
  const whatsapp = env.WHATSAPP_PROVIDER ?? "console";
  if (sms !== "console") throw new Error(`Bilinmeyen SMS_PROVIDER: ${sms}`);
  if (whatsapp !== "console") throw new Error(`Bilinmeyen WHATSAPP_PROVIDER: ${whatsapp}`);
  return new Notifier({ sms: new ConsoleChannel("sms"), whatsapp: new ConsoleChannel("whatsapp") });
}
