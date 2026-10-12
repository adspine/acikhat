import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/**
 * Ses önizleme oynatıcısı. Tek bir <audio> kullanılır (aynı anda tek ses çalar); Web Audio çözümleyicisiyle
 * sesin anlık şiddeti ölçülüp kökteki --amp değişkenine (0-1) yazılır. Küreler bu değişkenle konuşurken nefes alır.
 * Örnekler aynı sunucudan geldiği için çözümleme izinlidir; çözümleyici kurulamazsa küre yalnızca dönüş hızıyla canlanır.
 */
export function useVoicePlayer(root: RefObject<HTMLElement | null>) {
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  const raf = useRef(0);
  const smooth = useRef(0);

  const setAmp = useCallback((v: number) => root.current?.style.setProperty("--amp", v.toFixed(3)), [root]);

  const stopLoop = useCallback(() => {
    cancelAnimationFrame(raf.current);
    smooth.current = 0;
    setAmp(0);
  }, [setAmp]);

  const stop = useCallback(() => {
    audio.current?.pause();
    if (audio.current) audio.current.currentTime = 0;
    stopLoop();
    setPlayingId(null);
  }, [stopLoop]);

  const loop = useCallback(() => {
    const an = analyser.current;
    if (an) {
      const buf = new Uint8Array(an.fftSize);
      an.getByteTimeDomainData(buf);
      let sum = 0;
      for (const b of buf) sum += ((b - 128) / 128) ** 2;
      const rms = Math.min(1, Math.sqrt(sum / buf.length) * 3.2);
      smooth.current += (rms - smooth.current) * 0.35; // ani sıçramaları yumuşat
    } else {
      smooth.current = 0.35 + Math.sin(performance.now() / 160) * 0.2; // çözümleyici yoksa yapay nefes
    }
    setAmp(smooth.current);
    raf.current = requestAnimationFrame(loop);
  }, [setAmp]);

  const play = useCallback(
    async (id: string, url: string) => {
      if (playingId === id) return stop();
      if (!audio.current) {
        const a = new Audio();
        a.preload = "auto";
        a.addEventListener("ended", () => {
          stopLoop();
          setPlayingId(null);
        });
        audio.current = a;
        try {
          const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
          if (Ctx) {
            const ctx = new Ctx();
            const src = ctx.createMediaElementSource(a);
            const an = ctx.createAnalyser();
            an.fftSize = 512;
            src.connect(an);
            an.connect(ctx.destination);
            analyser.current = an;
          }
        } catch {
          analyser.current = null;
        }
      }
      const a = audio.current;
      a.pause();
      a.src = url;
      try {
        await (analyser.current?.context as AudioContext | undefined)?.resume();
        await a.play();
        setPlayingId(id);
        cancelAnimationFrame(raf.current);
        raf.current = requestAnimationFrame(loop);
      } catch {
        stop();
      }
    },
    [playingId, stop, stopLoop, loop],
  );

  // Sayfadan çıkınca sesi ve döngüyü kapat
  useEffect(
    () => () => {
      cancelAnimationFrame(raf.current);
      audio.current?.pause();
    },
    [],
  );

  return { playingId, play, stop };
}
