import { z } from "zod";
import { cached } from "./cache";
import { errorMessage, logger } from "./log";
import { platformForProviderName, validateNavigationUrl, type PlatformId } from "./platforms";
import type { MediaType } from "./tmdb";

/**
 * Liens directs vers un titre sur une plateforme, via l'API GraphQL NON OFFICIELLE de
 * JustWatch. Fragile par nature :
 *  - activée par JUSTWATCH_ENABLED (true par défaut) ;
 *  - cache 24 h (y compris les « pas de lien ») ;
 *  - coupe-circuit : après 5 erreurs consécutives, désactivée 1 h (log explicite).
 * Toute URL renvoyée est revalidée par la liste blanche de lib/platforms.ts.
 */

const log = logger("justwatch");
const ENDPOINT = "https://apis.justwatch.com/graphql";
const TTL = 24 * 60 * 60;
const MAX_FAILURES = 5;
const COOLDOWN_MS = 60 * 60 * 1000;

const breaker = { failures: 0, disabledUntil: 0 };

export function justWatchEnabled(now = Date.now()): boolean {
  if ((process.env.JUSTWATCH_ENABLED ?? "true").toLowerCase() === "false") return false;
  return now >= breaker.disabledUntil;
}

export function recordJustWatchResult(ok: boolean, now = Date.now()): void {
  if (ok) {
    if (breaker.failures > 0 || breaker.disabledUntil > 0) log.info("JustWatch rétabli");
    breaker.failures = 0;
    breaker.disabledUntil = 0;
    return;
  }
  breaker.failures++;
  if (breaker.failures >= MAX_FAILURES && breaker.disabledUntil <= now) {
    breaker.disabledUntil = now + COOLDOWN_MS;
    log.error("JustWatch désactivé temporairement après des erreurs répétées", {
      failures: breaker.failures,
      retryAt: new Date(breaker.disabledUntil).toISOString(),
    });
  }
}

export function resetJustWatchBreaker(): void {
  breaker.failures = 0;
  breaker.disabledUntil = 0;
}

const QUERY = `
query NetflopSearch($country: Country!, $language: Language!, $first: Int!, $filter: TitleFilter) {
  popularTitles(country: $country, first: $first, filter: $filter) {
    edges {
      node {
        objectType
        content(country: $country, language: $language) {
          title
          originalReleaseYear
          externalIds { tmdbId }
        }
        offers(country: $country, platform: WEB) {
          monetizationType
          standardWebURL
          package { clearName technicalName }
        }
      }
    }
  }
}`;

const responseSchema = z.object({
  data: z
    .object({
      popularTitles: z.object({
        edges: z.array(
          z.object({
            node: z.object({
              objectType: z.string(),
              content: z.object({
                title: z.string().nullish(),
                originalReleaseYear: z.number().nullish(),
                externalIds: z.object({ tmdbId: z.string().nullish() }).nullish(),
              }),
              offers: z
                .array(
                  z.object({
                    monetizationType: z.string(),
                    standardWebURL: z.string().nullish(),
                    package: z.object({
                      clearName: z.string(),
                      technicalName: z.string().nullish(),
                    }),
                  }),
                )
                .nullish(),
            }),
          }),
        ),
      }),
    })
    .nullish(),
  errors: z.array(z.object({ message: z.string() })).nullish(),
});
type JwResponse = z.infer<typeof responseSchema>;

/** Extrait d'une réponse JustWatch le lien flatrate du titre (tmdbId) pour la plateforme. */
export function pickOfferUrl(
  response: JwResponse,
  tmdbId: number,
  type: MediaType,
  platform: PlatformId,
): string | null {
  const wantedType = type === "movie" ? "MOVIE" : "SHOW";
  for (const edge of response.data?.popularTitles.edges ?? []) {
    const node = edge.node;
    if (node.objectType !== wantedType) continue;
    if (node.content.externalIds?.tmdbId !== String(tmdbId)) continue;
    for (const offer of node.offers ?? []) {
      if (!offer.monetizationType.startsWith("FLATRATE")) continue;
      if (platformForProviderName(offer.package.clearName) !== platform) continue;
      const url = offer.standardWebURL;
      if (url && validateNavigationUrl(url)?.platform === platform) return url;
    }
  }
  return null;
}

async function queryJustWatch(title: string): Promise<JwResponse> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      operationName: "NetflopSearch",
      query: QUERY,
      variables: {
        country: "FR",
        language: "fr",
        first: 8,
        filter: { searchQuery: title },
      },
    }),
    signal: AbortSignal.timeout(6_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const parsed = responseSchema.parse(await res.json());
  if (parsed.errors?.length) throw new Error(`GraphQL : ${parsed.errors[0]?.message ?? "erreur"}`);
  return parsed;
}

/** Lien direct vers le titre sur la plateforme, ou null (désactivé, introuvable, erreur). */
export async function directLink(params: {
  title: string;
  tmdbId: number;
  type: MediaType;
  platform: PlatformId;
}): Promise<string | null> {
  if (!justWatchEnabled()) return null;
  const { title, tmdbId, type, platform } = params;
  try {
    const result = await cached(`jw:${type}:${tmdbId}:${platform}`, TTL, async () => {
      const response = await queryJustWatch(title);
      recordJustWatchResult(true);
      return { url: pickOfferUrl(response, tmdbId, type, platform) };
    });
    return result.url;
  } catch (err) {
    recordJustWatchResult(false);
    log.warn("lien JustWatch indisponible", { tmdbId, platform, error: errorMessage(err) });
    return null;
  }
}
