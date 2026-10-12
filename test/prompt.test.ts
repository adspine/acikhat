import { describe, expect, it } from "vitest";
import { composePrompt, parseSections, renderPrompt } from "../src/domain/prompt.ts";
import { demoTenant } from "./helpers.ts";
import { VERTICALS } from "../src/domain/tenant.ts";
import { loadVertical } from "../src/domain/vertical.ts";

describe("prompt birleştirme (ortak + sektör)", () => {
  const core = "<!-- yorum -->\n# Rol\n[[sector:rol]]\n# Sınırlar\n- ortak\n[[sector:sinirlar]]\nFirma: [[business_name]]";
  const sector = "<!-- açıklama -->\n## rol\nSen [[business_name]] resepsiyonistisin.\n\n## sinirlar\n- sektöre özel kural\n";

  it("sektör bölümlerini yerine koyar, firma bilgisini her yerde doldurur, yorumları atar", () => {
    const out = composePrompt(core, sector, { business_name: "Lavanta Spa" });
    expect(out).toBe("# Rol\nSen Lavanta Spa resepsiyonistisin.\n# Sınırlar\n- ortak\n- sektöre özel kural\nFirma: Lavanta Spa\n");
  });

  it("eksik sektör bölümünde hata verir (bozuk prompt'la ajan kurulmaz)", () => {
    expect(() => composePrompt(core, "## rol\nx", { business_name: "X" })).toThrow('"## sinirlar" bölümü yok');
  });

  it("kullanılmayan sektör bölümünde hata verir (yazım hatası yakalanır)", () => {
    expect(() => composePrompt(core, sector + "\n## sinirllar\ny", { business_name: "X" })).toThrow("sinirllar");
  });

  it("doldurulmamış yer tutucuda hata verir", () => {
    expect(() => composePrompt(core, sector, {})).toThrow("[[business_name]]");
  });

  it("bölüm başlığını ayrıştırır", () => {
    expect([...parseSections(sector).keys()]).toEqual(["rol", "sinirlar"]);
  });

  it("gerçek spa prompt'u eksiksiz oluşur", () => {
    const p = renderPrompt(demoTenant);
    expect(p).not.toMatch(/\[\[|<!--/);
    expect(p).toContain("Sen Lavanta Spa adlı spa ve masaj merkezinin telefon resepsiyonistisin.");
    expect(p).toContain("Terapistler: Ayşe (kadın), Elif (kadın), Murat (erkek)");
    expect(p).toContain("Çift masajı (60 dakika): 4800 TL (id: cift-masaj-60), 2 terapist birlikte yapar");
    expect(p).toContain("Hassas bir konu (sağlık durumu, kayıp eşya, fatura itirazı)");
    expect(p).toContain("# Hitap");
  });

  it.each(VERTICALS)("%s sektörünün şablonu okunur ve prompt'u eksiksiz oluşur", (vertical) => {
    expect(loadVertical(vertical).label).toBeTruthy();
    const p = renderPrompt({ ...demoTenant, vertical });
    expect(p).not.toMatch(/\[\[|<!--/);
    expect(p).toContain("Hassas bir konu (");
  });
});
