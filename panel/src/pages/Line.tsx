import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../api.ts";
import { can, useMe } from "../App.tsx";
import { Button, Checkbox, ErrorBox, Field, Input, Loading, Select, useToast } from "../components/ui.tsx";
import { ForwardingCodes, OwnNumberRequest, showPhone } from "../components/LineParts.tsx";

interface LineState {
  numbers: string[];
  assistantReady: boolean;
  pending: { number: string; subscriptionType: "onodemeli" | "faturali" | null; sipConfigured: boolean; at: number | null } | null;
  canSubmit: boolean;
}

const NETGSM_SIGNUP = "https://www.netgsm.com.tr/uyelik";
const NETGSM_0850 = "https://www.netgsm.com.tr/sabit-telefon/0850-li-numara";
const NETGSM_GEO = "https://www.netgsm.com.tr/sabit-telefon/cografi-numara";
const NETGSM_PORTAL = "https://portal.netgsm.com.tr/";
const NETGSM_GUIDE = "https://bilgibankasi.netgsm.com.tr/yapay-zeka-cagri-entegrasyonlari/elevenlabs-netgsm-entegrasyonu";

const Ext = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
);

/** Üstteki ilerleme: kullanıcı hangi adımda olduğunu görsün */
function Progress({ step }: { step: 1 | 2 | 3 | 4 }) {
  const items = ["Numaranızı alın", "Numarayı bildirin", "Ekibimiz bağlasın", "Yönlendirin ve deneyin"];
  return (
    <ol className="line-progress" aria-label="Numara adımları">
      {items.map((label, i) => {
        const n = i + 1;
        return (
          <li key={label} className={n < step ? "is-done" : n === step ? "is-current" : undefined} aria-current={n === step ? "step" : undefined}>
            <span className="line-progress-no">{n < step ? "✓" : n}</span>
            {label}
          </li>
        );
      })}
    </ol>
  );
}

