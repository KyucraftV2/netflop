"use client";

import { Check, RotateCcw, Search, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { clearHistory, confirmEntry, markWatched, removeHistoryEntry } from "@/app/actions/history";
import { PlatformBadge } from "@/components/platform-badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { PlatformId } from "@/lib/platforms";

export function EntryActions({
  id,
  title,
  completed,
}: {
  id: number;
  title: string;
  completed: boolean;
}) {
  const [pending, start] = useTransition();
  return (
    <span className="flex shrink-0 items-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        disabled={pending}
        onClick={() => start(async () => void (await markWatched({ id, watched: !completed })))}
        aria-label={
          completed ? `Marquer « ${title} » comme pas vu` : `Marquer « ${title} » comme vu`
        }
        title={completed ? "Marquer comme pas vu" : "Marquer comme vu"}
      >
        {completed ? <RotateCcw /> : <Check />}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        disabled={pending}
        onClick={() => start(async () => void (await removeHistoryEntry({ id })))}
        aria-label={`Supprimer « ${title} » de l'historique`}
        title="Supprimer"
      >
        <Trash2 />
      </Button>
    </span>
  );
}

export function ClearHistoryButton({ disabled }: { disabled: boolean }) {
  const [pending, start] = useTransition();
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="danger" size="sm" disabled={disabled || pending}>
          <Trash2 aria-hidden /> Supprimer tout mon historique
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent
        title="Supprimer tout ton historique ?"
        description="« Continuer à regarder » sera vidé. Cette action est définitive."
      >
        <AlertDialogCancel>Annuler</AlertDialogCancel>
        <AlertDialogAction
          onClick={() => start(async () => void (await clearHistory({ confirm: true })))}
        >
          Tout supprimer
        </AlertDialogAction>
      </AlertDialogContent>
    </AlertDialog>
  );
}

interface Hit {
  tmdbId: number;
  type: "movie" | "tv";
  title: string;
  year: number | null;
}

export function ConfirmEntry({
  entry,
}: {
  entry: {
    id: number;
    rawTitle: string;
    guess: string | null;
    platform: PlatformId;
    season: number | null;
    episode: number | null;
    lastWatchedAt: string;
  };
}) {
  const [query, setQuery] = useState(entry.rawTitle);
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [season, setSeason] = useState(entry.season ?? 1);
  const [episode, setEpisode] = useState(entry.episode ?? 1);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const search = async () => {
    setMsg(null);
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}&all=1`);
    if (!res.ok) {
      setMsg("Recherche indisponible.");
      return;
    }
    const data = (await res.json()) as { results: Hit[] };
    setHits(data.results.slice(0, 8));
  };

  return (
    <div className="rounded-card bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <PlatformBadge id={entry.platform} />
        <span className="font-semibold">« {entry.rawTitle} »</span>
        {entry.episode ? (
          <span className="text-xs text-muted">
            S{entry.season ?? 1} · É{entry.episode}
          </span>
        ) : null}
        <span className="text-xs text-muted">· {entry.lastWatchedAt}</span>
      </div>
      {entry.guess ? <p className="mt-1 text-sm text-muted">Proposition : {entry.guess}</p> : null}
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <label htmlFor={`fix-${entry.id}`} className="sr-only">
          Rechercher le bon titre
        </label>
        <input
          id={`fix-${entry.id}`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="min-h-11 min-w-0 flex-1 rounded-card bg-surface-2 px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-white"
        />
        <Button type="submit" variant="secondary" size="icon" aria-label="Rechercher">
          <Search />
        </Button>
        <Button
          type="button"
          variant="danger"
          size="icon"
          aria-label="Supprimer cette entrée"
          disabled={pending}
          onClick={() => start(async () => void (await removeHistoryEntry({ id: entry.id })))}
        >
          <Trash2 />
        </Button>
      </form>
      {hits ? (
        hits.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Aucun résultat.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {hits.map((h) => (
              <li key={`${h.type}-${h.tmdbId}`} className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 text-sm">
                  {h.title} {h.year ? `(${h.year})` : ""} · {h.type === "tv" ? "Série" : "Film"}
                </span>
                {h.type === "tv" ? (
                  <span className="flex items-center gap-1 text-xs">
                    <label>
                      S
                      <input
                        type="number"
                        min={1}
                        value={season}
                        onChange={(e) => setSeason(Number(e.target.value))}
                        className="ml-1 h-9 w-14 rounded bg-surface-2 px-2"
                      />
                    </label>
                    <label>
                      É
                      <input
                        type="number"
                        min={1}
                        value={episode}
                        onChange={(e) => setEpisode(Number(e.target.value))}
                        className="ml-1 h-9 w-16 rounded bg-surface-2 px-2"
                      />
                    </label>
                  </span>
                ) : null}
                <Button
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const r = await confirmEntry({
                        id: entry.id,
                        tmdbId: h.tmdbId,
                        type: h.type,
                        ...(h.type === "tv" ? { season, episode } : {}),
                      });
                      setMsg(r.ok ? (r.message ?? "OK") : r.error);
                    })
                  }
                >
                  C&apos;est celui-ci
                </Button>
              </li>
            ))}
          </ul>
        )
      ) : null}
      {msg ? (
        <p role="status" className="mt-2 text-sm">
          {msg}
        </p>
      ) : null}
    </div>
  );
}
