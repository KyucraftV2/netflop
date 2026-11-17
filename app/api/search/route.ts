import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireUser } from "@/lib/auth-guard";
import { getDb } from "@/lib/db";
import { userSubscriptions } from "@/lib/db/schema";
import { HttpError, parseQuery, route } from "@/lib/http";
import { searchTitles, TmdbError } from "@/lib/tmdb";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  q: z.string().trim().min(2).max(100),
  all: z.enum(["0", "1"]).optional().default("0"),
});

/**
 * Recherche TMDB (films + séries) avec disponibilité par plateforme.
 * Filtre « mes abonnements » par défaut ; all=1 renvoie tout (les titres hors abonnement
 * sont marqués `available: false`). La clé TMDB reste côté serveur.
 */
export const GET = route(async (req: Request) => {
  const user = await requireUser();
  const { q, all } = parseQuery(req.url, querySchema);
  const subs = new Set(
    (
      await getDb()
        .select({ platform: userSubscriptions.platform })
        .from(userSubscriptions)
        .where(eq(userSubscriptions.userId, user.id))
    ).map((s) => s.platform),
  );

  let results;
  try {
    results = await searchTitles(q);
  } catch (err) {
    if (err instanceof TmdbError) throw new HttpError(502, "Recherche indisponible pour le moment");
    throw err;
  }

  const enriched = results.map((r) => ({
    ...r,
    available: r.platforms.some((p) => subs.has(p)),
  }));
  const filtered = all === "1" ? enriched : enriched.filter((r) => r.available);
  return Response.json(
    {
      query: q,
      filtered: all !== "1",
      results: filtered,
      hiddenCount: enriched.length - filtered.length,
    },
    { headers: { "Cache-Control": "private, max-age=60" } },
  );
});
