"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { adminClearQueue, adminResetProfile } from "@/app/actions/admin";
import type { ActionResult } from "@/app/actions/profile";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

/** Rafraîchit les données de la page toutes les `seconds` secondes (onglet visible). */
export function AutoRefresh({ seconds = 10 }: { seconds?: number }) {
  const router = useRouter();
  const [on, setOn] = useState(true);
  useEffect(() => {
    if (!on) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => window.clearInterval(id);
  }, [on, seconds, router]);
  return (
    <Button
      variant={on ? "light" : "ghost"}
      size="sm"
      aria-pressed={on}
      onClick={() => setOn((v) => !v)}
      title={`Actualisation automatique toutes les ${seconds} s`}
    >
      <RefreshCw
        aria-hidden
        className={on ? "motion-safe:animate-spin [animation-duration:3s]" : ""}
      />
      {on ? "En direct" : "En pause"}
    </Button>
  );
}

function ConfirmAction({
  label,
  title,
  description,
  confirmLabel,
  run,
  ariaLabel,
  size = "sm",
}: {
  label: string;
  title: string;
  description: string;
  confirmLabel: string;
  run: () => Promise<ActionResult>;
  ariaLabel?: string;
  size?: "sm" | "md";
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="danger" size={size} disabled={pending} aria-label={ariaLabel}>
            {pending ? "…" : label}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent title={title} description={description}>
          <AlertDialogCancel>Annuler</AlertDialogCancel>
          <AlertDialogAction
            onClick={() =>
              start(async () => {
                const r = await run();
                setMsg(
                  r.ok ? { ok: true, text: r.message ?? "Fait" } : { ok: false, text: r.error },
                );
              })
            }
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogContent>
      </AlertDialog>
      {msg ? (
        <span role="status" className={msg.ok ? "text-xs text-muted" : "text-xs text-danger"}>
          {msg.text}
        </span>
      ) : null}
    </span>
  );
}

export function ClearQueueButton() {
  return (
    <ConfirmAction
      label="Vider la file"
      title="Vider la file d'attente ?"
      description="Les personnes en attente devront relancer leur lecture."
      confirmLabel="Vider"
      run={() => adminClearQueue({ confirm: true })}
    />
  );
}

export function ResetProfileButton({ slug, disabled }: { slug: string; disabled?: boolean }) {
  if (disabled) return null;
  return (
    <ConfirmAction
      label="Suppr. profil Chrome"
      ariaLabel={`Supprimer le profil Chrome de ${slug}`}
      title={`Supprimer le profil Chrome de ${slug} ?`}
      description="Ses connexions aux plateformes seront perdues : il devra se reconnecter. Action définitive."
      confirmLabel="Supprimer"
      run={() => adminResetProfile({ slug, confirm: true })}
    />
  );
}
