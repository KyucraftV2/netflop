"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import Image from "next/image";
import { PLATFORMS, type PlatformId } from "@/lib/platforms";
import { cn } from "@/lib/utils";

/** Choix de la plateforme quand un titre est disponible sur plusieurs. */
export function PlatformChooser({
  title,
  platforms,
  subscribed,
  onChoose,
  onClose,
}: {
  title: string | null;
  platforms: PlatformId[];
  subscribed: PlatformId[];
  onChoose: (p: PlatformId) => void;
  onClose: () => void;
}) {
  return (
    <Dialog.Root open={title !== null} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[min(92vw,26rem)] -translate-x-1/2 -translate-y-1/2 rounded-tile bg-surface p-6 shadow-pop">
          <Dialog.Title className="pr-8 text-xl font-bold">Regarder « {title} »</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted">
            Disponible sur plusieurs plateformes : choisis-en une.
          </Dialog.Description>
          <ul className="mt-5 grid gap-3">
            {platforms.map((id) => {
              const p = PLATFORMS[id];
              return (
                <li key={id}>
                  <button
                    type="button"
                    onClick={() => onChoose(id)}
                    className={cn(
                      "flex min-h-14 w-full items-center gap-3 rounded-card px-4 text-left transition-transform motion-safe:hover:scale-[1.02]",
                      !subscribed.includes(id) && "opacity-60",
                    )}
                    style={{ backgroundColor: p.color, color: p.textColor }}
                  >
                    <Image src={p.logo} alt="" width={100} height={30} className="h-6 w-auto" />
                    <span className="ml-auto text-xs">
                      {subscribed.includes(id) ? (p.tagline ?? "") : "hors de tes abonnements"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <Dialog.Close
            className="absolute top-3 right-3 flex size-11 items-center justify-center rounded-card hover:bg-white/10"
            aria-label="Fermer"
          >
            <X className="size-5" aria-hidden />
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
