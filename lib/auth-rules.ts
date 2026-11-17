import { z } from "zod";

/**
 * Règles d'accès et de profil Authentik, sans dépendance à Next.js (testables).
 */

export const ACCESS_GROUP = "netflop";
export const ADMIN_GROUP = "netflop-admins";
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/** Claims Authentik utilisés (le reste est ignoré). */
const claimsSchema = z.object({
  sub: z.string().min(1),
  email: z.string().nullish(),
  name: z.string().nullish(),
  preferred_username: z.string().nullish(),
  nickname: z.string().nullish(),
  picture: z.string().nullish(),
  groups: z.array(z.string()).nullish(),
});
export type Claims = z.infer<typeof claimsSchema>;

export function parseClaims(profile: unknown): Claims | null {
  const r = claimsSchema.safeParse(profile);
  return r.success ? r.data : null;
}

export function hasAccess(claims: Pick<Claims, "groups"> | null): boolean {
  return Boolean(claims?.groups?.includes(ACCESS_GROUP));
}

export function roleFromGroups(groups: string[] | null | undefined): "user" | "admin" {
  return groups?.includes(ADMIN_GROUP) ? "admin" : "user";
}

export function profileFields(c: Claims) {
  const displayName = c.name || c.preferred_username || c.nickname || "Utilisateur";
  return {
    name: displayName,
    displayName,
    email: c.email ?? null,
    image: c.picture ?? null,
    avatarUrl: c.picture ?? null,
    role: roleFromGroups(c.groups),
  };
}

export function authentikIssuer(): string {
  if (process.env.AUTH_AUTHENTIK_ISSUER) return process.env.AUTH_AUTHENTIK_ISSUER;
  const base = (process.env.AUTHENTIK_URL ?? "").replace(/\/+$/, "");
  return `${base}/application/o/netflop/`;
}

/** URL de déconnexion complète côté Authentik (end-session OIDC). */
export function authentikEndSessionUrl(idToken: string | null): string {
  const url = new URL("end-session/", authentikIssuer());
  if (idToken) url.searchParams.set("id_token_hint", idToken);
  const hub = process.env.AUTH_URL ?? `https://${process.env.HUB_DOMAIN ?? "localhost"}`;
  url.searchParams.set("post_logout_redirect_uri", new URL("/login?logout=1", hub).toString());
  return url.toString();
}
