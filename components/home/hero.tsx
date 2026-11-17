"use client";

import { Play } from "lucide-react";
import Image from "next/image";
import { Logo } from "@/components/logo";
import { PlatformBadge } from "@/components/platform-badge";
import { Button } from "@/components/ui/button";
import { useOpenTitle } from "@/lib/client/open-title";
import type { ContinueCard } from "@/lib/watch-history";
import { episodeLabel } from "@/lib/utils";
import { openInputFor } from "./continue-row";
import { OpeningOverlay } from "./opening-overlay";

/** Bannière : dernier élément de « Continuer à regarder », sinon accueil simple. */
export function Hero({ card, name }: { card: ContinueCard | null; name: string }) {
  const { open, opening } = useOpenTitle();
  if (!card) {
    return (
      <section className="relative -mx-4 overflow-hidden bg-[radial-gradient(ellipse_at_top_left,#5a0b10_0%,#141414_65%)] px-4 pt-24 pb-12 md:-mx-8 md:px-8 md:pt-32 md:pb-16">
        <Logo href={null} className="text-4xl md:text-6xl" />
        <h1 className="mt-4 max-w-2xl text-2xl font-bold md:text-4xl">Bonsoir {name} !</h1>
        <p className="mt-2 max-w-xl text-muted md:text-lg">
          Choisis une plateforme ou cherche un titre : on lance ton navigateur et on ouvre la bonne
          page.
        </p>
      </section>
    );
  }
  const ep = episodeLabel(card.season, card.episode);
  return (
    <section className="relative -mx-4 flex min-h-[56vh] items-end overflow-hidden md:-mx-8 md:min-h-[70vh]">
      {card.backdropPath ? (
        <Image
          src={`https://image.tmdb.org/t/p/w1280${card.backdropPath}`}
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover"
        />
      ) : null}
      <div className="absolute inset-0 bg-gradient-to-r from-bg via-bg/60 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-t from-bg via-transparent to-black/40" />
      <div className="relative px-4 pt-28 pb-10 md:px-8 md:pb-16">
        <PlatformBadge id={card.platform} />
        <h1 className="mt-3 max-w-3xl text-3xl font-black md:text-6xl">{card.title}</h1>
        <p className="mt-2 text-muted md:text-lg">
          {card.kind === "next"
            ? `Épisode suivant · ${ep}`
            : ep
              ? `${ep} · en cours`
              : "Film en cours"}
        </p>
        {card.kind === "resume" ? (
          <div className="mt-3 h-1 w-56 rounded-pill bg-white/25" aria-hidden>
            <div
              className="h-full rounded-pill bg-accent"
              style={{ width: `${Math.round(card.percent * 100)}%` }}
            />
          </div>
        ) : null}
        <Button
          size="lg"
          variant="light"
          className="mt-6"
          onClick={() => void open(openInputFor(card))}
        >
          <Play className="fill-current" aria-hidden />{" "}
          {card.kind === "next" ? "Regarder" : "Reprendre"}
        </Button>
      </div>
      {opening ? <OpeningOverlay title={opening.title} platform={opening.platform} /> : null}
    </section>
  );
}
