"use client";

import { Volume2 } from "lucide-react";
import { useEffect, useState, type RefObject } from "react";

/**
 * Les navigateurs mobiles bloquent le son sans geste de l'utilisateur. On le détecte
 * (AudioContext suspendu) et on propose un tapotement qui débloque l'audio et
 * réactive le son de la vidéo Neko (même origine).
 */
export function SoundOverlay({ frameRef }: { frameRef: RefObject<HTMLIFrameElement | null> }) {
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- détection unique au montage
    setBlocked(ctx.state === "suspended");
    void ctx.close();
  }, []);

  if (!blocked) return null;

  const unlock = async () => {
    try {
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      await ctx.resume();
      void ctx.close();
    } catch {
      /* rien */
    }
    try {
      const videos = frameRef.current?.contentDocument?.querySelectorAll("video") ?? [];
      for (const v of videos) {
        v.muted = false;
        await v.play().catch(() => {});
      }
    } catch {
      /* iframe pas encore prête : le bouton son de Neko reste disponible */
    }
    setBlocked(false);
  };

  return (
    <button
      type="button"
      onClick={unlock}
      className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-black/60 text-center"
    >
      <span className="flex size-20 items-center justify-center rounded-pill bg-white text-black shadow-pop">
        <Volume2 className="size-10" aria-hidden />
      </span>
      <span className="text-lg font-bold">Appuie pour activer le son</span>
    </button>
  );
}