/** Netgsm'den numara alma: herkesin anlayacağı sırayla */
function Guide() {
  return (
    <section className="card line-guide" aria-labelledby="line-guide-title">
      <h2 id="line-guide-title">Numaranızı Netgsm'den alın</h2>
      <p className="muted">Asistanınızın cevaplayacağı numara, Netgsm'den <strong>kendi adınıza</strong> aldığınız bir <strong>0850 işletme numarası</strong> ya da <strong>şehir kodlu sabit hattır</strong> (0212, 0374 gibi). Cep numarası olmaz. Başvuru yaklaşık 15-20 dakika sürer.</p>

      <details className="line-why">
        <summary>Neden numarayı ben alıyorum?</summary>
        <ul>
          <li><strong>Numara sizde kalır.</strong> Sözleşme sizinle Netgsm arasındadır; Açık Hat'tan ayrılsanız da numara sizindir.</li>
          <li><strong>Kişisel verileriniz (KVKK).</strong> Kimlik, vergi ve adres belgeleri Netgsm'e yüklenir; bize gelmez.</li>
          <li><strong>Operatör kuralı.</strong> Numara, tahsis edildiği abonenin kendisi tarafından kullanılmalıdır.</li>
          <li><strong>Güvenlik.</strong> Netgsm şifrenizi ya da SIP şifrenizi bizimle paylaşmanız gerekmez.</li>
        </ul>
      </details>

      <div className="row-actions">
        <a className="btn btn-primary btn-md" href={NETGSM_SIGNUP} target="_blank" rel="noopener noreferrer">Netgsm başvuru sayfasını aç</a>
        <a className="btn btn-quiet btn-md" href="/#/numara-al" target="_blank" rel="noopener noreferrer">Ayrıntılı rehber</a>
      </div>

      <ol className="line-steps">
        <li>
          <h3>Hazırlanın</h3>
          <p>Başvuruyu <strong>sözleşmeyi imzalayacak kişi</strong> yapmalı (şirket yetkilisi ya da şahıs işletmesi sahibi): onay SMS'i ve e-Devlet ya da mobil onay onun telefonuna gelir. Gerekli belgeleri Netgsm ekranı listeler; genellikle kimlik, vergi levhası ve şirketlerde imza sirküleri istenir. Okunaklı PDF ya da fotoğraf hazır tutun, ödeme için kart gerekir.</p>
        </li>
        <li>
          <h3>Netgsm üyeliğini başlatın</h3>
          <p><Ext href={NETGSM_SIGNUP}>netgsm.com.tr/uyelik</Ext> sayfasında üyelik oluşturun, SMS kodunu girin. Abonelik türü olarak <strong>ön ödemeli</strong> seçmenizi öneririz: yetkisiz kullanımda kaybınız bakiyeyle sınırlı kalır.</p>
        </li>
        <li>
          <h3>Numara türünü seçin</h3>
          <p><Ext href={NETGSM_0850}>0850'li işletme numarası</Ext> ya da <Ext href={NETGSM_GEO}>şehir kodlu sabit hat</Ext>. Netgsm'in 0850 sayfasında yıllık numara ücreti 249 TL, taahhüt yok yazıyor; güncel ücreti başvuru ekranından teyit edin. Ücret ve yenileme Netgsm'e aittir, paketinize dahil değildir.</p>
        </li>
        <li>
          <h3>Sözleşme, belgeler ve ödeme</h3>
          <p>Netgsm ekranındaki adımları sırayla tamamlayın: adres, e-Devlet ya da mobil onayla sözleşme, belge yükleme, ödeme. Belgeler eksiksiz yüklenmeden başvuru ilerlemez. Numaranın etkinleşme süresi Netgsm'in sayfalarında belirtilmiyor; durumu Netgsm destek hattından sorabilirsiniz.</p>
        </li>
        <li>
          <h3>Numarayı asistana yönlendirin (SIP ayarı)</h3>
          <p><Ext href={NETGSM_PORTAL}>Netgsm Online İşlemler</Ext> panelinde:</p>
          <ol className="line-sub">
            <li><strong>Ses Hizmeti &gt; Ayarlar</strong> bölümüne gidin, <strong>SIP Bilgileri</strong> alanında <strong>Detay</strong>'a tıklayın.</li>
            <li><strong>SIP Trunk Bilgileri</strong> alanına <code>sip.rtc.elevenlabs.io</code> yazın, protokol olarak <strong>TCP</strong> seçin.</li>
            <li><strong>SIP Trunk Ayarlarını Kaydet</strong>'e basın, telefonunuza gelen doğrulama kodunu girin.</li>
            <li><strong>Aranan Prefix</strong> alanında <strong>+90</strong> seçin, <strong>Prefix Ayarlarını Kaydet</strong>'e basın.</li>
          </ol>
          <p className="muted small">Bu adımlar <Ext href={NETGSM_GUIDE}>Netgsm'in kendi ElevenLabs rehberine</Ext> dayanır; ekranlar değişirse onun yönergesini esas alın. Rehberdeki <em>SIP Trunk şifresi</em> adımına gerek yok, şifrenizi bize vermeyin. Bu ayar hesap genelinde olabilir: Netgsm'de başka iş için kullandığınız numara varsa Netgsm'e sorun, emin değilseniz asistan için ayrı abonelik açın.</p>
        </li>
        <li>
          <h3>Numarayı bize bildirin</h3>
          <p>Aşağıdaki formdan numaranızı gönderin. Ekibimiz kontrol eder, numarayı asistana bağlar ve size e-posta gönderir.</p>
        </li>
      </ol>
    </section>
  );
}

