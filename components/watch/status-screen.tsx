"use client";

import { AlertTriangle, Bell, Loader2, MonitorPlay, RotateCcw } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { PLATFORMS, type PlatformId } from "@/lib/platforms";

export type ScreenKind = "starting" | "queued" | "opening" | "stopping" | "ended" | "error";

export function StatusScreen({
  kind,
  platform,
  title,
  position,
  errorMessage,
  onRetry,
  onQuit,
}: {
  kind: ScreenKind;
  platform: PlatformId;
  title: string | null;
  position: number | null;
  errorMessage: string | null;
  onRetry: () => void;
  onQuit: () => void;
}) {
  const p = PLATFORMS[platform];
  return (
    <div
      className="safe-px absolute inset-0 z-10 flex flex-col items-center justify-center gap-6 bg-[radial-gradient(ellipse_at_center,#262626_0%,#000_70%)] text-center"
      role="status"
      aria-live="polite"
    >
      <div
        className="flex h-16 w-44 items-center justify-center rounded-tile shadow-pop"
        style={{ backgroundColor: p.tileColor }}
      >
        <Image src={p.logo} alt={p.name} width={140} height={42} className="h-8 w-auto" />
      </div>

      {kind === "starting" ? (
        <>
          <Loader2 className="size-10 animate-spin text-accent" aria-hidden />
          <div>
            <h1 className="text-2xl font-bold">Préparation de ton navigateur…</h1>
            <p className="mt-2 text-muted">Quelques secondes, le temps de lancer Chrome.</p>
          </div>
        </>
      ) : null}

      {kind === "opening" ? (
        <>
          <MonitorPlay className="size-10 animate-pulse text-accent" aria-hidden />
          <h1 className="text-2xl font-bold">
            Ouverture {title ? <>de « {title} » </> : null}sur {p.name}…
          </h1>
        </>
      ) : null}

      {kind === "queued" ? <Queued position={position} /> : null}

      {kind === "stopping" ? (
        <>
          <Loader2 className="size-10 animate-spin text-muted" aria-hidden />
          <h1 className="text-2xl font-bold">Fermeture de la séance précédente…</h1>
        </>
      ) : null}

      {kind === "ended" ? (
        <>
          <h1 className="text-2xl font-bold">Ta séance est terminée</h1>
          <div className="flex flex-wrap justify-center gap-3">
            <Button onClick={onRetry}>
              <RotateCcw aria-hidden /> Relancer
            </Button>
            <Button asChild variant="secondary">
              <Link href="/">Accueil</Link>
            </Button>
          </div>
        </>
      ) : null}

      {kind === "error" ? (
        <>
          <AlertTriangle className="size-10 text-warning" aria-hidden />
          <div>
            <h1 className="text-2xl font-bold">Oups, quelque chose a coincé</h1>
            <p className="mt-2 max-w-md text-muted">
              {errorMessage ?? "Le navigateur ne répond plus."} Tu peux le relancer : ton profil
              (connexions aux plateformes) est conservé.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-3">
            <Button onClick={onRetry}>
              <RotateCcw aria-hidden /> Relancer
            </Button>
            <Button variant="secondary" onClick={onQuit}>
              Quitter
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}

function Queued({ position }: { position: number | null }) {
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">("default");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- lecture d'une API navigateur au montage
    setPerm("Notification" in window ? Notification.permission : "unsupported");
  }, []);
  return (
    <>
      <div className="flex size-24 items-center justify-center rounded-pill border-4 border-accent text-4xl font-black">
        {position ?? "…"}
      </div>
      <div>
        <h1 className="text-2xl font-bold">Tous les navigateurs sont occupés</h1>
        <p className="mt-2 max-w-md text-muted">
          Tu es {position === 1 ? "le prochain" : `n° ${position ?? "?"} dans la file`}. Garde cette
          page ouverte : on te prévient dès que c&apos;est ton tour, et ça démarre tout seul.
        </p>
      </div>
      {perm === "default" ? (
        <Button
          variant="secondary"
          onClick={async () => setPerm(await Notification.requestPermission())}
        >
          <Bell aria-hidden /> Me notifier
        </Button>
      ) : null}
    </>
  );
}
