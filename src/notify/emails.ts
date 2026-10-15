import { spokenPhone } from "../domain/phone.ts";
import type { Deps } from "../http/deps.ts";
import type { Tenant } from "../domain/tenant.ts";
import { PLANS, type PlanId } from "../domain/plans.ts";

/**
 * Sistem e-postaları: yönetici bildirimleri ve müşteri bilgilendirmeleri.
 * Hepsi "gönder ve unut"tur: gönderim hatası asıl işlemi (ödeme, başvuru vb.) asla bozmaz.
 * Kullanıcıdan gelen metinler HTML'e escape edilerek konur.
 */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const usd = (n: number) => `$${new Intl.NumberFormat("tr-TR", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }).format(n)}`;

interface Body {
  title: string;
  /** Paragraflar (düz metin; HTML'e escape edilir) */
  lines: string[];
  /** Tablo gibi gösterilen ayrıntılar */
  facts?: [string, string][];
  cta?: { label: string; url: string } | undefined;
}

function render(b: Body): { text: string; html: string } {
  const text = [b.title, "", ...b.lines, ...(b.facts ?? []).map(([k, v]) => `${k}: ${v}`), ...(b.cta ? ["", `${b.cta.label}: ${b.cta.url}`] : []), "", "Açık Hat · support@acikhat.si"].join("\n");
  const html = `<!doctype html><html lang="tr"><body style="margin:0;background:#f1f4f3;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1c2b27">
<div style="max-width:560px;margin:0 auto;padding:28px 16px">
<p style="margin:0 0 14px;font-weight:700;font-size:15px;color:#14463f">● Açık Hat</p>
<div style="background:#fff;border-radius:14px;padding:26px 24px;border:1px solid #e1e7e5">
<h1 style="margin:0 0 14px;font-size:20px;line-height:1.3">${esc(b.title)}</h1>
${b.lines.map((l) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.55">${esc(l)}</p>`).join("\n")}
${b.facts?.length ? `<table role="presentation" style="width:100%;border-collapse:collapse;margin:6px 0 14px;font-size:14px">${b.facts.map(([k, v]) => `<tr><td style="padding:7px 0;border-top:1px solid #edf1ef;color:#5d6f69;width:42%">${esc(k)}</td><td style="padding:7px 0;border-top:1px solid #edf1ef">${esc(v)}</td></tr>`).join("")}</table>` : ""}
${b.cta ? `<p style="margin:18px 0 4px"><a href="${esc(b.cta.url)}" style="display:inline-block;background:#1e5f6b;color:#fff;text-decoration:none;padding:11px 20px;border-radius:10px;font-weight:600;font-size:14px">${esc(b.cta.label)}</a></p>` : ""}
</div>
<p style="margin:14px 4px 0;font-size:12px;color:#7a8b85">Bu e-posta Açık Hat hesabınızla ilgili bir bildirimdir. Sorularınız için support@acikhat.si adresine yazabilirsiniz.</p>
</div></body></html>`;
  return { text, html };
}

function send(deps: Deps, to: string[], subject: string, body: Body) {
  const list = [...new Set(to.map((x) => x.trim()).filter(Boolean))];
  if (!deps.mailer || !list.length) return;
  const { text, html } = render(body);
  // senkron başlatılır, sonucu beklenmez; hata yalnızca günlüğe yazılır
  deps.mailer.send({ to: list, subject, text, html }).catch((err: Error) => console.error(`[e-posta] gönderilemedi (${subject}): ${err.message}`));
}

const panelUrl = (deps: Deps, path = "") => `${deps.baseUrl ?? ""}/panel/${path}`;
/** Test modu: yalnızca gerçek ödeme sağlayıcısı (Polar) yokken ücretsiz test. Polar sandbox'ta da kart çekilmez ama o ayrı bir ortamdır */
const isFreeTest = (deps: Deps) => !deps.polar && !!deps.paymentTestMode;
const testTag = (deps: Deps) => (isFreeTest(deps) ? "[TEST] " : "");

/** Firmanın sahip hesaplarının e-postaları */
export function ownerEmails(deps: Deps, tenantId: string, opts: { onlyOptedIn?: boolean } = {}): string[] {
  const sql = `SELECT email FROM users WHERE tenant_id = ? AND role = 'owner' AND disabled = 0${opts.onlyOptedIn ? " AND notify_email = 1" : ""}`;
  return (deps.store.db.prepare(sql).all(tenantId) as { email: string }[]).map((r) => r.email);
}
const admins = (deps: Deps) => deps.adminEmails ?? [];

/* ---------------- kurulum yolculuğu ---------------- */

export function mailMembershipPaid(deps: Deps, user: { name: string; email: string }, plan: PlanId) {
  const p = PLANS[plan];
  send(deps, [user.email], `${testTag(deps)}Ödemeniz alındı: ${p.name} paketi`, {
    title: "Ödemeniz alındı, teşekkürler",
    lines: [`${user.name ? user.name + ", " : ""}${p.name} paketiniz için ödemeniz alındı. Sıradaki adım kurulum formu: işletmenizi anlatın, asistanınızı sizin için hazırlayalım.`, ...(isFreeTest(deps) ? ["Not: Sistem şu an test modunda; bu işlemde ücret alınmadı."] : [])],
    facts: [["Paket", p.name], ["Tutar", `${usd(p.priceUsd)} / ay (KDV dahil)`], ["Dahil yapay zekâ kullanımı", `${p.minutes} dk`]],
    cta: { label: "Kurulumu sürdür", url: `${deps.baseUrl ?? ""}/#/hesap` },
  });
  send(deps, admins(deps), `${testTag(deps)}Yeni üyelik ödemesi: ${p.name} (${user.email})`, {
    title: "Yeni üyelik ödemesi",
    lines: ["Bir üye paketini ödedi ve kurulum formunu dolduracak."],
    facts: [["Üye", `${user.name} <${user.email}>`], ["Paket", p.name], ["Tutar", usd(p.priceUsd)]],
  });
}

