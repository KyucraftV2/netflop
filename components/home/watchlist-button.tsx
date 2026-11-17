"use client";

import { Check, Plus } from "lucide-react";
import { useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import type { TitleCardData } from "./title-card";
import { useWatchlist } from "./watchlist-context";

/** Bouton rond « + / ✓ » posé sur une affiche. */
export function WatchlistButton({ item, className }: { item: TitleCardData; className?: string }) {
  const { has, toggle } = useWatchlist();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const inList = has(item);
  return (
    <>
      <button
        type="button"
        aria-pressed={inList}
        aria-label={
          inList ? `Retirer de ma liste : ${item.title}` : `Ajouter à ma liste : ${item.title}`
        }
        title={error ?? (inList ? "Retirer de ma liste" : "Ajouter à ma liste")}
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(await toggle(item));
          })
        }
        className={cn(
          "flex size-11 items-center justify-center rounded-pill border border-white/60 bg-black/70 text-white backdrop-blur transition-colors hover:border-white hover:bg-black/90 disabled:opacity-60",
          inList && "border-white bg-white text-black hover:bg-white/90",
          className,
        )}
      >
        {inList ? (
          <Check className="size-5" aria-hidden />
        ) : (
          <Plus className="size-5" aria-hidden />
        )}
      </button>
      {error ? (
        <span role="alert" className="sr-only">
          {error}
        </span>
      ) : null}
    </>
  );
}
