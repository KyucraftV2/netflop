"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRef, type ReactNode } from "react";
import type { PlatformId } from "@/lib/platforms";
import { TitleCard, type TitleCardData } from "./title-card";
import { useTitlePicker } from "./use-title-picker";
import { WatchlistButton } from "./watchlist-button";

/** Rangée d'affiches à défilement horizontal (Ma liste, Pour toi…). */
export function PosterRow({
  id,
  title,
  items,
  subscribed,
  empty,
}: {
  id: string;
  title: string;
  items: TitleCardData[];
  subscribed: PlatformId[];
  /** Contenu affiché si la rangée est vide (sinon elle est masquée). */
  empty?: ReactNode;
}) {
  const scroller = useRef<HTMLUListElement>(null);
  const { select, overlays, error } = useTitlePicker(subscribed);

  if (items.length === 0 && !empty) return null;

  const scrollBy = (dir: 1 | -1) =>
    scroller.current?.scrollBy({
      left: dir * scroller.current.clientWidth * 0.85,
      behavior: "smooth",
    });

  return (
    <section aria-labelledby={id} className="group/row relative mt-8">
      <h2 id={id} className="text-xl font-bold md:text-2xl">
        {title}
      </h2>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
      {items.length === 0 ? (
        <div className="mt-3 text-muted">{empty}</div>
      ) : (
        <>
          <button
            type="button"
            onClick={() => scrollBy(-1)}
            aria-label={`Faire défiler « ${title} » vers la gauche`}
            className="absolute top-1/2 -left-4 z-10 hidden size-12 items-center justify-center rounded-pill bg-black/70 opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100 md:flex"
          >
            <ChevronLeft className="size-7" aria-hidden />
          </button>
          <ul
            ref={scroller}
            className="scrollbar-none -mx-4 mt-3 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth px-4 pb-2 md:-mx-8 md:gap-4 md:px-8"
          >
            {items.map((item) => (
              <li
                key={`${item.type}-${item.tmdbId}`}
                className="relative w-[38vw] shrink-0 snap-start sm:w-[26vw] md:w-[18vw] lg:w-[14vw] xl:w-[11vw]"
              >
                <TitleCard item={item} subscribed={subscribed} onSelect={select} />
                <WatchlistButton item={item} className="absolute top-2 right-2" />
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => scrollBy(1)}
            aria-label={`Faire défiler « ${title} » vers la droite`}
            className="absolute top-1/2 -right-4 z-10 hidden size-12 items-center justify-center rounded-pill bg-black/70 opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100 md:flex"
          >
            <ChevronRight className="size-7" aria-hidden />
          </button>
        </>
      )}
      {overlays}
    </section>
  );
}