export function mailSubmission(deps: Deps, s: { reference: string; businessName: string; person: string; phone: string; sector: string; memberEmail: string | null; contactEmail: string | undefined; plan: PlanId | null }) {
  send(deps, admins(deps), `Yeni başvuru: ${s.businessName}`, {
    title: "Yeni kurulum başvurusu",
    lines: ["Bir işletme kurulum formunu gönderdi. Panelden inceleyip onaylayabilirsiniz."],
    facts: [["İşletme", s.businessName], ["Sektör", s.sector], ["Yetkili", `${s.person}, ${s.phone}`], ["Üye", s.memberEmail ?? "Üyesiz başvuru"], ["Paket", s.plan ? PLANS[s.plan].name : "—"], ["Başvuru no", s.reference]],
    cta: { label: "Başvuruları aç", url: panelUrl(deps, "basvurular") },
  });
  send(deps, [s.memberEmail ?? "", s.contactEmail ?? ""], "Başvurunuzu aldık", {
    title: "Başvurunuz bize ulaştı",
    lines: [`${s.person}, ${s.businessName} için kurulum bilgilerinizi aldık. Ekibimiz bilgileri inceleyip asistanınızı hazırlayacak; hazır olduğunda size e-posta ile haber vereceğiz.`, "Eksik ya da belirsiz bir nokta olursa sizi arayarak tamamlarız."],
    facts: [["Başvuru no", s.reference]],
  });
}

export function mailTenantReady(deps: Deps, tenant: Tenant) {
  send(deps, ownerEmails(deps, tenant.id), `${tenant.name} panelinize erişebilirsiniz`, {
    title: "Firmanız oluşturuldu",
    lines: [`${tenant.name} için başvurunuz onaylandı ve panelinizi açtık. Randevuları, çağrıları ve kullanımınızı panelden takip edebilir, asistanın ayarlarını düzenleyebilirsiniz.`, "Numaranızı asistana bağlıyor ve son ayarları tamamlıyoruz; numara bağlanınca ayrıca haber vereceğiz."],
    cta: { label: "Panele git", url: panelUrl(deps) },
  });
}

