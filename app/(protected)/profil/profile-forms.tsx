"use client";

import { useState, useTransition } from "react";
import { resetBrowser, saveSubscriptions, saveVideoQuality } from "@/app/actions/profile";
import { PlatformPicker } from "@/components/platform-picker";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { PlatformId } from "@/lib/platforms";
import { cn } from "@/lib/utils";

function Feedback({ msg }: { msg: { ok: boolean; text: string } | null }) {
  if (!msg) return null;
  return (
    <p role="status" className={cn("mt-3 text-sm", msg.ok ? "text-success" : "text-danger")}>
      {msg.text}
    </p>
  );
}

export function SubscriptionsForm({ initial }: { initial: PlatformId[] }) {
  const [value, setValue] = useState<PlatformId[]>(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="mt-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await saveSubscriptions({ platforms: value });
          setMsg(
            r.ok ? { ok: true, text: r.message ?? "Enregistré" } : { ok: false, text: r.error },
          );
        });
      }}
    >
      <PlatformPicker value={value} onChange={setValue} disabled={pending} />
      <Button type="submit" className="mt-4" disabled={pending}>
        {pending ? "Enregistrement…" : "Enregistrer"}
      </Button>
      <Feedback msg={msg} />
    </form>
  );
}

export function BrowserCard({ running }: { running: boolean | null }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="mt-4 rounded-tile bg-surface p-5">
      <p className="flex items-center gap-2">
        <span
          aria-hidden
          className={cn(
            "size-2.5 rounded-pill",
            running === null ? "bg-warning" : running ? "bg-success" : "bg-surface-3",
          )}
        />
        {running === null ? "État inconnu" : running ? "En cours" : "Éteint"}
      </p>
      <p className="mt-3 text-sm text-muted">
        Réinitialiser efface ton profil de navigateur (connexions aux plateformes, cookies) : utile
        pour changer de compte Netflix ou en cas de bug.
      </p>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="danger" className="mt-4" disabled={pending || running !== false}>
            Réinitialiser mon navigateur
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent
          title="Réinitialiser ton navigateur ?"
          description="Tu devras te reconnecter à Netflix, Canal+ et france.tv à ta prochaine séance. Cette action est définitive."
        >
          <AlertDialogCancel>Annuler</AlertDialogCancel>
          <AlertDialogAction
            onClick={() =>
              start(async () => {
                const r = await resetBrowser({ confirm: true });
                setMsg(
                  r.ok ? { ok: true, text: r.message ?? "Fait" } : { ok: false, text: r.error },
                );
              })
            }
          >
            Réinitialiser
          </AlertDialogAction>
        </AlertDialogContent>
      </AlertDialog>
      {running ? (
        <p className="mt-2 text-xs text-muted">Quitte d&apos;abord ta séance en cours.</p>
      ) : null}
      <Feedback msg={msg} />
    </div>
  );
}

export function QualityForm({ initial }: { initial: "normal" | "saver" }) {
  const [value, setValue] = useState(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const options = [
    { id: "normal", label: "Normale (720p)", hint: "Meilleure image" },
    { id: "saver", label: "Économie de données (480p)", hint: "Débit réduit, idéal en 4G" },
  ] as const;
  return (
    <fieldset className="mt-4 grid gap-3 sm:grid-cols-2" disabled={pending}>
      <legend className="sr-only">Qualité vidéo</legend>
      {options.map((o) => (
        <label
          key={o.id}
          className={cn(
            "flex min-h-16 cursor-pointer items-center gap-3 rounded-tile border-2 bg-surface p-4 has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-white",
            value === o.id ? "border-white" : "border-transparent",
          )}
        >
          <input
            type="radio"
            name="quality"
            value={o.id}
            checked={value === o.id}
            className="size-5 accent-[#e50914]"
            onChange={() => {
              setValue(o.id);
              start(async () => {
                const r = await saveVideoQuality({ quality: o.id });
                setMsg(
                  r.ok ? { ok: true, text: r.message ?? "Fait" } : { ok: false, text: r.error },
                );
              });
            }}
          />
          <span>
            <span className="block font-semibold">{o.label}</span>
            <span className="block text-xs text-muted">{o.hint}</span>
          </span>
        </label>
      ))}
      <div className="sm:col-span-2">
        <Feedback msg={msg} />
      </div>
    </fieldset>
  );
}
