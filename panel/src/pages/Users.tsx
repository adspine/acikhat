import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Permission, type UsersResponse } from "../api.ts";
import { Button, Checkbox, Drawer, ErrorBox, Field, Input, Loading, Select, useToast } from "../components/ui.tsx";

export function UsersPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["users"], queryFn: () => api<UsersResponse>("/users") });
  const [inviting, setInviting] = useState(false);
  const [secret, setSecret] = useState<{ name: string; email: string; password: string } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["users"] });

  const update = useMutation({
    mutationFn: (v: { id: string; patch: Record<string, unknown> }) => api(`/users/${v.id}`, { method: "PATCH", body: v.patch }),
    onSuccess: () => { refresh(); toast("Kaydedildi"); },
    onError: (e) => toast(e.message, "error"),
  });
  const reset = useMutation({
    mutationFn: (u: { id: string; name: string; email: string }) => api<{ temporaryPassword: string }>(`/users/${u.id}/reset-password`, { method: "POST" }).then((r) => ({ ...u, password: r.temporaryPassword })),
    onSuccess: (r) => setSecret(r),
    onError: (e) => toast(e.message, "error"),
  });

  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <section className="page"><ErrorBox error={q.error} /></section>;
  const d = q.data;

  return (
    <section className="page narrow">
      <header className="page-head">
        <div>
          <h1 className="page-title">Kullanıcılar</h1>
          <p className="page-sub">Panele kimlerin gireceğini ve neleri görebileceğini belirleyin.</p>
        </div>
        <Button onClick={() => setInviting(true)}>Kullanıcı ekle</Button>
      </header>

      <section className="card">
        <ul className="user-list">
          {d.users.map((u) => (
            <li key={u.id} className={u.disabled ? "is-disabled" : ""}>
              <div className="user-main">
                <p className="user-name">{u.name}{u.isMe && <span className="tag">Siz</span>}{u.disabled && <span className="tag">Kapalı</span>}</p>
                <p className="user-email">{u.email}</p>
                <p className="muted small">{u.lastLoginAt ? `Son giriş: ${new Date(u.lastLoginAt).toLocaleString("tr-TR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}` : "Henüz giriş yapmadı"}</p>
              </div>
              <div className="user-actions">
                <Select aria-label={`${u.name} rolü`} value={u.role} disabled={u.isMe} onChange={(e) => update.mutate({ id: u.id, patch: { role: e.target.value } })}>
                  <option value="owner">{d.roles.owner}</option>
                  <option value="team">{d.roles.team}</option>
                </Select>
                {!u.isMe && (
                  <>
                    <Button variant="ghost" size="sm" onClick={() => reset.mutate(u)}>Şifre sıfırla</Button>
                    <Button variant="ghost" size="sm" onClick={() => update.mutate({ id: u.id, patch: { disabled: !u.disabled } })}>{u.disabled ? "Aç" : "Kapat"}</Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <TeamRole data={d} onSaved={refresh} />

      <InviteDrawer open={inviting} onClose={() => setInviting(false)} roles={d.roles} onCreated={(s) => { setInviting(false); setSecret(s); refresh(); }} />

      <Drawer open={!!secret} onClose={() => setSecret(null)} title="Geçici şifre">
        {secret && (
          <div className="stack">
            <p><strong>{secret.name}</strong> ({secret.email}) için geçici şifre:</p>
            <p className="secret" aria-label="Geçici şifre">{secret.password}</p>
            <p className="muted">Bu şifre yalnızca şimdi gösteriliyor. Kişiye iletin; ilk girişte kendi şifresini belirleyecek.</p>
            <Button variant="quiet" onClick={() => navigator.clipboard?.writeText(secret.password).then(() => toast("Kopyalandı"))}>Kopyala</Button>
          </div>
        )}
      </Drawer>
    </section>
  );
}

/** Ekip rolünün adı ve yetkileri (sektöre/firmaya göre değişir) */
function TeamRole({ data, onSaved }: { data: UsersResponse; onSaved: () => void }) {
  const toast = useToast();
  const [label, setLabel] = useState(data.team.label);
  const [perms, setPerms] = useState<Permission[]>(data.team.permissions);
  useEffect(() => { setLabel(data.team.label); setPerms(data.team.permissions); }, [data.team.label, data.team.permissions]);
  const save = useMutation({
    mutationFn: () => api("/team", { method: "PUT", body: { label, permissions: perms } }),
    onSuccess: () => { onSaved(); toast("Rol güncellendi"); },
    onError: (e) => toast(e.message, "error"),
  });
  const dirty = label !== data.team.label || perms.slice().sort().join() !== data.team.permissions.slice().sort().join();
  return (
    <section className="card">
      <div className="card-head"><h2>Ekip rolü</h2></div>
      <p className="muted">Sahip dışındaki kullanıcıların rol adı ve yetkileri. Değişiklik hemen geçerli olur.</p>
      <div className="stack">
        <Field label="Rol adı" hint="Örn. Resepsiyon, Sekreter, Ön büro">{(id, h) => <Input id={id} aria-describedby={h} value={label} onChange={(e) => setLabel(e.target.value)} />}</Field>
        <fieldset className="field">
          <legend className="field-label">Yetkiler</legend>
          {data.permissions.filter((p) => p.id !== "users.manage").map((p) => (
            <Checkbox key={p.id} label={p.label} checked={perms.includes(p.id)} onChange={(v) => setPerms(v ? [...perms, p.id] : perms.filter((x) => x !== p.id))} />
          ))}
        </fieldset>
        {dirty && <Button onClick={() => save.mutate()} busy={save.isPending}>Rolü kaydet</Button>}
      </div>
    </section>
  );
}

function InviteDrawer({ open, onClose, roles, onCreated }: { open: boolean; onClose: () => void; roles: UsersResponse["roles"]; onCreated: (s: { name: string; email: string; password: string }) => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"owner" | "team">("team");
  const create = useMutation({
    mutationFn: () => api<{ temporaryPassword: string }>("/users", { method: "POST", body: { name, email, role } }),
    onSuccess: (r) => { onCreated({ name, email, password: r.temporaryPassword }); setName(""); setEmail(""); },
  });
  return (
    <Drawer open={open} onClose={onClose} title="Kullanıcı ekle" footer={<div className="row-actions"><Button variant="ghost" onClick={onClose}>Vazgeç</Button><Button type="submit" form="invite" busy={create.isPending}>Ekle</Button></div>}>
      <form id="invite" className="stack" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
        <Field label="Ad soyad">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />}</Field>
        <Field label="E-posta">{(id) => <Input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />}</Field>
        <Field label="Rol">
          {(id) => (
            <Select id={id} value={role} onChange={(e) => setRole(e.target.value as "owner" | "team")}>
              <option value="team">{roles.team}</option>
              <option value="owner">{roles.owner}</option>
            </Select>
          )}
        </Field>
        {create.error && <p className="form-error" role="alert">{create.error.message}</p>}
        <p className="muted small">Eklediğinizde geçici bir şifre gösterilir; kişiye siz iletirsiniz.</p>
      </form>
    </Drawer>
  );
}
