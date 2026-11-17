"use client";

import { ChevronLeft, ChevronRight, Play, X } from "lucide-react";
import Image from "next/image";
import { useRef, useTransition } from "react";
import { removeFromContinue } from "@/app/actions/history";
import { PlatformBadge } from "@/components/platform-badge";
import { useOpenTitle } from "@/lib/client/open-title";
import type { ContinueCard } from "@/lib/watch-history";
import { cn, episodeLabel } from "@/lib/utils";
import { OpeningOverlay } from "./opening-overlay";

export function openInputFor(c: ContinueCard) {
  return {
    platform: c.platform,
    tmdbId: c.tmdbId,
    type: c.type,
    title: c.title,
    season: c.season ?? undefined,
    episode: c.episode ?? undefined,
    // Reprise : la plateforme reprend elle-même à la bonne position.
    resumeUrl: c.kind === "resume" ? (c.resumeUrl ?? undefined) : undefined,
  };
}

/** Rangée à défilement horizontal (scroll-snap, flèches au survol, glisser au doigt). */
export function ContinueRow({ cards }: { cards: ContinueCard[] }) {
  const scroller = useRef<HTMLUListElement>(null);
  const { open, opening } = useOpenTitle();
  const [, start] = useTransition();

  if (cards.length === 0) return null;

  const scrollBy = (dir: 1 | -1) =>
    scroller.current?.scrollBy({
      left: dir * scroller.current.clientWidth * 0.85,
      behavior: "smooth",
    });

  return (
    <section aria-labelledby="continuer-titre" className="group/row relative mt-8">
      <h2 id="continuer-titre" className="text-xl font-bold md:text-2xl">
        Continuer à regarder
      </h2>
      <button
        type="button"
        onClick={() => scrollBy(-1)}
        aria-label="Faire défiler vers la gauche"
        className="absolute top-1/2 -left-4 z-10 hidden size-12 items-center justify-center rounded-pill bg-black/70 opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100 md:flex"
      >
        <ChevronLeft className="size-7" aria-hidden />
      </button>
      <ul
        ref={scroller}
        className="scrollbar-none -mx-4 mt-3 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth px-4 pb-2 md:-mx-8 md:gap-4 md:px-8"
      >
        {cards.map((c) => {
          const ep = episodeLabel(c.season, c.episode);
          return (
            <li
              key={`${c.kind}-${c.progressId}`}
              className="group relative w-[70vw] shrink-0 snap-start sm:w-[42vw] md:w-[28vw] lg:w-[22vw] xl:w-[18vw]"
            >
              <button
                type="button"
                onClick={() => void open(openInputFor(c))}
                className="block w-full text-left"
                aria-label={`${c.kind === "next" ? "Épisode suivant de" : "Reprendre"} ${c.title}${ep ? `, ${ep}` : ""}`}
              >
                <span className="relative block aspect-video overflow-hidden rounded-card bg-surface-2 shadow-card transition-transform duration-200 ease-netflop motion-safe:group-hover:scale-[1.03]">
                  {c.backdropPath || c.posterPath ? (
                    <Image
                      src={`https://image.tmdb.org/t/p/w780${c.backdropPath ?? c.posterPath}`}
                      alt=""
                      fill
                      sizes="(max-width: 640px) 70vw, (max-width: 1024px) 42vw, 22vw"
                      className="object-cover"
                    />
                  ) : null}
                  <span className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />
                  <span className="absolute top-2 left-2 flex items-center gap-1.5">
                    <PlatformBadge id={c.platform} />
                    {c.isNew ? (
                      <span className="rounded-[4px] bg-white px-1.5 py-0.5 text-[11px] font-bold text-black">
                        Nouvel épisode
                      </span>
                    ) : null}
                  </span>
                  <span className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
                    <span className="flex size-12 items-center justify-center rounded-pill bg-white/90 text-black">
                      <Play className="size-6 fill-current" aria-hidden />
                    </span>
                  </span>
                  <span className="absolute inset-x-0 bottom-0 p-3">
                    <span className="line-clamp-1 font-semibold">{c.title}</span>
                    <span className="text-xs text-muted">
                      {c.kind === "next" ? `Épisode suivant · ${ep}` : (ep ?? "Film")}
                    </span>
                  </span>
                  {c.kind === "resume" ? (
                    <span className="absolute inset-x-0 bottom-0 h-1 bg-white/25">
                      <span
                        className="block h-full bg-accent"
                        style={{ width: `${Math.max(2, Math.round(c.percent * 100))}%` }}
                      />
                    </span>
                  ) : null}
                </span>
              </button>
              <button
                type="button"
                onClick={() =>
                  start(async () => void (await removeFromContinue({ id: c.progressId })))
                }
                aria-label={`Retirer ${c.title} de « Continuer à regarder »`}
                className={cn(
                  "absolute top-1 right-1 flex size-11 items-center justify-center rounded-pill bg-black/70 transition-opacity",
                  "opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100",
                )}
              >
                <X className="size-4" aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        onClick={() => scrollBy(1)}
        aria-label="Faire défiler vers la droite"
        className="absolute top-1/2 -right-4 z-10 hidden size-12 items-center justify-center rounded-pill bg-black/70 opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100 md:flex"
      >
        <ChevronRight className="size-7" aria-hidden />
      </button>
      {opening ? <OpeningOverlay title={opening.title} platform={opening.platform} /> : null}
    </section>
  );
}
