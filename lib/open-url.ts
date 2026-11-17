import { directLink } from "./justwatch";
import { PLATFORMS, platformSearchUrl, validateNavigationUrl, type PlatformId } from "./platforms";
import type { MediaType } from "./tmdb";

export type UrlSource = "justwatch" | "search" | "home";

/**
 * URL d'ouverture d'un titre, par ordre de priorité :
 *  a. lien direct JustWatch ;
 *  b. recherche de la plateforme avec le titre ;
 *  c. page d'accueil de la plateforme.
 * Toujours validée par la liste blanche.
 */
export async function titleUrl(params: {
  platform: PlatformId;
  tmdbId: number;
  type: MediaType;
  title: string;
}): Promise<{ url: string; source: UrlSource }> {
  const jw = await directLink(params);
  if (jw && validateNavigationUrl(jw)?.platform === params.platform) {
    return { url: jw, source: "justwatch" };
  }
  const search = platformSearchUrl(params.platform, params.title);
  if (validateNavigationUrl(search)?.platform === params.platform) {
    return { url: search, source: "search" };
  }
  return { url: PLATFORMS[params.platform].homeUrl, source: "home" };
}
