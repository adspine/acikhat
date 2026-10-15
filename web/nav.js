// Sayfa içi yönlendirme: adres çubuğu /hesap gibi temiz yollarla güncellenir, sayfa yeniden yüklenmez.
// site.js bu olayı dinler; diğer modüller (form, giriş, kurulum) yalnızca go() çağırır.
export function go(path, { replace = false } = {}) {
  window.dispatchEvent(new CustomEvent("app:navigate", { detail: { path, replace } }));
}
