import { PLANS } from "./plans.ts";

/**
 * Sektör sayfalarının içeriği (/spa, /klinik, /otel). Tek kaynak burasıdır; sayfa HTML'i src/http/sector-pages.ts'te üretilir.
 *
 * Kural: yalnızca ürünün gerçekten yaptığı şeyler yazılır. Kaynaklar: agent/core/prompt.tr.md, agent/verticals/<sektör>/,
 * mevcut ana sayfa metni. "Yakında" olan özellikler (WhatsApp/SMS onayı) yakında diye yazılır, yapılıyormuş gibi anlatılmaz.
 * Yazım: kısa cümle, somut örnek; uzun tire ve dolgu kalıpları kullanılmaz (test/sector-pages.test.ts denetler).
 */
export interface SectorPage {
  slug: "spa" | "klinik" | "otel";
  /** Kurulum formundaki sektör kimliği ve ajan şablonu (agent/verticals/<id>) */
  sectorId: "spa" | "saglik" | "otel";
  /** Menü ve bağlantılarda kısa ad */
  nav: string;
  title: string;
  description: string;
  h1: string;
  lead: string;
  problem: { heading: string; paragraphs: string[] };
  does: { heading: string; items: { title: string; text: string }[] };
  doesNot: { heading: string; intro: string; items: string[] };
  /** Sektöre özel ek bölüm (örneğin klinik için kişisel veri) */
  note?: { heading: string; paragraphs: string[] };
  dialogue: { heading: string; intro: string; turns: [speaker: "Asistan" | "Arayan", text: string][]; extra?: { intro: string; turns: [speaker: "Asistan" | "Arayan", text: string][] } };
  setup: { heading: string; steps: { title: string; text: string }[] };
  faq: { q: string; a: string }[];
}

const planList = Object.values(PLANS);
const fromPrice = Math.min(...planList.map((p) => p.priceUsd));
const minutes = planList.map((p) => p.minutes.toLocaleString("tr-TR")).join(", ");

const priceAnswer = `Planlar aylık $${fromPrice}'dan başlar. Paketlere ${minutes} dakika yapay zekâ kullanımı dahildir; kullanım hakkı bitince her ek dakika $0,30'dur. Fiyatlar USD cinsindendir ve KDV dahildir. Kurulum bedeli yoktur. Güncel fiyatlar fiyatlandırma bölümünde.`;
const numberAnswer =
  "Hayır. Mevcut numaranızı, açamadığınızda ya da her aramada asistana yönlendirirsiniz; müşterileriniz aynı numarayı aramaya devam eder. Asistanın numarasını (0850 ya da sabit hat) Netgsm'den kendi adınıza alırsınız; rehberimiz adım adım anlatır. Yönlendirilen çağrılar hattınızın operatör tarifesine tabidir, bunu operatörünüzden öğrenin.";

