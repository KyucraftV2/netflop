"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

const GRACE_SECONDS = 5 * 60;

export function StillWatchingDialog({
  open,
  onYes,
  onStop,
}: {
  open: boolean;
  onYes: () => void;
  onStop: () => void;
}) {
  const [left, setLeft] = useState(GRACE_SECONDS);
  useEffect(() => {
    if (!open) return;
    const started = Date.now();
    const id = window.setInterval(() => {
      setLeft(Math.max(0, GRACE_SECONDS - Math.floor((Date.now() - started) / 1000)));
    }, 1000);
    return () => {
      window.clearInterval(id);
      setLeft(GRACE_SECONDS);
    };
  }, [open]);

  const mm = Math.floor(left / 60);
  const ss = String(left % 60).padStart(2, "0");

  return (
    <Dialog.Root open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 z-50 w-[min(92vw,26rem)] -translate-x-1/2 -translate-y-1/2 rounded-tile bg-surface p-6 text-center shadow-pop"
          onEscapeKeyDown={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
        >
          <Dialog.Title className="text-2xl font-bold">Tu regardes toujours ?</Dialog.Title>
          <Dialog.Description className="mt-3 text-muted">
            Sans réponse, ton navigateur s&apos;arrêtera dans {mm}:{ss} pour libérer la place.
          </Dialog.Description>
          <div className="mt-6 flex flex-col gap-3">
            <Button size="lg" onClick={onYes} autoFocus>
              Oui, je regarde
            </Button>
            <Button size="lg" variant="secondary" onClick={onStop}>
              Non, arrêter
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
