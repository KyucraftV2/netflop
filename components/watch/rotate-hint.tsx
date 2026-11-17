"use client";

import { Smartphone } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

/** Téléphone en portrait pendant la lecture : on suggère de tourner l'écran. */
export function RotateHint() {
  const [portrait, setPortrait] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(orientation: portrait) and (max-width: 767px)");
    const update = () => setPortrait(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  if (!portrait || dismissed) return null;
  return (
    <div className="safe-px absolute inset-0 z-20 flex flex-col items-center justify-center gap-5 bg-black/90 text-center">
      <Smartphone className="size-14 rotate-90 text-accent motion-safe:animate-pulse" aria-hidden />
      <p className="text-xl font-bold">Tourne ton téléphone</p>
      <p className="text-sm text-muted">La vidéo s&apos;affiche bien mieux en paysage.</p>
      <Button variant="secondary" onClick={() => setDismissed(true)}>
        Continuer en portrait
      </Button>
    </div>
  );
}