export const SECTOR_PAGES: SectorPage[] = [
  {
    slug: "spa",
    sectorId: "spa",
    nav: "Spa",
    title: "Spa İçin Yapay Zeka Telefon Asistanı | Açık Hat",
    description: "Masaj, hamam ve cilt bakımı randevularını telefonda sizin yerinize alır. Terapist, oda ve hazırlık süresine göre boş saati bulur. 7/24 Türkçe.",
    h1: "Spa telefonunuzu yapay zekâ ile 7/24 karşılayın",
    lead: "Terapistleriniz seanstayken telefon çalar. Açık Hat aramayı açar, boş saati takviminizden bulur ve randevuyu yazar. Siz seansınıza, müşteriniz de randevusuna odaklanır.",
    problem: {
      heading: "Spa'da telefon neden cevapsız kalır",
      paragraphs: [
        "Masaj sürerken telefona bakılamaz. Küçük ve orta ölçekli spa'larda telefonu açan kişi çoğu zaman aynı zamanda seans veren, odayı hazırlayan ya da müşteriyi karşılayan kişidir.",
        "Cevapsız kalan arama, çoğu durumda başka bir spa'ya giden randevu demektir. Kaçan çağrıların bir kısmı da mesai dışında gelir: akşam eve dönünce ya da hafta sonu sabahı randevu bakan müşteriler.",
        "Açık Hat bu boşluğu doldurur. Hat çaldığında, siz meşgulken ya da mesai bittikten sonra, asistan devreye girer.",
      ],
    },
    does: {
      heading: "Asistan telefonda neler yapar",
      items: [
        { title: "Boş saati terapist, oda ve hazırlık süresine göre bulur", text: "Asistan takviminize bakar. Çalışma saatlerini, terapistin müsaitliğini, odanın dolu olup olmadığını ve seanslar arasındaki hazırlık süresini hesaba katar. Saati kendisi uyduramaz, çifte randevu yazılmaz." },
        { title: "Terapist tercihini dikkate alır", text: "Arayan kadın ya da erkek terapist isteyebilir. Asistan bunu sorar ve yalnızca o terapistlerin boş saatlerini önerir." },
        { title: "İki terapist gereken hizmetleri bilir", text: "Çift masajı gibi hizmetlerde kaç terapist ve hangi oda tipi gerektiği hizmet tanımında yazılıdır. Asistan yalnızca bunların hepsinin boş olduğu saatleri önerir." },
        { title: "Önce teyit, sonra kayıt", text: "Randevuyu yazmadan önce gün, saat, hizmet ve ismi arayana tekrar okur, açık bir onay almadan kaydetmez. İsimleri gerekirse harf harf doğrular, telefon numarasını rakam rakam geri okur." },
        { title: "Fiyat ve bilgi sorularını yanıtlar", text: "Hizmet listesi, fiyatlar, adres ve çalışma saatleri kurulumda verdiğiniz bilgiyle cevaplanır. Bilmediği bir şeyi uydurmaz, geri arama notu alır." },
        { title: "Kaçan çağrıyı kaybetmez", text: "Tüm hatlar doluyken arayan kısa bir bekleme anonsu dinler. Beklemeden kapatanlar ve asistanın çözemediği talepler panelde geri arama listesine düşer. Şikâyet ya da insanla görüşme isteğinde çağrı belirlediğiniz numaraya aktarılabilir." },
      ],
    },
    doesNot: {
      heading: "Asistanın yapmadıkları",
      intro: "Güvenmeniz için sınırlarını da açık yazıyoruz.",
      items: [
        "Telefonda kart numarası ya da ödeme bilgisi almaz.",
        "Sağlık konusunda tavsiye vermez.",
        "Bilmediği bir fiyatı, indirimi ya da kampanyayı uydurmaz.",
        "Takviminizde olmayan bir saati önermez.",
        "Randevu iptali ve değişikliğini şimdilik kendisi yapmaz; isim, numara ve talebi alıp geri arama kaydı bırakır.",
        "Kendini insan gibi tanıtmaz. Görüşmenin başında yapay zekâ olduğunu ve görüşmenin kaydedildiğini söyler.",
        "Randevu onay mesajı (WhatsApp veya SMS) yakında geliyor. Şimdilik onay, görüşme sırasında sözlü alınır.",
      ],
    },
    dialogue: {
      heading: "Örnek bir görüşme",
      intro: "Kurgusal bir örnek. Gerçek görüşmelerde cümleler arayana göre değişir.",
      turns: [
        ["Asistan", "Örnek Spa, merhaba. Ben yapay zekâ asistanı Elif. Görüşmemiz hizmet kalitesi için kaydediliyor. Size nasıl yardımcı olabilirim?"],
        ["Arayan", "Yarın akşam için klasik masaj istiyorum, mümkünse kadın terapist."],
        ["Asistan", "Yarın akşam kadın terapistlerimizde 18.00 ve 19.30 boş. Hangisi size uyar?"],
        ["Arayan", "19.30 olsun."],
        ["Asistan", "Adınızı harf harf söyler misiniz?"],
        ["Arayan", "A, Y, Ş, E, K, A, Y, A."],
        ["Asistan", "Ayşe Kaya. Telefon numaranız?"],
        ["Arayan", "Sıfır beş üç iki, bir iki üç, dört beş, altı yedi."],
        ["Asistan", "Teyit ediyorum: yarın saat 19.30, klasik masaj, Ayşe Kaya, 0532 123 45 67. Doğru mu?"],
        ["Arayan", "Evet, doğru."],
        ["Asistan", "Randevunuz oluşturuldu. Yarın görüşmek üzere."],
      ],
    },
    setup: {
      heading: "Kurulum nasıl yapılır",
      steps: [
        { title: "Bilgi formunu doldurun", text: "Hizmetlerinizi (süre, fiyat, oda tipi, kaç terapist gerektiği), terapistlerinizi ve çalışma saatlerinizi yazarsınız. Yaklaşık 15 dakika sürer, yarıda bırakıp devam edebilirsiniz." },
        { title: "Asistanı biz hazırlarız", text: "Bilgilerinizi spa şablonuna işler, yayına almadan önce test görüşmeleri yaparız." },
        { title: "Numaranızı yönlendirin", text: "Telefonunuzdan tek bir kod tuşlarsınız. Numaranız değişmez, kodu istediğiniz an iptal edebilirsiniz." },
        { title: "Deneyin, sonra yayına alın", text: "Asistanı panelden kendiniz konuşarak denersiniz. Fiyat ve saat değişikliklerini sonradan panelden kendiniz yayınlarsınız." },
      ],
    },
    faq: [
      { q: "Terapistlerim farklı saatlerde çalışıyor, bunu bilir mi?", a: "Evet. Kurulumda her terapistin çalışma saatlerini ve verebildiği hizmetleri yazarsınız. Asistan yalnızca o terapistin çalıştığı ve boş olduğu saatleri önerir. Saatleri panelden istediğiniz zaman değiştirip yayınlarsınız." },
      { q: "Randevular nereye yazılıyor?", a: "Açık Hat'ın kendi takvimine ya da Google Takvim'inize. Hangisini kullanacağınızı kurulumda seçersiniz." },
      { q: "Müşteri randevusunu iptal etmek ya da değiştirmek isterse?", a: "Şimdilik asistan iptal ve değişikliği kendisi yapmaz. İsim, numara ve talebi alır, siz panelde geri arama olarak görürsünüz." },
      { q: "Spa kapalıyken ya da herkes meşgulken ne olur?", a: "Asistan mesai dışında da cevaplar ve randevu alır. Tüm hatlar doluysa arayan kısa bir bekleme anonsu dinler. Beklemeden kapatan olursa panelde geri arama listesinde görürsünüz." },
      { q: "Telefon numaramı değiştirmem gerekir mi?", a: numberAnswer },
      { q: "Ne kadar tutar?", a: priceAnswer },
    ],
  },
  {
    slug: "klinik",
    sectorId: "saglik",
    nav: "Klinik",
    title: "Klinik İçin Yapay Zeka Telefon Sekreteri | Açık Hat",
    description: "Diş kliniği ve poliklinikler için Türkçe telefon sekreteri. Hekim ve odaya göre muayene randevusu alır, teşhis koymaz, acilde 112'ye yönlendirir. 7/24.",
    h1: "Klinik telefonlarınızı yapay zekâ sekreter ile 7/24 karşılayın",
    lead: "Hekim hastayla ilgilenirken ve sekreter başka bir hastayı karşılarken telefon çalmaya devam eder. Açık Hat aramayı açar, hekimin boş saatine muayene randevusu yazar ve sağlıkla ilgili hiçbir yorum yapmaz.",
    problem: {
      heading: "Klinikte telefon neden cevapsız kalır",
      paragraphs: [
        "Muayene sürerken hekim telefona bakamaz. Sekreter de çoğu zaman karşılama, ödeme ve dosya işleriyle aynı anda ilgilenir. Yoğun saatlerde aramalar üst üste gelir.",
        "Randevu isteyen hasta çoğunlukla ilk aradığı klinikte randevu almak ister. Cevap bulamazsa sıradaki kliniği arar. Mesai bittikten sonra gelen aramalar ise ertesi sabaha kadar cevapsız kalır.",
        "Açık Hat randevu ve bilgi aramalarını karşılar. Sağlık durumu gibi hassas konularda ise çağrıyı size aktarır ya da geri arama notu bırakır.",
      ],
    },
    does: {
      heading: "Asistan telefonda neler yapar",
      items: [
        { title: "Randevuyu hekime ve odaya göre verir", text: "Hekimin çalışma saatleri, uzmanlığı ve muayene odası ya da tedavi koltuğunun doluluğu hesaba katılır. Hasta belirli bir hekim isterse bu randevuya yansır." },
        { title: "Yalnızca gerekli bilgiyi sorar", text: "Şikâyetin ayrıntısını sormaz. Hangi bölüm ya da işlem için randevu istendiğini öğrenir (muayene, kontrol, dolgu gibi). İlk kez gelip gelmediğini sorabilir. Böylece telefonda toplanan sağlık bilgisi en aza iner." },
        { title: "Çocuk için randevu alır", text: "Randevu çocuğun adına yazılır, iletişim numarası olarak yakınının numarası kaydedilir." },
        { title: "Önce teyit, sonra kayıt", text: "Randevuyu yazmadan önce gün, saat, işlem ve ismi tekrar okur, açık bir onay almadan kaydetmez. Telefon numarasını rakam rakam geri okur." },
        { title: "Fiyat ve bilgi sorularını yanıtlar", text: "Muayene ücreti, adres ve çalışma saatleri gibi bilgiler kurulumda verdiğiniz içerikle cevaplanır. Bilmediğini uydurmaz." },
        { title: "Hassas konuları insana aktarır", text: "Sağlık durumu, test sonucu, rapor talebi, fatura itirazı ve hekim şikâyeti gibi konularda çağrıyı yetkiliye aktarır ya da geri arama notu bırakır." },
      ],
    },
    doesNot: {
      heading: "Asistanın yapmadıkları",
      intro: "Sağlıkta güven, neyin yapılmadığını bilmekle başlar.",
      items: [
        "Teşhis koymaz, ilaç ya da tedavi önermez, şikâyetin ciddiyeti hakkında yorum yapmaz. Bunlar için hekimin muayenesini önerir.",
        "Acil durumda (şiddetli ağrı, kanama, nefes darlığı, bilinç kaybı) randevu işlemine devam etmez, arayana hemen 112'yi aramasını söyler.",
        "Hasta sonuçlarını ya da dosya bilgisini telefonda paylaşmaz.",
        "Tedavi sonucu, başarı oranı ya da 'ağrısız' gibi vaatlerde bulunmaz.",
        "Telefonda kart numarası, T.C. kimlik numarası ya da ödeme bilgisi istemez.",
        "Randevu iptali ve değişikliğini şimdilik kendisi yapmaz; isim, numara ve talebi alıp geri arama kaydı bırakır.",
        "Kendini insan gibi tanıtmaz. Görüşmenin başında yapay zekâ olduğunu ve görüşmenin kaydedildiğini söyler.",
      ],
    },
    note: {
      heading: "Hasta verisi ve KVKK",
      paragraphs: [
        "Sağlıkla ilgili bilgiler özel nitelikli kişisel veridir, bu yüzden asistan şikâyet ayrıntısı sormayacak şekilde ayarlıdır. Görüşmenin başında kaydedildiği söylenir.",
        "Klinik, hastalarının verisi bakımından veri sorumlusudur; Açık Hat veri işleyendir. Sunucu, ses ve yapay zekâ işleme hizmetleri yurt dışındaki (ABD) sağlayıcılar üzerinden çalışır. Saklama süreleri (ses kaydı en çok 90 gün, döküm 12 ay) ve aktarım ayrıntıları KVKK aydınlatma metninde, veri işleme koşulları kullanım koşullarının 9. maddesinde yazılıdır.",
      ],
    },
    dialogue: {
      heading: "Örnek görüşmeler",
      intro: "Kurgusal örnekler. Gerçek görüşmelerde cümleler arayana göre değişir.",
      turns: [
        ["Asistan", "Örnek Klinik, merhaba. Ben yapay zekâ asistanı Deniz. Görüşmemiz hizmet kalitesi için kaydediliyor. Size nasıl yardımcı olabilirim?"],
        ["Arayan", "Diş kontrolü için randevu istiyorum."],
        ["Asistan", "Elbette. Daha önce kliniğimize geldiniz mi?"],
        ["Arayan", "Hayır, ilk kez geleceğim."],
        ["Asistan", "Perşembe günü 10.30 ve 15.00 boş. Hangisi uygun?"],
        ["Arayan", "10.30."],
        ["Asistan", "Adınızı ve telefon numaranızı alabilir miyim?"],
        ["Arayan", "Mehmet Aydın, sıfır beş dört dört, bir iki üç, dört beş, altı yedi."],
        ["Asistan", "Teyit ediyorum: Perşembe 10.30, kontrol, Mehmet Aydın, 0544 123 45 67. Doğru mu?"],
        ["Arayan", "Doğru."],
        ["Asistan", "Randevunuz oluşturuldu. Gelemeyecekseniz lütfen önceden bizi arayın."],
      ],
      extra: {
        intro: "Acil bir durumda asistan randevuya devam etmez:",
        turns: [
          ["Arayan", "Çok şiddetli ağrım var, yüzüm şişti ve kanıyor."],
          ["Asistan", "Bu durum acil olabilir. Lütfen hemen 112'yi arayın."],
        ],
      },
    },
    setup: {
      heading: "Kurulum nasıl yapılır",
      steps: [
        { title: "Bilgi formunu doldurun", text: "Hekimlerinizi, uzmanlıklarını, çalışma saatlerini, işlemleri (süre, fiyat) ve muayene odalarını yazarsınız. Yaklaşık 15 dakika sürer." },
        { title: "Asistanı biz hazırlarız", text: "Bilgilerinizi klinik şablonuna işler, yayına almadan önce test görüşmeleri yaparız." },
        { title: "Numaranızı yönlendirin", text: "Telefonunuzdan tek bir kod tuşlarsınız. Numaranız değişmez, kodu istediğiniz an iptal edebilirsiniz." },
        { title: "Deneyin, sonra yayına alın", text: "Asistanı panelden kendiniz konuşarak denersiniz. Bilgi değişikliklerini sonradan panelden kendiniz yayınlarsınız." },
      ],
    },
    faq: [
      { q: "Asistan hastaya tıbbi bilgi verir mi?", a: "Hayır. Teşhis koymaz, ilaç ya da tedavi önermez, şikâyetin ciddiyeti hakkında yorum yapmaz. Bu tür sorularda hekimin muayenesini önerir." },
      { q: "Acil durumda ne yapar?", a: "Şiddetli ağrı, kanama, nefes darlığı ya da bilinç kaybı gibi bir durum anlatılırsa randevu işlemine devam etmez ve arayana hemen 112'yi aramasını söyler." },
      { q: "Hasta verisi nerede işleniyor?", a: "Randevu kayıtları ve görüşme dökümleri Açık Hat sunucusunda tutulur. Sunucu, ses ve yapay zekâ işleme hizmetleri yurt dışındaki (ABD) sağlayıcılar üzerinden çalışır. Saklama süreleri ve aktarım KVKK aydınlatma metninde açıklanmıştır. Klinik veri sorumlusudur, Açık Hat veri işleyendir." },
      { q: "Kullandığım klinik yazılımıyla entegre mi?", a: "Klinik yönetim yazılımlarıyla doğrudan entegrasyon şu an yok. Asistan Açık Hat'ın kendi takvimi ya da Google Takvim ile çalışır. İki ayrı takvim tutmak çift randevu riski doğurduğu için, kurulumdan önce mevcut yönteminizi birlikte değerlendiririz." },
      { q: "Telefon numaramı değiştirmem gerekir mi?", a: numberAnswer },
      { q: "Ne kadar tutar?", a: priceAnswer },
    ],
  },
  {
    slug: "otel",
    sectorId: "otel",
    nav: "Otel",
    title: "Otel İçin Yapay Zeka Telefon Resepsiyonisti | Açık Hat",
    description: "Otel ve pansiyonda gece ve yoğun saatlerde telefonu karşılar, bilgi verir, spa ve restoran randevusu alır, oda taleplerini resepsiyona iletir. 7/24 Türkçe.",
    h1: "Otel telefonlarınızı yapay zekâ resepsiyonist ile 7/24 karşılayın",
    lead: "Resepsiyon check-in kuyruğuyla uğraşırken telefon çalar, gece vardiyasında ise çoğu zaman tek kişi vardır. Açık Hat telefonu açar, bilgi verir, saatli hizmetlere randevu yazar ve oda taleplerini eksiksiz bir notla size bırakır.",
    problem: {
      heading: "Otelde telefon neden cevapsız kalır",
      paragraphs: [
        "Resepsiyon aynı anda misafiri karşılar, anahtar verir, ödeme alır. Telefon çaldığında öncelik ekranın karşısındaki misafirdedir.",
        "Sezon yoğunluğunda ve akşam saatlerinde aramalar birikir, gece ise çoğu işletmede tek kişi çalışır. Rezervasyon sormak ya da giriş saatini öğrenmek isteyen kişi cevap bulamazsa başka bir tesise yönelir.",
        "Önemli bir not: Açık Hat bir otel rezervasyon sistemi değildir ve gece bazlı oda stokunu bilmez. Bu yüzden oda taleplerini kesin rezervasyon gibi değil, eksiksiz bir talep notu olarak resepsiyona iletir. Spa, restoran ve aktivite gibi saatli hizmetlerde ise takvimden boş saate randevu yazar.",
      ],
    },
    does: {
      heading: "Asistan telefonda neler yapar",
      items: [
        { title: "Giriş-çıkış saati, kahvaltı ve olanakları anlatır", text: "Bu bilgiler kurulumda verdiğiniz içerikten aktarılır. Asistan olmayan bir olanağı ya da kampanyayı uydurmaz." },
        { title: "Oda taleplerini eksiksiz not alır", text: "Giriş tarihi, kaç gece kalınacağı ve kaç kişi olacağı (çocuk varsa yaşı) ile birlikte ad ve telefon numarası alınır. Yetkili geri aradığında her şey hazırdır. Oda tipi sistemde tanımlıysa müsaitlik takvimden kontrol edilir, tanımlı değilse söz verilmez." },
        { title: "Spa, restoran ve etkinlik randevusu yazar", text: "Saatli hizmetlerde asistan takvimden boş saate randevu yazar. Önce gün, saat ve ismi tekrar okur, açık bir onay almadan kaydetmez." },
        { title: "Şikâyet ve kayıp eşyada insana aktarır", text: "Şikâyet, kayıp eşya, ödeme ve iade itirazı ve güvenlik konularında çağrıyı yetkiliye aktarır ya da geri arama notu bırakır." },
        { title: "Fiyat ve müsaitliği uydurmaz", text: "Müsaitlik ve fiyat yalnızca sistemden ya da sizin verdiğiniz bilgiden aktarılır. İade ve iptal koşulları da yalnızca sizin yazdığınız kurallara göre anlatılır." },
        { title: "Gece ve yoğun saatte çağrı kaçırmaz", text: "Tüm hatlar doluyken arayan kısa bir bekleme anonsu dinler. Beklemeden kapatanlar panelde geri arama listesine düşer." },
      ],
    },
    doesNot: {
      heading: "Asistanın yapmadıkları",
      intro: "Beklentiyi baştan netleştirmek için sınırlarını açık yazıyoruz.",
      items: [
        "Otel yönetim yazılımı (PMS) ya da kanal yöneticisi ile entegrasyon şu an yok. Gece bazlı oda stokunu bilmez.",
        "Telefonda kredi kartı numarası, CVV ya da şifre istemez. Ödeme için güvenli bir yol sunulacağını söyler.",
        "Rezervasyon iptali ve değişikliğini şimdilik kendisi yapmaz; isim, numara ve talebi alıp geri arama kaydı bırakır.",
        "Şimdilik yalnızca Türkçe konuşur, başka dil desteği yok.",
        "Kendini insan gibi tanıtmaz. Görüşmenin başında yapay zekâ olduğunu ve görüşmenin kaydedildiğini söyler.",
        "Randevu onay mesajı (WhatsApp veya SMS) yakında geliyor. Şimdilik onay, görüşme sırasında sözlü alınır.",
      ],
    },
    dialogue: {
      heading: "Örnek bir görüşme",
      intro: "Kurgusal bir örnek. Gerçek görüşmelerde cümleler arayana göre değişir.",
      turns: [
        ["Asistan", "Örnek Otel, merhaba. Ben yapay zekâ asistanı Elif. Görüşmemiz hizmet kalitesi için kaydediliyor. Size nasıl yardımcı olabilirim?"],
        ["Arayan", "Cumartesi için iki gece, iki yetişkin ve yedi yaşında bir çocukla oda arıyorum. Giriş saati kaçta?"],
        ["Asistan", "Giriş saatimiz 14.00, çıkış 12.00. Oda talebinizi not alıyorum: cumartesi giriş, iki gece, iki yetişkin ve yedi yaşında bir çocuk. Adınızı ve numaranızı alabilir miyim?"],
        ["Arayan", "Ali Demir, sıfır beş üç beş, bir iki üç, dört beş, altı yedi."],
        ["Asistan", "Teşekkürler Ali Bey. Talebiniz resepsiyona iletildi, müsaitlik ve fiyat için sizi en kısa sürede arayacaklar. Fiyat ve müsaitlik konusunda şu an söz veremem."],
      ],
    },
    setup: {
      heading: "Kurulum nasıl yapılır",
      steps: [
        { title: "Bilgi formunu doldurun", text: "Oda tiplerinizi, giriş-çıkış saatlerini, kahvaltı ve olanakları, spa ya da restoran gibi saatli hizmetlerinizi yazarsınız. Yaklaşık 15 dakika sürer." },
        { title: "Asistanı biz hazırlarız", text: "Bilgilerinizi otel şablonuna işler, yayına almadan önce test görüşmeleri yaparız." },
        { title: "Santralinizi yönlendirin", text: "Cep ya da sabit hattınız için tek bir kod yeterlidir. Santralli otellerde yönlendirme santral ayarından yapılır; kurulumda birlikte bakarız. Numaranız değişmez." },
        { title: "Deneyin, sonra yayına alın", text: "Asistanı panelden kendiniz konuşarak denersiniz. Bilgi değişikliklerini sonradan panelden kendiniz yayınlarsınız." },
      ],
    },
    faq: [
      { q: "Asistan oda müsaitliğini ve fiyatı söyler mi?", a: "Yalnızca sistemde tanımlı bilgiyle. Gece bazlı oda stokunu bilmez, otel yönetim yazılımıyla bağlantısı yoktur. Oda taleplerinde tarih, gece ve kişi sayısını alıp ad ve numarayla birlikte resepsiyona iletir; fiyat ve müsaitlik için sizin geri aramanızı söyler." },
      { q: "Mevcut rezervasyon sistemimle çalışır mı?", a: "Doğrudan entegrasyon şu an yok. Asistan Açık Hat'ın kendi takvimi ya da Google Takvim ile çalışır. Bu yüzden rezervasyonlarınız mevcut sisteminizde kalır, asistan yalnızca talebi toplar ve saatli hizmetlere (spa, restoran) randevu yazar." },
      { q: "Yabancı misafirler arayınca ne olur?", a: "Asistan şimdilik yalnızca Türkçe konuşur. Başka dil desteği yok; yabancı dilde arayan misafirlere şu an hizmet veremez." },
      { q: "Gece resepsiyonda kimse yokken ne olur?", a: "Asistan geceleri de telefonu açar, bilgi verir ve talepleri not alır. Sabah panelde çağrı özetlerini ve geri arama listesini görürsünüz." },
      { q: "Şikâyet eden ya da sinirli bir misafir ararsa?", a: "Şikâyet, kayıp eşya, ödeme ve iade itirazı, güvenlik gibi konularda asistan çağrıyı belirlediğiniz numaraya aktarır ya da isim ve numarayla geri arama notu bırakır." },
      { q: "Telefon numaramı değiştirmem gerekir mi?", a: numberAnswer },
      { q: "Ne kadar tutar?", a: priceAnswer },
    ],
  },
];

export const sectorBySlug = (slug: string) => SECTOR_PAGES.find((s) => s.slug === slug);
