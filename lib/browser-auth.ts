import { createHash } from "node:crypto";
import { SLUG_REGEX } from "./browser-spec";

/**
 * Logique du forwardAuth Traefik (/api/browser-auth), indépendante de Next.js
 * pour être testable. Ne manipule le jeton de session qu'en mémoire : il n'est
 * jamais loggé, et le cache est indexé par son empreinte SHA-256.
 */

export const SESSION_COOKIE_NAMES = ["__Secure-authjs.session-token", "authjs.session-token"];
export const CACHE_TTL_MS = 30_000;

export interface SessionLookup {
  slug: string;
  expires: Date;
}

export type BrowserAuthResult =
  | { status: 200; slug: string }
  | { status: 401; reason: string; requested: string | null }
  | { status: 403; reason: string; requested: string | null; slug: string };

/**
 * Extrait <slug> de /b/<slug>/... SANS normalisation : un chemin ambigu (segments « . »
 * ou « .. », séparateurs encodés %2F/%5C, antislash, « // ») est refusé. Ainsi Traefik
 * (routage), Neko et ce contrôle voient toujours le même slug : impossible d'obtenir
 * l'autorisation pour /b/alice tout en étant routé vers /b/bob.
 */
export function slugFromForwardedUri(uri: string | null): string | null {
  if (!uri) return null;
  const path = uri.split(/[?#]/, 1)[0] ?? "";
  if (!path.startsWith("/b/")) return null;
  if (/%(2f|5c|2e|00)/i.test(path) || path.includes("\\") || path.includes("//")) return null;
  const segments = path.split("/");
  if (segments.some((seg) => seg === "." || seg === "..")) return null;
  const slug = segments[2];
  return slug && SLUG_REGEX.test(slug) ? slug : null;
}

/**
 * Noms de cookie acceptés : en production (AUTH_URL en https), uniquement le cookie
 * « __Secure- » (posé en HTTPS, non falsifiable depuis un sous-domaine en clair).
 */
export function acceptedCookieNames(authUrl = process.env.AUTH_URL ?? ""): string[] {
  return authUrl.startsWith("https://") ? [SESSION_COOKIE_NAMES[0]!] : SESSION_COOKIE_NAMES;
}

export function sessionTokenFromCookie(
  cookieHeader: string | null,
  names: string[] = acceptedCookieNames(),
): string | null {
  if (!cookieHeader) return null;
  const cookies = new Map<string, string>();
  for (const part of cookieHeader.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    cookies.set(part.slice(0, i).trim(), part.slice(i + 1).trim());
  }
  for (const name of names) {
    const v = cookies.get(name);
    if (v) {
      try {
        return decodeURIComponent(v);
      } catch {
        return null;
      }
    }
  }
  return null;
}

const tokenKey = (token: string) => createHash("sha256").update(token).digest("hex");

type CacheEntry = { slug: string | null; until: number };
const cache = new Map<string, CacheEntry>();

export function invalidateBrowserAuthCache(token?: string): void {
  if (token === undefined) cache.clear();
  else cache.delete(tokenKey(token));
}

export async function checkBrowserAccess(
  input: { uri: string | null; cookie: string | null; now?: number },
  lookup: (sessionToken: string) => Promise<SessionLookup | null>,
): Promise<BrowserAuthResult> {
  const now = input.now ?? Date.now();
  const requested = slugFromForwardedUri(input.uri);
  const token = sessionTokenFromCookie(input.cookie);
  if (!token) return { status: 401, reason: "pas de session", requested };

  const key = tokenKey(token);
  let entry = cache.get(key);
  if (!entry || entry.until <= now) {
    const s = await lookup(token);
    const valid = s && s.expires.getTime() > now;
    entry = {
      slug: valid ? s.slug : null,
      until: Math.min(now + CACHE_TTL_MS, valid ? s.expires.getTime() : now + CACHE_TTL_MS),
    };
    cache.set(key, entry);
    if (cache.size > 5000) {
      for (const [k, e] of cache) if (e.until <= now) cache.delete(k);
    }
  }

  if (!entry.slug) return { status: 401, reason: "session invalide", requested };
  if (!requested || requested !== entry.slug) {
    return {
      status: 403,
      reason: "navigateur d'un autre utilisateur",
      requested,
      slug: entry.slug,
    };
  }
  return { status: 200, slug: entry.slug };
}
