import { eq } from "drizzle-orm";
import { Suspense } from "react";
import { ContinueRow } from "@/components/home/continue-row";
import { Hero } from "@/components/home/hero";
import { PlatformTiles } from "@/components/home/platform-tiles";
import { PosterRow } from "@/components/home/poster-row";
import { SearchResults } from "@/components/home/search-results";
import { WatchlistProvider } from "@/components/home/watchlist-context";
import { Skeleton } from "@/components/ui/skeleton";
import { requirePageUser } from "@/lib/auth-guard";
import { getDb } from "@/lib/db";
import { userSubscriptions } from "@/lib/db/schema";
import { logger, errorMessage } from "@/lib/log";
import { continueWatching } from "@/lib/watch-history";
import { forYou } from "@/lib/recommendations";
import { listWatchlist, watchlistKeys } from "@/lib/watchlist";

const log = logger("home");

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ toutes?: string; q?: string }>;
}) {
  const user = await requirePageUser();
  const { toutes, q } = await searchParams;
  const subscribed = await getSubscribed(user.id);
  const searching = (q ?? "").trim().length >= 2;
  const inList = await watchlistKeys(user.id);

  return (
    <WatchlistProvider initial={inList}>
      <main className="mx-auto max-w-[1600px] px-4 md:px-8">
        {searching ? (
          <div className="pt-20 md:pt-24">
            <Suspense fallback={null}>
              <SearchResults subscribed={subscribed} />
            </Suspense>
          </div>
        ) : (
          <>
            <Suspense fallback={<HeroAndRowSkeleton />}>
              <ContinueSection userId={user.id} name={user.displayName} />
            </Suspense>
            {inList.length > 0 ? (
              <Suspense fallback={<RowSkeleton />}>
                <WatchlistSection userId={user.id} subscribed={subscribed} />
              </Suspense>
            ) : null}
            <Suspense fallback={null}>
              <ForYouSection userId={user.id} subscribed={subscribed} />
            </Suspense>
            <PlatformTiles subscribed={subscribed} showAll={toutes === "1"} />
          </>
        )}
      </main>
    </WatchlistProvider>
  );
}

async function getSubscribed(userId: string) {
  return (
    await getDb()
      .select({ platform: userSubscriptions.platform })
      .from(userSubscriptions)
      .where(eq(userSubscriptions.userId, userId))
  ).map((s) => s.platform);
}

async function ContinueSection({ userId, name }: { userId: string; name: string }) {
  const cards = await continueWatching(userId).catch((err: unknown) => {
    log.warn("continuer à regarder", { error: errorMessage(err) });
    return [];
  });
  return (
    <>
      <Hero card={cards[0] ?? null} name={name} />
      <ContinueRow cards={cards} />
    </>
  );
}

async function WatchlistSection({
  userId,
  subscribed,
}: {
  userId: string;
  subscribed: Awaited<ReturnType<typeof getSubscribed>>;
}) {
  const items = await listWatchlist(userId).catch((err: unknown) => {
    log.warn("ma liste", { error: errorMessage(err) });
    return [];
  });
  return (
    <PosterRow
      id="ma-liste-titre"
      title="Ma liste"
      subscribed={subscribed}
      items={items.map((i) => ({
        ...i,
        available: i.platforms.some((p) => subscribed.includes(p)),
      }))}
    />
  );
}

async function ForYouSection({
  userId,
  subscribed,
}: {
  userId: string;
  subscribed: Awaited<ReturnType<typeof getSubscribed>>;
}) {
  const items = await forYou(userId, subscribed).catch((err: unknown) => {
    log.warn("pour toi", { error: errorMessage(err) });
    return [];
  });
  return (
    <PosterRow
      id="pour-toi-titre"
      title="Pour toi"
      subscribed={subscribed}
      items={items.map((i) => ({
        tmdbId: i.tmdbId,
        type: i.type,
        title: i.title,
        year: i.year,
        posterPath: i.posterPath,
        platforms: i.platforms,
        available: true,
      }))}
    />
  );
}

function RowSkeleton() {
  return (
    <div className="mt-8">
      <Skeleton className="h-6 w-40" />
      <div className="mt-3 flex gap-3 overflow-hidden">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton
            key={i}
            className="aspect-[2/3] w-[38vw] shrink-0 sm:w-[26vw] md:w-[18vw] lg:w-[14vw]"
          />
        ))}
      </div>
    </div>
  );
}

function HeroAndRowSkeleton() {
  return (
    <div className="pt-24">
      <Skeleton className="h-[40vh] w-full" />
      <Skeleton className="mt-8 h-6 w-56" />
      <div className="mt-3 flex gap-3 overflow-hidden">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton
            key={i}
            className="aspect-video w-[70vw] shrink-0 sm:w-[42vw] md:w-[28vw] lg:w-[22vw]"
          />
        ))}
      </div>
    </div>
  );
}
