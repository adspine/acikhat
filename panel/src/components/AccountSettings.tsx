import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../api.ts";
import { Button, Checkbox, Field, Input, Modal, Segmented, Select, useToast } from "./ui.tsx";
import { useTheme, type ThemePref } from "../theme.ts";

export interface AccountUser {
  name: string;
  email: string;
  notifyEmail: boolean;
}

/**
 * Hesap ayarları: kişiye ait tercihler (ad, görünüm, dil, bildirim). İşletme ve asistan ayarları "Kurulum" sayfasındadır.
 * Görünüm ve dil bu cihazda anında uygulanır; ad ve bildirim tercihi "Kaydet" ile hesaba yazılır.
 */
export function AccountSettings({ open, onClose, user }: { open: boolean; onClose: () => void; user: AccountUser }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [theme, setTheme] = useTheme();
  const [name, setName] = useState(user.name);
  const [notify, setNotify] = useState(user.notifyEmail);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  // Pencere her açıldığında kayıtlı değerlerle başlar
  useEffect(() => {
    if (open) {
      setName(user.name);
      setNotify(user.notifyEmail);
      setError(undefined);
    }
  }, [open, user.name, user.notifyEmail]);

  const dirty = name.trim() !== user.name || notify !== user.notifyEmail;

  const save = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await api("/api/auth/profile", { method: "PATCH", body: { name, notifyEmail: notify } });
      await Promise.all([qc.invalidateQueries({ queryKey: ["session"] }), qc.invalidateQueries({ queryKey: ["me"] })]);
      toast("Hesap ayarları kaydedildi");
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Kaydedilemedi");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose()}
      dismissible={!busy}
      size="md"
      title="Hesap ayarları"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{dirty ? "Vazgeç" : "Kapat"}</Button>
          <Button onClick={save} busy={busy} disabled={!dirty}>Kaydet</Button>
        </>
      }
    >
      <section className="acct-group" aria-labelledby="acct-profil">
        <h3 id="acct-profil">Profil</h3>
        <Field label="Ad soyad" error={error}>{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" data-autofocus />}</Field>
        <Field label="E-posta" hint="Giriş e-postanız. Değiştirmek için bizimle iletişime geçin.">{(id) => <Input id={id} value={user.email} readOnly disabled />}</Field>
      </section>

      <section className="acct-group" aria-labelledby="acct-gorunum">
        <h3 id="acct-gorunum">Görünüm</h3>
        <div className="acct-row">
          <div>
            <p className="acct-label">Tema</p>
            <p className="muted small">Yalnızca panelde geçerlidir; bu cihazda saklanır.</p>
          </div>
          <Segmented<ThemePref>
            label="Tema"
            value={theme}
            onChange={setTheme}
            options={[{ value: "light", label: "Açık" }, { value: "dark", label: "Koyu" }, { value: "system", label: "Sistem" }]}
          />
        </div>
        <Field label="Dil">
          {(id) => (
            <Select id={id} value="tr" onChange={() => {}}>
              <option value="tr">Türkçe</option>
              <option value="en" disabled>English (yakında)</option>
            </Select>
          )}
        </Field>
      </section>

      <section className="acct-group" aria-labelledby="acct-bildirim">
        <h3 id="acct-bildirim">Bildirimler</h3>
        <Checkbox
          label="Kota ve paket bilgilendirme e-postaları"
          hint="Kotanız dolmak üzereyken ve paket değişikliklerinde haber verilir. Satın alma onayları ve hizmet durumu e-postaları her zaman gönderilir."
          checked={notify}
          onChange={setNotify}
        />
      </section>
    </Modal>
  );
}
