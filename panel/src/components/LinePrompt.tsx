import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api.ts";
import { can, useMe } from "../App.tsx";
import { useRouter } from "../router.tsx";
import { Button, Modal } from "./ui.tsx";

const KEY = "acikhat-line-prompt";
const seen = () => {
  try {
    return sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
};

/**
 * Asistan numarası henüz alınmamış firmaya panele girişte bir kez (oturum başına) gösterilen bilgilendirme.
 * Numara bildirildiyse ya da bağlıysa görünmez; numara rehberi sayfasının kendisinde de görünmez.
 */
export function LinePrompt() {
  const me = useMe();
  const { loc, navigate } = useRouter();
  const [dismissed, setDismissed] = useState(seen);
  const eligible = me.user.role !== "agency" && can(me, "settings.edit");
  const q = useQuery({
    queryKey: ["line"],
    queryFn: () => api<{ numbers: string[]; pending: unknown }>("/line"),
    enabled: eligible && !dismissed,
  });
  const needs = !!q.data && q.data.numbers.length === 0 && !q.data.pending;
  const onGuide = loc.path.startsWith("/numara");
  const close = () => {
    try {
      sessionStorage.setItem(KEY, "1");
    } catch {
      /* depolama kapalıysa bu görünümde bir kez daha sorulur */
    }
    setDismissed(true);
  };
  const open = needs && !dismissed && !onGuide;

  return (
    <Modal
      open={open}
      onClose={close}
      title="Asistanınız için bir telefon numarası gerekli"
      size="md"
      footer={
        <>
          <Button variant="quiet" onClick={close}>Daha sonra</Button>
          <Button data-autofocus onClick={() => { close(); navigate("/numara"); }}>Numara rehberini aç</Button>
        </>
      }
    >
      <div className="stack">
        <p>Panelinizi şimdiden gezebilirsiniz, ama asistanınız ancak bir numarası olduğunda çağrıları cevaplayabilir. Numarayı <strong>Netgsm'den kendi adınıza</strong> alırsınız: bir <strong>0850 işletme numarası</strong> ya da <strong>şehir kodlu sabit hat</strong> (0212, 0374 gibi). Cep numarası olmaz.</p>
        <ol className="line-prompt-steps">
          <li><strong>Netgsm'e başvurun.</strong> Rehber, hangi belgelerin gerektiğini ve nereye tıklayacağınızı adım adım gösteriyor (yaklaşık 15-20 dakika).</li>
          <li><strong>Numarayı bize bildirin.</strong> Aynı sayfadaki formdan numaranızı gönderin.</li>
          <li><strong>Biz bağlayalım.</strong> Kontrol edip asistana bağlarız, size e-posta göndeririz.</li>
        </ol>
        <p className="muted small">Takıldığınız yerde <a href="mailto:support@acikhat.si">support@acikhat.si</a> adresine yazın.</p>
      </div>
    </Modal>
  );
}
