import type { Tenant } from "../domain/tenant.ts";
import type { MessageChannel } from "./notify.ts";

/**
 * Netgsm SMS (REST v2). Kullanıcı kodu/şifre, SIP bilgilerinden ayrıdır:
 * Netgsm webportal > Alt Kullanıcı / API bilgileri. Başlık (tenant.sms.sender) Netgsm'de onaylı olmalı.
 */
export class NetgsmSmsChannel implements MessageChannel {
  private readonly auth: string;
  private readonly fetchFn: typeof fetch;

  constructor(opts: { username: string; password: string }, fetchFn: typeof fetch = fetch) {
    this.auth = `Basic ${Buffer.from(`${opts.username}:${opts.password}`).toString("base64")}`;
    this.fetchFn = fetchFn;
  }

  async send(to: string, text: string, tenant: Tenant) {
    if (!tenant.sms) throw new Error("SMS başlığı tanımlı değil");
    const res = await this.fetchFn("https://api.netgsm.com.tr/sms/rest/v2/send", {
      method: "POST",
      headers: { authorization: this.auth, "content-type": "application/json" },
      body: JSON.stringify({
        msgheader: tenant.sms.sender,
        // Netgsm numarayı başında 0/+90 olmadan, 10 haneli bekler
        messages: [{ msg: text, no: to.replace(/^\+90/, "") }],
        encoding: "TR",
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => ({}))) as { code?: string; description?: string };
    // "00" kuyruğa alındı; diğer kodlar hata (ör. 30 yetkisiz, 40 başlık tanımsız)
    if (!res.ok || json.code !== "00") {
      throw new Error(`Netgsm SMS gönderilemedi (${res.status}, kod ${json.code ?? "?"}): ${json.description ?? ""}`);
    }
  }
}
