import { PLATFORM_LIST } from "./platforms";

/**
 * Liste blanche d'URL de Chrome (politique URLAllowlist), générée depuis lib/platforms.ts.
 * Fichier produit : browser/policies-allowlist.json (`bun run allowlist`), copié dans
 * l'image navigateur quand NETFLOP_URL_ALLOWLIST=1.
 */

/** Pages locales de l'image navigateur. */
const LOCAL = ["file:///opt/netflop/home/", "about:blank"];

/**
 * Domaines communs à plusieurs plateformes : connexion (Google, Apple, Facebook),
 * captchas, CDN génériques et DRM Widevine. Sans eux, une connexion ou une lecture
 * peut échouer sans message clair.
 */
export const COMMON_DOMAINS = [
  // Connexion avec un compte tiers
  "accounts.google.com",
  "appleid.apple.com",
  "idmsa.apple.com",
  "www.facebook.com",
  // Captchas
  "gstatic.com",
  "googleapis.com",
  "recaptcha.net",
  "www.google.com/recaptcha",
  "hcaptcha.com",
  "challenges.cloudflare.com",
  // CDN génériques
  "akamaihd.net",
  "akamaized.net",
  "cloudfront.net",
  "fastly.net",
  // DRM
  "widevine.com",
];

/**
 * Domaines supplémentaires par plateforme (CDN, images) qui ne doivent pas servir de
 * cible de navigation pour le hub et ne figurent donc pas dans `allowedDomains`.
 */
export const EXTRA_DOMAINS: Partial<Record<string, string[]>> = {
  netflix: ["nflximg.com", "nflxso.net"],
  canalplus: ["canal-plus.net"],
  francetv: ["francetelevisions.fr"],
};

export function buildAllowlist(): { URLBlocklist: string[]; URLAllowlist: string[] } {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (d: string) => {
    if (!seen.has(d)) {
      seen.add(d);
      out.push(d);
    }
  };
  LOCAL.forEach(add);
  for (const p of PLATFORM_LIST) {
    p.allowedDomains.forEach(add);
    (EXTRA_DOMAINS[p.id] ?? []).forEach(add);
  }
  COMMON_DOMAINS.forEach(add);
  return { URLBlocklist: ["*"], URLAllowlist: out };
}

export function allowlistJson(): string {
  return `${JSON.stringify(buildAllowlist(), null, 2)}\n`;
}
