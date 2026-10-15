import { useState } from "react";
import { api, ApiError } from "../api.ts";
import { Button, Field, Input, useToast } from "./ui.tsx";

/** +908503038332 → 0850 303 83 32 */
export const showPhone = (e164: string) => {
  const d = e164.replace("+90", "");
  return d.length === 10 ? `0${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6, 8)} ${d.slice(8)}` : e164;
};

/** Müşteri numarasını değiştirmek isterse yöneticiye talep iletir; numara kendiliğinden değişmez */
export function OwnNumberRequest() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [number, setNumber] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      await api("/api/panel/phone-request", { method: "POST", body: { number, note } });
      toast("Talebiniz iletildi. Numarayı doğrulayıp size döneceğiz.");
      setOpen(false);
      setNumber("");
      setNote("");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Talep iletilemedi", "error");
    } finally {
      setBusy(false);
    }
  };
  if (!open) return <div className="row-actions"><Button variant="quiet" onClick={() => setOpen(true)}>Numaramı değiştirmek istiyorum</Button></div>;
  return (
    <div className="phone-block">
      <p className="muted small">Netgsm aboneliğinizdeki yeni numarayı yazın. Ekibimiz numarayı doğrular ve asistana bağlar; numara kendiliğinden değişmez. Eski numaranızın SIP ayarını yeni numarada da yapmayı unutmayın.</p>
      <Field label="Numaranız">{(id) => <Input id={id} type="tel" placeholder="0850 000 00 00" value={number} onChange={(e) => setNumber(e.target.value)} />}</Field>
      <Field label="Not (isteğe bağlı)">{(id) => <Input id={id} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
      <div className="row-actions">
        <Button onClick={() => void send()} busy={busy} disabled={!number.trim()}>Talebi ilet</Button>
        <Button variant="quiet" onClick={() => setOpen(false)}>Vazgeç</Button>
      </div>
    </div>
  );
}

/**
 * Müşterinin kendi hattında kuracağı yönlendirme kodları, numarası yazılmış olarak. Önerilen: koşullu (meşgul, cevapsız, kapalı).
 * Kod biçimleri Turkcell ve Türk Telekom sayfalarındandır; numara biçimi operatörlere göre değişebilir (operatör testi sürüyor).
 */
export function ForwardingCodes({ number }: { number: string }) {
  const toast = useToast();
  if (number.startsWith("+90850999")) return <p className="muted small">Bu bir deneme numarasıdır, gerçek aramaları karşılamaz.</p>;
  const rows: [string, string][] = [
    ["Meşgulken", `**67*${number}#`],
    ["15 saniye cevap verilmezse", `**61*${number}**15#`],
    ["Telefon kapalı ya da kapsama dışındayken", `**62*${number}#`],
  ];
  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      toast("Kod kopyalandı. Telefonunuzun arama ekranına yapıştırıp arayın.");
    } catch {
      toast("Kopyalanamadı; kodu elle yazın", "error");
    }
  };
  return (
    <details className="phone-codes">
      <summary>Yönlendirme kodlarım</summary>
      <p className="muted small">Önerilen kurulum <strong>koşullu</strong> yönlendirmedir: telefonu siz açarsınız, yalnızca açamadığınız çağrıları asistan karşılar. Aşağıdaki kodlardan birini <strong>kendi işletme telefonunuzdan</strong> arama ekranına yazıp arayın. Önce asistanı deneyin.</p>
      <table className="data-table">
        <tbody>
          {rows.map(([label, code]) => (
            <tr key={label}>
              <td>{label}</td>
              <td><code>{code}</code></td>
              <td className="cell-actions"><Button variant="quiet" size="sm" onClick={() => void copy(code)}>Kopyala</Button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">İptal etmek için <code>##002#</code> tuşlayıp arayın. Kod kabul edilmezse numarayı <code>{`0${number.replace("+90", "")}`}</code> biçiminde yazın.</p>
      <p className="muted small">Yönlendirilen çağrıyı operatörünüz ücretlendirebilir (örneğin Turkcell yönlendirme servis ücreti alıyor). Güncel ücreti operatörünüzden öğrenin.</p>
    </details>
  );
}