/* ---------------- satın alma ve paket ---------------- */

export function mailPurchase(deps: Deps, tenant: Tenant, o: { label: string; amountUsd: number; kind: "plan" | "addon"; minutes: number }) {
  send(deps, ownerEmails(deps, tenant.id), `${testTag(deps)}Satın alma onayı: ${o.label}`, {
    title: "Satın alımınız tamamlandı",
    lines: [o.kind === "addon" ? `${o.minutes} dakikalık ek paket kotanıza eklendi ve hemen kullanılabilir. Yalnızca bu dönem geçerlidir.` : "Paketiniz hemen güncellendi.", ...(isFreeTest(deps) ? ["Not: Sistem şu an test modunda; bu işlemde ücret alınmadı."] : [])],
    facts: [["Ürün", o.label], ["Tutar", `${usd(o.amountUsd)} (KDV dahil)`]],
    cta: { label: "Paketim", url: panelUrl(deps, "paketim") },
  });
  send(deps, admins(deps), `${testTag(deps)}Panelden satış: ${tenant.name} · ${o.label}`, {
    title: "Panelden yeni satış",
    lines: [`${tenant.name} panelden satın alma yaptı.`],
    facts: [["Ürün", o.label], ["Tutar", usd(o.amountUsd)]],
  });
}

export function mailPlanScheduled(deps: Deps, tenant: Tenant, targetPlan: PlanId, effectiveText: string) {
  send(deps, ownerEmails(deps, tenant.id, { onlyOptedIn: true }), "Paket değişikliğiniz planlandı", {
    title: "Paketiniz dönem sonunda değişecek",
    lines: [`${effectiveText} tarihinde paketiniz ${PLANS[targetPlan].name} olacak ve o tarihten itibaren ${usd(PLANS[targetPlan].priceUsd)} / ay (KDV dahil) faturalandırılacak. O tarihe kadar mevcut kotanızı kullanmaya devam edersiniz.`, "Fikrinizi değiştirirseniz Paketim sayfasından geçişi iptal edebilirsiniz."],
    cta: { label: "Paketim", url: panelUrl(deps, "paketim") },
  });
}

export function mailPlanApplied(deps: Deps, tenant: Tenant, plan: PlanId) {
  send(deps, ownerEmails(deps, tenant.id, { onlyOptedIn: true }), `Paketiniz ${PLANS[plan].name} oldu`, {
    title: "Yeni dönem, yeni paket",
    lines: [`Planladığınız geçiş yapıldı: paketiniz artık ${PLANS[plan].name}. Bu ayın kotası ${PLANS[plan].minutes} dakika.`],
    cta: { label: "Paketim", url: panelUrl(deps, "paketim") },
  });
}

export function mailQuota(deps: Deps, tenant: Tenant, level: "80" | "100", used: number, quota: number) {
  const full = level === "100";
  send(deps, ownerEmails(deps, tenant.id, { onlyOptedIn: true }), full ? "Aylık kotanız doldu" : "Aylık kotanızın %80'ini kullandınız", {
    title: full ? "Kotanız doldu" : "Kotanız dolmak üzere",
    lines: [full
      ? "Bu ayki dakika kotanızı doldurdunuz. Asistanınız aramaları karşılamaya devam eder; kotadan sonraki her dakika ek ücretle hesaplanır. Ek dakika paketi alarak ya da bir üst pakete geçerek aşım ücretinden kaçınabilirsiniz."
      : "Bu ayki dakika kotanızın %80'ini kullandınız. İhtiyaç olursa ek dakika paketi alabilir ya da bir üst pakete geçebilirsiniz."],
    facts: [["Kullanılan", `${used} dk`], ["Kota", `${quota} dk`]],
    cta: { label: "Ek paket al", url: panelUrl(deps, "paketim") },
  });
}

