import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { PlatformBadge } from "@/components/platform-badge";
import { requirePageUser } from "@/lib/auth-guard";
import { isPlatformId, PLATFORM_LIST } from "@/lib/platforms";
import { cn, episodeLabel, formatDateTime } from "@/lib/utils";
import { historyFor, toConfirmFor } from "@/lib/watch-history";
import { ClearHistoryButton, ConfirmEntry, EntryActions } from "./history-client";

export const metadata: Metadata = { title: "Historique" };
export const dynamic = "force-dynamic";

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ plateforme?: string }>;
}) {
  // Uniquement l'historique de l'utilisateur connecté (aucun accès admin).
  const user = await requirePageUser();
  const { plateforme } = await searchParams;
  const platform = isPlatformId(plateforme) ? plateforme : undefined;
  const [rows, toConfirm] = await Promise.all([
    historyFor(user.id, platform),
    toConfirmFor(user.id),
  ]);

  const chip = (href: string, label: string, active: boolean) => (
    <Link
      key={href}
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "inline-flex min-h-11 items-center rounded-pill border px-4 text-sm",
        active ? "border-white bg-white text-black" : "border-white/25 hover:border-white",
      )}
    >
      {label}
    </Link>
  );

  return (
    <main className="mx-auto max-w-[1100px] px-4 pt-24 md:px-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-bold">Historique</h1>
        <ClearHistoryButton disabled={rows.length + toConfirm.length === 0} />
      </div>
      <p className="mt-1 text-sm text-muted">
        Rempli automatiquement pendant que tu regardes. Toi seul y as accès.
      </p>

      {toConfirm.length > 0 ? (
        <section
          aria-labelledby="a-confirmer"
          className="mt-10 rounded-tile border border-warning/40 bg-warning/5 p-4 md:p-6"
        >
          <h2 id="a-confirmer" className="text-xl font-semibold">
            À confirmer ({toConfirm.length})
          </h2>
          <p className="mt-1 text-sm text-muted">
            On n&apos;est pas sûrs d&apos;avoir reconnu ces contenus : corrige-les ou supprime-les.
          </p>
          <ul className="mt-4 space-y-4">
            {toConfirm.map((r) => (
              <li key={r.id}>
                <ConfirmEntry
                  entry={{
                    id: r.id,
                    rawTitle: r.rawTitle ?? r.title,
                    guess: r.tmdbId ? r.title : null,
                    platform: r.platform,
                    season: r.type === "tv" || r.episode > 0 ? r.season : null,
                    episode: r.episode > 0 ? r.episode : null,
                    lastWatchedAt: formatDateTime(r.lastWatchedAt),
                  }}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <nav aria-label="Filtrer par plateforme" className="mt-10 flex flex-wrap gap-2">
        {chip("/historique", "Toutes", !platform)}
        {PLATFORM_LIST.map((p) =>
          chip(`/historique?plateforme=${p.id}`, p.name, platform === p.id),
        )}
      </nav>

      {rows.length === 0 ? (
        <p className="mt-8 text-muted">
          Rien pour l&apos;instant. Lance une lecture : ça se remplit tout seul.
        </p>
      ) : (
        <ol className="mt-6 divide-y divide-white/5 rounded-tile bg-surface">
          {rows.map((r) => {
            const ep = r.type === "tv" ? episodeLabel(r.season, r.episode) : null;
            return (
              <li key={r.id} className="flex items-center gap-3 p-3 md:gap-4 md:p-4">
                <span className="relative aspect-[2/3] w-12 shrink-0 overflow-hidden rounded-[4px] bg-surface-2 md:w-14">
                  {r.posterPath ? (
                    <Image
                      src={`https://image.tmdb.org/t/p/w185${r.posterPath}`}
                      alt=""
                      fill
                      sizes="56px"
                      className="object-cover"
                    />
                  ) : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{r.title}</span>
                  <span className="block truncate text-xs text-muted">
                    {[ep, r.episodeTitle, formatDateTime(r.lastWatchedAt)]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  <span className="mt-1 flex items-center gap-2">
                    <PlatformBadge id={r.platform} />
                    {r.completed ? (
                      <span className="text-xs text-success">Vu</span>
                    ) : (
                      <span
                        className="h-1 w-20 rounded-pill bg-white/20"
                        aria-label={`${Math.round(r.percent * 100)} % vu`}
                      >
                        <span
                          className="block h-full rounded-pill bg-accent"
                          style={{ width: `${Math.round(r.percent * 100)}%` }}
                        />
                      </span>
                    )}
                  </span>
                </span>
                <EntryActions id={r.id} title={r.title} completed={r.completed} />
              </li>
            );
          })}
        </ol>
      )}
    </main>
  );
}
