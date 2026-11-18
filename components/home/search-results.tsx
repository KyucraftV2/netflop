"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import type { PlatformId } from "@/lib/platforms";
import { TitleCard, type TitleCardData } from "./title-card";
import { useTitlePicker } from "./use-title-picker";
import { WatchlistButton } from "./watchlist-button";

interface SearchResponse {
  results: TitleCardData[];
  hiddenCount: number;
}

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "done"; data: SearchResponse }
  | { kind: "error"; message: string };

export function SearchResults({ subscribed }: { subscribed: PlatformId[] }) {
  const params = useSearchParams();
  const q = (params.get("q") ?? "").trim();
  const [onlyMine, setOnlyMine] = useState(true);
  const [state, setState] = useState<State>({ kind: "idle" });
  const { select, overlays, error } = useTitlePicker(subscribed);

  useEffect(() => {
    if (q.length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- réinitialisation sur changement de requête
      setState({ kind: "idle" });
      return;
    }
    const ctrl = new AbortController();
    setState({ kind: "loading" });
    fetch(`/api/search?q=${encodeURIComponent(q)}&all=${onlyMine ? "0" : "1"}`, {
      signal: ctrl.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? "Recherche indisponible");
        }
        return (await res.json()) as SearchResponse;
      })
      .then((data) => setState({ kind: "done", data }))
      .catch((err: unknown) => {
        if ((err as Error).name !== "AbortError") {
          setState({ kind: "error", message: (err as Error).message });
        }
      });
    return () => ctrl.abort();
  }, [q, onlyMine]);

  if (q.length < 2) return null;

  return (
    <section aria-labelledby="resultats" className="mt-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 id="resultats" className="text-xl font-bold md:text-2xl">
          Résultats pour « {q} »
        </h2>
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
          <Switch
            checked={onlyMine}
            onCheckedChange={setOnlyMine}
            aria-label="Mes abonnements uniquement"
          />
          Mes abonnements
        </label>
      </div>

      {error ? (
        <p role="alert" className="mt-4 text-sm text-danger">
          {error}
        </p>
      ) : null}

      {state.kind === "loading" ? (
        <ul
          className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6"
          aria-busy
        >
          {Array.from({ length: 12 }, (_, i) => (
            <li key={i}>
              <Skeleton className="aspect-[2/3] w-full" />
              <Skeleton className="mt-2 h-4 w-3/4" />
            </li>
          ))}
        </ul>
      ) : null}

      {state.kind === "error" ? <p className="mt-6 text-danger">{state.message}</p> : null}

      {state.kind === "done" ? (
        <>
          {state.data.results.length === 0 ? (
            <p className="mt-6 text-muted">
              Aucun résultat{onlyMine ? " sur tes plateformes" : ""}.
              {onlyMine && state.data.hiddenCount > 0 ? (
                <>
                  {" "}
                  <button type="button" className="underline" onClick={() => setOnlyMine(false)}>
                    Afficher {state.data.hiddenCount} titre(s) hors abonnement
                  </button>
                </>
              ) : null}
            </p>
          ) : (
            <ul className="mt-6 grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {state.data.results.map((item) => (
                <li key={`${item.type}-${item.tmdbId}`} className="relative">
                  <TitleCard item={item} subscribed={subscribed} onSelect={select} />
                  <WatchlistButton item={item} className="absolute top-2 right-2" />
                </li>
              ))}
            </ul>
          )}
          {onlyMine && state.data.results.length > 0 && state.data.hiddenCount > 0 ? (
            <p className="mt-4 text-sm text-muted">
              {state.data.hiddenCount} titre(s) masqué(s) car hors de tes abonnements.
            </p>
          ) : null}
        </>
      ) : null}

      {overlays}
    </section>
  );
}
