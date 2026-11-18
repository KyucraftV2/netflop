"use client";

import { useState } from "react";
import { useOpenTitle } from "@/lib/client/open-title";
import type { PlatformId } from "@/lib/platforms";
import { OpeningOverlay } from "./opening-overlay";
import { PlatformChooser } from "./platform-chooser";
import type { TitleCardData } from "./title-card";

/**
 * Ouverture d'un titre choisi dans une grille : directe s'il n'y a qu'une plateforme
 * possible (parmi les abonnements en priorité), sinon via le sélecteur de plateforme.
 */
export function useTitlePicker(subscribed: PlatformId[]) {
  const [choosing, setChoosing] = useState<TitleCardData | null>(null);
  const { open, opening, error } = useOpenTitle();

  const select = (item: TitleCardData) => {
    const mine = item.platforms.filter((p) => subscribed.includes(p));
    const candidates = mine.length > 0 ? mine : item.platforms;
    if (candidates.length === 1) {
      void open({
        platform: candidates[0]!,
        tmdbId: item.tmdbId,
        type: item.type,
        title: item.title,
      });
    } else {
      setChoosing(item);
    }
  };

  const overlays = (
    <>
      <PlatformChooser
        title={choosing?.title ?? null}
        platforms={choosing?.platforms ?? []}
        subscribed={subscribed}
        onClose={() => setChoosing(null)}
        onChoose={(platform) => {
          const item = choosing;
          setChoosing(null);
          if (item)
            void open({ platform, tmdbId: item.tmdbId, type: item.type, title: item.title });
        }}
      />
      {opening ? <OpeningOverlay title={opening.title} platform={opening.platform} /> : null}
    </>
  );

  return { select, overlays, error };
}
