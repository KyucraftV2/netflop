"use client";

import { ArrowLeft, Users } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PLATFORMS, type PlatformId } from "@/lib/platforms";

/**
 * Vue de l'invité : le navigateur de l'hôte en lecture seule (simple membre Neko).
 * L'hôte peut lui passer le contrôle depuis sa barre de lecture.
 */
export function GuestClient({
  inviteId,
  hostSlug,
  hostName,
  platform,
  guestSlug,
  password,
}: {
  inviteId: string;
  hostSlug: string;
  hostName: string;
  platform: PlatformId;
  guestSlug: string;
  password: string;
}) {
  const [ended, setEnded] = useState(false);

  useEffect(() => {
    if (ended) return;
    const check = async () => {
      const res = await fetch(`/api/ensemble/${inviteId}`, { cache: "no-store" }).catch(() => null);
      if (!res?.ok) return;
      const { state } = (await res.json()) as { state: "active" | "ended" };
      if (state === "ended") setEnded(true);
    };
    const id = window.setInterval(() => void check(), 15_000);
    return () => window.clearInterval(id);
  }, [inviteId, ended]);

  const src = `/b/${hostSlug}/?usr=${encodeURIComponent(guestSlug)}&pwd=${encodeURIComponent(password)}&embed=1`;

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      {ended ? (
        <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
          <h1 className="text-2xl font-bold">La séance est terminée</h1>
          <p className="text-muted">{hostName} a quitté ou a retiré l&apos;invitation.</p>
          <Link href="/" className="underline">
            Retour à l&apos;accueil
          </Link>
        </div>
      ) : (
        <iframe
          src={src}
          title={`Navigateur de ${hostName} — ${PLATFORMS[platform].name}`}
          className="absolute inset-0 h-full w-full border-0"
          allow="autoplay; fullscreen; encrypted-media"
          allowFullScreen
          referrerPolicy="no-referrer"
        />
      )}
      <div
        role="toolbar"
        aria-label="Regarder ensemble"
        className="safe-top safe-x absolute inset-x-0 top-0 z-30 flex items-center gap-3 bg-gradient-to-b from-black/85 to-transparent px-3 py-2"
      >
        <Link
          href="/"
          aria-label="Retour à l'accueil"
          className="flex size-11 items-center justify-center rounded-pill hover:bg-white/10"
        >
          <ArrowLeft aria-hidden />
        </Link>
        <Users className="size-5 text-muted" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-sm">
          Avec <strong>{hostName}</strong> · {PLATFORMS[platform].name}
        </span>
      </div>
    </div>
  );
}