export function mailSuspension(deps: Deps, tenant: Tenant, suspended: boolean) {
  send(deps, ownerEmails(deps, tenant.id), suspended ? "Hizmetiniz askıya alındı" : "Hizmetiniz yeniden açıldı", {
    title: suspended ? "Hizmetiniz askıya alındı" : "Hizmetiniz yeniden açıldı",
    lines: [suspended
      ? `${tenant.name} için asistan hizmeti askıya alındı; gelen aramalar şu an karşılanmıyor. Ayrıntı ve çözüm için bizimle iletişime geçin.`
      : `${tenant.name} için asistan hizmeti yeniden açıldı; gelen aramalar karşılanıyor.`],
  });
}

/** Abonelik sorunu (iptal, ödeme alınamadı): yöneticiye haber verir; hizmeti kendiliğinden kapatmayız, karar yöneticinindir */
export function mailSubscriptionIssue(deps: Deps, o: { event: string; who: string; detail: string }) {
  send(deps, admins(deps), `Abonelik uyarısı: ${o.event} (${o.who})`, {
    title: "Abonelikte dikkat gerektiren durum",
    lines: ["Polar'dan bir abonelik olayı geldi. Hizmet kendiliğinden askıya alınmadı; gerekirse yönetim panelinden askıya alabilirsiniz."],
    facts: [["Olay", o.event], ["Müşteri", o.who], ["Ayrıntı", o.detail]],
  });
}

/* ---------------- abonelik yaşam döngüsü ---------------- */

export function mailRenewal(deps: Deps, tenant: Tenant, o: { amountUsd: number; planName: string }) {
  send(deps, ownerEmails(deps, tenant.id), `Aylık ödemeniz alındı: ${o.planName}`, {
    title: "Aylık ödemeniz alındı, teşekkürler",
    lines: [`${tenant.name} için ${o.planName} paketinizin bu ayki ödemesi alındı. Asistanınız kesintisiz çalışmaya devam ediyor.`],
    facts: [["Paket", o.planName], ["Tutar", `${usd(o.amountUsd)} (KDV dahil)`]],
    cta: { label: "Paketim", url: panelUrl(deps, "paketim") },
  });
}

export function mailPaymentFailed(deps: Deps, tenant: Tenant) {
  send(deps, ownerEmails(deps, tenant.id), "Ödemeniz alınamadı: kartınızı kontrol edin", {
    title: "Aylık ödemeniz alınamadı",
    lines: [`${tenant.name} için paket ödemesi kartınızdan çekilemedi. Ödeme sistemi birkaç gün içinde yeniden deneyecek. Kartınızı güncellemezseniz hizmetiniz askıya alınır ve asistan aramaları karşılamaz.`, "Paketim sayfasındaki \"Aboneliği yönet\" düğmesinden kart bilgilerinizi güncelleyebilirsiniz."],
    cta: { label: "Aboneliği yönet", url: panelUrl(deps, "paketim") },
  });
}

export function mailSubscriptionCanceled(deps: Deps, tenant: Tenant, endText: string | null) {
  send(deps, ownerEmails(deps, tenant.id), "Aboneliğiniz iptal edildi", {
    title: "Aboneliğiniz iptal edildi",
    lines: [endText ? `${tenant.name} aboneliğiniz ${endText} tarihinde sona erecek. O zamana kadar asistanınız çalışmaya devam eder, sonrasında hizmet askıya alınır.` : `${tenant.name} aboneliğiniz iptal edildi.`, "Vazgeçerseniz Paketim sayfasındaki \"Aboneliği yönet\" düğmesinden aboneliğinizi yeniden başlatabilirsiniz."],
    cta: { label: "Paketim", url: panelUrl(deps, "paketim") },
  });
}

export function mailBillingSuspension(deps: Deps, tenant: Tenant, suspended: boolean) {
  send(deps, ownerEmails(deps, tenant.id), suspended ? "Hizmetiniz ödeme alınamadığı için askıya alındı" : "Ödemeniz alındı, hizmetiniz yeniden açıldı", {
    title: suspended ? "Hizmetiniz askıya alındı" : "Hizmetiniz yeniden açıldı",
    lines: [suspended
      ? `${tenant.name} aboneliği sona erdiği veya ödeme alınamadığı için asistan hizmeti askıya alındı; gelen aramalar şu an karşılanmıyor. Aboneliği yeniden başlatıp ödeme yaptığınızda hizmet kendiliğinden açılır.`
      : `${tenant.name} için ödemeniz alındı; asistan gelen aramaları yeniden karşılıyor.`],
    cta: { label: "Paketim", url: panelUrl(deps, "paketim") },
  });
}

