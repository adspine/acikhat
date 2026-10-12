/**
 * E-posta gönderimi. Resend (https://resend.com) HTTP API'si kullanılır; ek paket gerekmez.
 * RESEND_API_KEY yoksa e-postalar gönderilmez, konsola yazılır (yerel geliştirme).
 * Gönderen alan adı (acikhat.ai) Resend'de doğrulanmış olmalı.
 */
export interface Mail {
  to: string[];
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

export function createMailer(opts: { apiKey?: string | undefined; from: string; replyTo?: string | undefined; fetchFn?: typeof fetch }): Mailer {
  const doFetch = opts.fetchFn ?? fetch;
  return {
    async send(mail) {
      if (!opts.apiKey) {
        console.info(`[e-posta:gönderilmedi] ${mail.to.join(", ")} · ${mail.subject}`);
        return;
      }
      const res = await doFetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${opts.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ from: opts.from, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html, ...(opts.replyTo && { reply_to: opts.replyTo }) }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
    },
  };
}
