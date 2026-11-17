"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, Moon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { SLEEP_MINUTES } from "@/lib/sleep";
import { cn } from "@/lib/utils";

export type SleepState = { at: string | null; afterEpisode: boolean };
export type SleepChoice = { mode: "off" | "episode" } | { minutes: number };

const itemClass =
  "flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-card px-3 text-sm outline-none data-[highlighted]:bg-white/10";

function remaining(at: string, now: number): string {
  const min = Math.max(0, Math.round((new Date(at).getTime() - now) / 60_000));
  return min >= 60
    ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}`
    : `${min} min`;
}

/** Minuteur de sommeil : arrêt du navigateur dans N minutes ou à la fin de l'épisode. */
export function SleepMenu({
  sleep,
  onChoose,
  disabled,
}: {
  sleep: SleepState;
  onChoose: (c: SleepChoice) => void;
  disabled?: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!sleep.at) return;
    const id = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, [sleep.at]);

  const active = sleep.afterEpisode || sleep.at !== null;
  const label = sleep.afterEpisode
    ? "Arrêt à la fin de l'épisode"
    : sleep.at
      ? `Arrêt dans ${remaining(sleep.at, now)}`
      : "Minuteur de sommeil";

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild disabled={disabled}>
        <Button
          variant={active ? "light" : "ghost"}
          size={active ? "sm" : "icon"}
          aria-label={label}
          title={label}
          className={cn(active && "min-h-11 gap-1.5")}
        >
          <Moon aria-hidden />
          {sleep.at && !sleep.afterEpisode ? (
            <span className="text-xs">{remaining(sleep.at, now)}</span>
          ) : null}
        </Button>
      </DropdownMenu.Trigger>
      {/* Pas de Portal : le menu doit rester dans l'élément en plein écran. */}
      <DropdownMenu.Content
        align="end"
        sideOffset={8}
        className="z-50 min-w-60 rounded-tile border border-white/10 bg-surface p-2 shadow-pop"
      >
        <DropdownMenu.Label className="px-3 py-2 text-sm font-semibold">
          Minuteur de sommeil
        </DropdownMenu.Label>
        <DropdownMenu.Separator className="my-1 h-px bg-white/10" />
        <DropdownMenu.Item className={itemClass} onSelect={() => onChoose({ mode: "episode" })}>
          <Check className={cn("size-4", !sleep.afterEpisode && "invisible")} aria-hidden />
          Fin de l&apos;épisode ou du film
        </DropdownMenu.Item>
        {SLEEP_MINUTES.map((m) => (
          <DropdownMenu.Item
            key={m}
            className={itemClass}
            onSelect={() => onChoose({ minutes: m })}
          >
            <span className="size-4" aria-hidden />
            Dans {m >= 60 ? `${m / 60} h${m % 60 ? ` ${m % 60}` : ""}` : `${m} min`}
          </DropdownMenu.Item>
        ))}
        {active ? (
          <>
            <DropdownMenu.Separator className="my-1 h-px bg-white/10" />
            <DropdownMenu.Item className={itemClass} onSelect={() => onChoose({ mode: "off" })}>
              <span className="size-4" aria-hidden />
              Désactiver
            </DropdownMenu.Item>
          </>
        ) : null}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}