/** Numara bildirme formu */
function ReportForm({ initial, onDone }: { initial?: string; onDone: () => void }) {
  const toast = useToast();
  const [number, setNumber] = useState(initial ?? "");
  const [type, setType] = useState<"onodemeli" | "faturali">("onodemeli");
  const [sip, setSip] = useState(false);
  const [owner, setOwner] = useState(false);
  const [error, setError] = useState("");
  const send = useMutation({
    mutationFn: () => api("/line", { method: "POST", body: { number, subscriptionType: type, sipConfigured: sip, ownerConfirmed: owner } }),
    onSuccess: () => {
      toast("Numaranız bize ulaştı. Kontrol edip bağlayacağız.");
      onDone();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Gönderilemedi. Bağlantınızı kontrol edip tekrar deneyin."),
  });
  return (
    <form className="card line-form" onSubmit={(e) => { e.preventDefault(); setError(""); send.mutate(); }} aria-labelledby="line-form-title">
      <h2 id="line-form-title">Numaranızı aldınız mı? Bize bildirin</h2>
      <Field label="Asistan numaranız" hint="Netgsm'den aldığınız 0850 ya da şehir kodlu numara. Cep numarası olmaz.">
        {(id, d) => <Input id={id} aria-describedby={d} type="tel" inputMode="tel" placeholder="0850 000 00 00" value={number} onChange={(e) => setNumber(e.target.value)} autoComplete="off" />}
      </Field>
      <Field label="Netgsm abonelik türünüz">
        {(id) => (
          <Select id={id} value={type} onChange={(e) => setType(e.target.value as "onodemeli" | "faturali")}>
            <option value="onodemeli">Ön ödemeli (önerilir)</option>
            <option value="faturali">Faturalı</option>
          </Select>
        )}
      </Field>
      <Checkbox checked={sip} onChange={setSip} label={<>Netgsm panelinde <strong>SIP yönlendirme ayarını</strong> rehberdeki gibi yaptım (adres <code>sip.rtc.elevenlabs.io</code>, TCP, aranan prefix +90).</>} />
      <Checkbox checked={owner} onChange={setOwner} label={<>Bu numara <strong>benim ya da işletmemin adına</strong> kayıtlı. Netgsm şifremi Açık Hat ile paylaşmam gerekmiyor.</>} />
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="row-actions"><Button type="submit" busy={send.isPending} disabled={!number.trim()}>Numaramı gönder</Button></div>
    </form>
  );
}

export function LinePage() {
  const me = useMe();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["line"], queryFn: () => api<LineState>("/line") });
  const [editing, setEditing] = useState(false);
  const canEdit = can(me, "settings.edit");
  const refresh = () => {
    setEditing(false);
    void qc.invalidateQueries({ queryKey: ["line"] });
    void qc.invalidateQueries({ queryKey: ["today"] });
  };

  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const { numbers, pending, assistantReady } = q.data;
  const connected = numbers.length > 0;
  const step = connected ? 4 : pending ? 3 : 1;

  return (
    <section className="page line-page">
      <header className="page-head">
        <div>
          <h1 className="page-title">Numara rehberi</h1>
          <p className="page-sub">Asistanınızın çağrı alması için gereken tek şey bir telefon numarası. Takıldığınız yerde <a href="mailto:support@acikhat.si">support@acikhat.si</a> adresine yazın.</p>
        </div>
      </header>

      <Progress step={step} />

      {connected ? (
        <>
          <div className="card line-ok">
            <h2>Numaranız hazır</h2>
            <p className="line-number">{numbers.map(showPhone).join(" · ")}</p>
            <p>{assistantReady ? "Asistanınız bu numaraya gelen aramaları cevaplıyor. Önce kendiniz arayıp deneyin." : "Numaranız kayıtlı. Ekibimiz asistanınızı hazırlayıp bu numaraya bağlayınca size e-posta göndereceğiz."}</p>
          </div>
          <section className="card" aria-labelledby="line-use-title">
            <h2 id="line-use-title">Numarayı nasıl kullanacaksınız?</h2>
            <ul className="line-use">
              <li><strong>Ana numara olarak:</strong> bu numarayı web sitenize, Google işletme profilinize ve kartvizitinize koyun. Çağrıları önce asistan karşılar, gerektiğinde size aktarır.</li>
              <li><strong>Mevcut numaranızın yedeği olarak:</strong> telefonunuzu açamadığınızda çağrıyı bu numaraya yönlendirin. Müşterileriniz bildikleri numarayı aramaya devam eder.</li>
            </ul>
            <ForwardingCodes number={numbers[0]!} />
          </section>
          {canEdit && <OwnNumberRequest />}
        </>
      ) : (
        <>
          {pending && (
            <div className="card line-pending" role="status">
              <h2>Numaranız kontrol ediliyor</h2>
              <p className="line-number">{showPhone(pending.number)}</p>
              <p>Bilgileriniz bize ulaştı. Ekibimiz numarayı kontrol edip asistana bağlayacak; bağlanınca size e-posta göndereceğiz. Genellikle 1 iş günü içinde.</p>
              {canEdit && !editing && <div className="row-actions"><Button variant="quiet" onClick={() => setEditing(true)}>Numarayı değiştir</Button></div>}
            </div>
          )}
          {canEdit && (!pending || editing) && <ReportForm initial={pending ? showPhone(pending.number) : undefined} onDone={refresh} />}
          {!canEdit && !pending && <p className="muted">Numarayı yalnızca hesap sahibi bildirebilir.</p>}
          {(!pending || editing) && <Guide />}
        </>
      )}
    </section>
  );
}
