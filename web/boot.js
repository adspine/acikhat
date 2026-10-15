// Açılış: sayfa doğru görünüme geçene kadar içerik gizlenir, ortada sarı lamba yanar (ana sayfanın bir an görünüp kaybolması engellenir).
// Eski adresler (/#/hesap) temiz adrese (/hesap) çevrilir; bağlantılar, e-postalar ve yer imleri çalışmaya devam eder.
(function () {
  var h = location.hash;
  if (h.indexOf("#/") === 0) {
    var path = "/" + h.slice(2) + location.search;
    if (/^\/yasal(\/|$)/.test(path)) {
      location.replace(path); // yasal metinler sunucuda ayrı, taranabilir sayfalardır
      return;
    }
    history.replaceState(null, "", path === "/" + location.search ? "/" + location.search : path);
  }
  document.documentElement.classList.add("booting");
  // Güvenlik: betik yüklenemezse sayfa sonsuza dek gizli kalmasın
  setTimeout(function () { document.documentElement.classList.remove("booting"); }, 6000);
})();