/* ---------------- telefon hattı ---------------- */

const lineText = (e164: string) => spokenPhone(e164);

/** Numara asistana bağlandığında müşteriye (numara başına bir kez): ne olduğunu ve sıradaki adımı söyler */
export function mailLineReady(deps: Deps, tenant: Tenant, number: string) {
  send(deps, ownerEmails(deps, tenant.id), `Numaranız asistana bağlandı: ${tenant.name}`, {
    title: "Numaranız asistana bağlandı",
    lines: [
      `${tenant.name} için ${lineText(number)} numarası asistana bağlandı. Panelinizde asistanı deneyebilirsiniz.`,
      "Numaranızda Netgsm SIP yönlendirmesini rehberdeki gibi yaptıysanız, numarayı arayıp asistanı deneyin. Yapmadıysanız rehberin son adımını tamamlayın.",
      "Numarayı yalnızca yönlendirme hedefi olarak kullanıyorsanız: telefonunuzu açamadığınızda çağrıyı bu numaraya yönlendirin (koşullu yönlendirme önerilir). Yönlendirilen çağrıyı hattınızın operatörü ücretlendirebilir; güncel ücreti operatörünüzden öğrenin.",
    ],
    facts: [["Asistan numaranız", lineText(number)]],
    cta: { label: "Rehberi aç", url: `${deps.baseUrl ?? ""}/#/numara-al` },
  });
  send(deps, admins(deps), `Hat bağlandı: ${tenant.name}`, {
    title: "Numara asistana bağlandı",
    lines: [`${tenant.name} firmasının ${lineText(number)} numarası asistana bağlandı; müşteriye bilgi e-postası gönderildi.`],
  });
}

/** Üye kurulumun 3. adımında numarasını ve bilgilerini gönderdi: yönetici firmayı oluşturup numarayı bağlar */
export function mailLineSubmitted(deps: Deps, s: { reference: string; number: string; memberEmail: string; subscriptionType: string }) {
  send(deps, admins(deps), `Numara bildirildi: ${s.reference}`, {
    title: "Üye asistan numarasını bildirdi",
    lines: ["Üye Netgsm'den numarasını alıp SIP ayarını yaptığını bildirdi. Başvuruyu kontrol edip firmayı oluşturun; numara firmaya yazılır ve asistan kurulunca bağlanır."],
    facts: [["Başvuru", s.reference], ["Üye", s.memberEmail], ["Numara", lineText(s.number)], ["Abonelik", s.subscriptionType === "onodemeli" ? "Ön ödemeli" : "Faturalı"]],
    cta: { label: "Başvurular", url: panelUrl(deps, "basvurular") },
  });
}

/** Müşteri numarasını değiştirmek istediğini bildirdi: yönetici doğrulayıp elle tanımlar */
export function mailOwnNumberRequest(deps: Deps, tenant: Tenant, requester: string, number: string, note: string) {
  send(deps, admins(deps), `Numara değişikliği talebi: ${tenant.name}`, {
    title: "Müşteri numara değişikliği istiyor",
    lines: [
      "Numara müşterinin kendi aboneliğinde olmalı (numara kontrol listesi). Doğruladıktan sonra Müşteriler > Yönet ekranından numarayı firmaya yazın; müşteri kendi başına değiştiremez.",
      ...(note ? [`Müşterinin notu: ${note}`] : []),
    ],
    facts: [["Firma", tenant.name], ["Bildiren", requester], ["Numara", lineText(number)], ["Şu anki numara", tenant.phoneNumbers.map(lineText).join(", ") || "yok"]],
    cta: { label: "Müşteriler", url: panelUrl(deps, "musteriler") },
  });
}

