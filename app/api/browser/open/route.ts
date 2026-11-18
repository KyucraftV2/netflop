import { z } from "zod";
import { requireUser } from "@/lib/auth-guard";
import { rememberConnectionHint, startAndOpen } from "@/lib/browser-service";
import { parseJson, route } from "@/lib/http";
import { logger } from "@/lib/log";
import { titleUrl } from "@/lib/open-url";
import { isPlatformEnabled, PLATFORM_IDS, validateNavigationUrl } from "@/lib/platforms";

export const dynamic = "force-dynamic";

const log = logger("open");

const bodySchema = z
  .object({
    platform: z.enum(PLATFORM_IDS).refine((p) => isPlatformEnabled(p), "plateforme désactivée"),
    tmdbId: z.number().int().positive().max(100_000_000),
    type: z.enum(["movie", "tv"]),
    title: z.string().trim().min(1).max(200),
    season: z.number().int().min(0).max(500).optional(),
    episode: z.number().int().min(0).max(5000).optional(),
    /** URL de reprise connue (« Continuer à regarder ») : revalidée par liste blanche. */
    resumeUrl: z.string().url().max(2000).optional(),
    /** Estimation de la connexion (qualité « auto »). */
    connection: z.enum(["fast", "slow"]).optional(),
  })
  .strict();

/**
 * Ouvre un titre dans le Chrome de l'utilisateur : démarre le navigateur s'il est éteint
 * (navigation dès qu'il est prêt) ou navigue directement s'il tourne déjà.
 */
export const POST = route(async (req: Request) => {
  const user = await requireUser();
  const body = await parseJson(req, bodySchema);
  if (body.connection) await rememberConnectionHint(user.id, body.connection);

  let target: { url: string; source: string };
  const resume = body.resumeUrl ? validateNavigationUrl(body.resumeUrl) : null;
  if (resume && resume.platform === body.platform) {
    target = { url: resume.url.toString(), source: "reprise" };
  } else {
    target = await titleUrl(body);
  }
  log.info("ouverture d'un titre", {
    user: user.slug,
    platform: body.platform,
    tmdbId: body.tmdbId,
    source: target.source,
  });

  const status = await startAndOpen(user.id, {
    platform: body.platform,
    url: target.url,
    opened: {
      platform: body.platform,
      url: target.url,
      tmdbId: body.tmdbId,
      type: body.type,
      title: body.title,
      season: body.season,
      episode: body.episode,
      openedAt: new Date().toISOString(),
    },
  });
  return Response.json(
    { ...status, source: target.source, watchUrl: `/watch/${body.platform}?opened=1` },
    { headers: { "Cache-Control": "no-store" } },
  );
});
