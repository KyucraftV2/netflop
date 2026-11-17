import { eq } from "drizzle-orm";
import { Suspense } from "react";
import { ContinueRow } from "@/components/home/continue-row";
import { Hero } from "@/components/home/hero";
import { PlatformTiles } from "@/components/home/platform-tiles";
import { SearchResults } from "@/components/home/search-results";
import { Skeleton } from "@/components/ui/skeleton";
import { requirePageUser } from "@/lib/auth-guard";
import { getDb } from "@/lib/db";
import { userSubscriptions } from "@/lib/db/schema";
import { logger, errorMessage } from "@/lib/log";
import { continueWatching } from "@/lib/watch-history";

const log = logger("home");

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ toutes?: string; q?: string }>;
}) {
  const user = await requirePageUser();
  const { toutes, q } = await searchParams;
  const subscribed = (
    await getDb()
      .select({ platform: userSubscriptions.platform })
      .from(userSubscriptions)
      .where(eq(userSubscriptions.userId, user.id))
  ).map((s) => s.platform);
  const searching = (q ?? "").trim().length >= 2;

  return (
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
          <PlatformTiles subscribed={subscribed} showAll={toutes === "1"} />
        </>
      )}
    </main>
  );
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
