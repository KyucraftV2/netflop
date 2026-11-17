"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { setInWatchlist } from "@/app/actions/watchlist";
import type { TitleCardData } from "./title-card";

interface WatchlistState {
  has: (item: Pick<TitleCardData, "type" | "tmdbId">) => boolean;
  toggle: (item: TitleCardData) => Promise<string | null>;
}

const Ctx = createContext<WatchlistState | null>(null);
const keyOf = (i: Pick<TitleCardData, "type" | "tmdbId">) => `${i.type}-${i.tmdbId}`;

/** État partagé de « Ma liste » (boutons de la recherche et de la rangée d'accueil). */
export function WatchlistProvider({
  initial,
  children,
}: {
  initial: string[];
  children: ReactNode;
}) {
  const [keys, setKeys] = useState(() => new Set(initial));

  const has = useCallback(
    (i: Pick<TitleCardData, "type" | "tmdbId">) => keys.has(keyOf(i)),
    [keys],
  );

  const toggle = useCallback(
    async (item: TitleCardData): Promise<string | null> => {
      const key = keyOf(item);
      const add = !keys.has(key);
      const apply = (on: boolean) =>
        setKeys((prev) => {
          const next = new Set(prev);
          if (on) next.add(key);
          else next.delete(key);
          return next;
        });
      apply(add); // optimiste
      const res = await setInWatchlist(
        add
          ? {
              inList: true,
              item: {
                tmdbId: item.tmdbId,
                type: item.type,
                title: item.title,
                year: item.year,
                posterPath: item.posterPath,
                platforms: item.platforms,
              },
            }
          : { inList: false, item: { tmdbId: item.tmdbId, type: item.type } },
      ).catch(() => ({ ok: false as const, error: "Impossible de modifier ta liste." }));
      if (!res.ok) {
        apply(!add);
        return res.error;
      }
      return null;
    },
    [keys],
  );

  const value = useMemo(() => ({ has, toggle }), [has, toggle]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWatchlist(): WatchlistState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWatchlist hors de WatchlistProvider");
  return v;
}
