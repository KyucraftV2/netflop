import { and, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { authentikIssuer, hasAccess, roleFromGroups } from "./auth-rules";
import { getDb } from "./db";
import { accounts, sessions, users } from "./db/schema";
import { errorMessage, logger } from "./log";

/**
 * Revérification périodique des droits auprès d'Authentik (worker).
 *
 * Sans elle, un utilisateur retiré du groupe « netflop » (ou désactivé) garderait sa
 * session Netflop jusqu'à 30 jours, et un admin rétrogradé resterait admin jusqu'à sa
 * prochaine connexion. Toutes les ACCESS_RECHECK_MINUTES, pour chaque utilisateur ayant
 * une session active :
 *   refresh_token → nouveaux jetons → userinfo (groups)
 *   - refus du refresh (invalid_grant : compte désactivé, consentement/jeton révoqué)
 *     ou groupe « netflop » absent → sessions supprimées + navigateur arrêté ;
 *   - sinon mise à jour du rôle (netflop-admins).
 * Authentik injoignable → on ne révoque PAS (on réessaie au tour suivant).
 */

const log = logger("access");

export type AccessDecision =
  | { action: "keep"; role: "user" | "admin" }
  | { action: "revoke"; reason: string }
  | { action: "skip"; reason: string };

const discoverySchema = z.object({
  token_endpoint: z.string().url(),
  userinfo_endpoint: z.string().url(),
});
const tokenSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  id_token: z.string().optional(),
  expires_in: z.number().optional(),
});
const userinfoSchema = z.object({ groups: z.array(z.string()).nullish() });

export interface RevalidationDeps {
  fetcher?: typeof fetch;
  issuer?: string;
  clientId?: string;
  clientSecret?: string;
}

let discovery: { value: z.infer<typeof discoverySchema>; until: number } | null = null;

async function discover(deps: RevalidationDeps) {
  if (discovery && discovery.until > Date.now()) return discovery.value;
  const f = deps.fetcher ?? fetch;
  const issuer = deps.issuer ?? authentikIssuer();
  const res = await f(new URL(".well-known/openid-configuration", issuer), {
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`découverte OIDC : HTTP ${res.status}`);
  const value = discoverySchema.parse(await res.json());
  discovery = { value, until: Date.now() + 60 * 60 * 1000 };
  return value;
}

export function resetDiscoveryCache(): void {
  discovery = null;
}

/** Interroge Authentik pour un compte ; renvoie la décision et les jetons renouvelés. */
export async function checkAccount(
  refreshToken: string | null,
  deps: RevalidationDeps = {},
): Promise<{ decision: AccessDecision; tokens?: z.infer<typeof tokenSchema> }> {
  if (!refreshToken) {
    return { decision: { action: "skip", reason: "pas de refresh token (reconnexion requise)" } };
  }
  const f = deps.fetcher ?? fetch;
  let endpoints;
  try {
    endpoints = await discover(deps);
  } catch (err) {
    return { decision: { action: "skip", reason: `Authentik injoignable : ${errorMessage(err)}` } };
  }

  let res: Response;
  try {
    res = await f(endpoints.token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: deps.clientId ?? process.env.AUTH_AUTHENTIK_ID ?? "",
        client_secret: deps.clientSecret ?? process.env.AUTH_AUTHENTIK_SECRET ?? "",
      }),
      signal: AbortSignal.timeout(8_000),
    });
  } catch (err) {
    return { decision: { action: "skip", reason: `Authentik injoignable : ${errorMessage(err)}` } };
  }

  if (res.status === 400 || res.status === 401) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (body.error === "invalid_grant") {
      return {
        decision: {
          action: "revoke",
          reason: "jeton refusé par Authentik (compte désactivé ou accès retiré)",
        },
      };
    }
    return { decision: { action: "skip", reason: `refresh refusé : ${body.error ?? res.status}` } };
  }
  if (!res.ok) return { decision: { action: "skip", reason: `token endpoint HTTP ${res.status}` } };

  const tokens = tokenSchema.parse(await res.json());
  const ui = await f(endpoints.userinfo_endpoint, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
    signal: AbortSignal.timeout(8_000),
  }).catch(() => null);
  if (!ui?.ok) return { decision: { action: "skip", reason: "userinfo indisponible" }, tokens };
  const claims = userinfoSchema.parse(await ui.json());
  if (!hasAccess({ groups: claims.groups ?? [] })) {
    return { decision: { action: "revoke", reason: "retiré du groupe netflop" }, tokens };
  }
  return { decision: { action: "keep", role: roleFromGroups(claims.groups) }, tokens };
}

export function createAccessRevalidator(opts: {
  intervalMinutes: number;
  stopBrowser: (userId: string, reason: string) => Promise<void>;
  deps?: RevalidationDeps;
}) {
  const lastCheck = new Map<string, number>();

  async function revoke(userId: string, slug: string, reason: string) {
    await getDb().delete(sessions).where(eq(sessions.userId, userId));
    await opts.stopBrowser(userId, `accès révoqué : ${reason}`).catch(() => {});
    log.warn("accès révoqué", { user: slug, reason });
  }

  async function tick(): Promise<void> {
    const db = getDb();
    const active = await db
      .selectDistinct({
        userId: sessions.userId,
        slug: users.slug,
        role: users.role,
        refreshToken: accounts.refresh_token,
        providerAccountId: accounts.providerAccountId,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .leftJoin(
        accounts,
        and(eq(accounts.userId, sessions.userId), eq(accounts.provider, "authentik")),
      )
      .where(gt(sessions.expires, new Date()));

    const now = Date.now();
    for (const u of active) {
      if (now - (lastCheck.get(u.userId) ?? 0) < opts.intervalMinutes * 60_000) continue;
      lastCheck.set(u.userId, now);
      try {
        const { decision, tokens } = await checkAccount(u.refreshToken ?? null, opts.deps);
        if (tokens && u.providerAccountId) {
          await db
            .update(accounts)
            .set({
              access_token: tokens.access_token,
              refresh_token: tokens.refresh_token ?? u.refreshToken,
              id_token: tokens.id_token ?? undefined,
              expires_at: tokens.expires_in
                ? Math.floor(now / 1000) + tokens.expires_in
                : undefined,
            })
            .where(
              and(
                eq(accounts.provider, "authentik"),
                eq(accounts.providerAccountId, u.providerAccountId),
              ),
            );
        }
        if (decision.action === "revoke") await revoke(u.userId, u.slug, decision.reason);
        else if (decision.action === "keep" && decision.role !== u.role) {
          await db.update(users).set({ role: decision.role }).where(eq(users.id, u.userId));
          log.info("rôle mis à jour depuis Authentik", { user: u.slug, role: decision.role });
        } else if (decision.action === "skip") {
          log.debug("revérification reportée", { user: u.slug, reason: decision.reason });
        }
      } catch (err) {
        log.warn("revérification impossible", { user: u.slug, error: errorMessage(err) });
      }
    }
  }

  return { tick };
}
