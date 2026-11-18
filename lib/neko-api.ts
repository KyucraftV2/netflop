import { z } from "zod";
import { internalIpForSlot, NEKO_HTTP_PORT } from "./browser-spec";
import type { ServerConfig } from "./config";
import { logger } from "./log";

/**
 * Client minimal de l'API HTTP de Neko v3 (réseau interne des navigateurs), utilisé
 * par « Regarder ensemble » pour verrouiller le contrôle et le passer à un invité.
 *
 * À VALIDER sur une vraie instance Neko 3.2 : routes et formats ci-dessous d'après
 * l'API v3 (login → jeton Bearer, /api/sessions, /api/room/control/*, /api/room/settings).
 * Un échec n'empêche jamais de regarder ensemble : l'invité garde la lecture seule.
 */

const log = logger("neko-api");

const loginSchema = z.object({ token: z.string().min(1) });
const sessionsSchema = z.array(
  z.object({
    id: z.string(),
    profile: z.object({ name: z.string().optional() }).passthrough().optional(),
    state: z.object({ is_connected: z.boolean().optional() }).passthrough().optional(),
  }),
);

export interface NekoTarget {
  slug: string;
  slot: number;
  adminPassword: string;
}

export function nekoApiBase(t: Pick<NekoTarget, "slug" | "slot">, cfg: ServerConfig): string {
  return `http://${internalIpForSlot(t.slot, cfg)}:${NEKO_HTTP_PORT}/b/${t.slug}/api`;
}

export function createNekoApi(
  target: NekoTarget,
  cfg: ServerConfig,
  fetcher: typeof fetch = fetch,
) {
  const base = nekoApiBase(target, cfg);

  async function call(path: string, init: RequestInit & { token?: string } = {}) {
    const res = await fetcher(`${base}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
      },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) throw new Error(`Neko ${path} : HTTP ${res.status}`);
    return res;
  }

  /** Session d'administration éphémère (identifiant distinct de celui de l'hôte). */
  async function withAdmin<T>(fn: (token: string) => Promise<T>): Promise<T> {
    const res = await call("/login", {
      method: "POST",
      body: JSON.stringify({ username: "netflop-hub", password: target.adminPassword }),
    });
    const { token } = loginSchema.parse(await res.json());
    try {
      return await fn(token);
    } finally {
      await call("/logout", { method: "POST", token }).catch(() => {});
    }
  }

  async function findSession(token: string, username: string): Promise<string | null> {
    const res = await call("/sessions", { token });
    const sessions = sessionsSchema.parse(await res.json());
    const match = sessions.find((s) => s.id === username || s.profile?.name === username);
    return match?.id ?? null;
  }

  return {
    /** Seuls les administrateurs (l'hôte) prennent le contrôle d'eux-mêmes. */
    async lockControls(): Promise<void> {
      await withAdmin(async (token) => {
        const current = (await (await call("/room/settings", { token })).json()) as Record<
          string,
          unknown
        >;
        await call("/room/settings", {
          method: "POST",
          token,
          body: JSON.stringify({ ...current, locked_controls: true }),
        });
      });
    },
    /** Passe le contrôle (souris, clavier) à l'invité. */
    async giveControl(guestSlug: string): Promise<boolean> {
      return withAdmin(async (token) => {
        const id = await findSession(token, guestSlug);
        if (!id) return false;
        await call(`/room/control/give/${encodeURIComponent(id)}`, { method: "POST", token });
        return true;
      });
    },
    /** Retire le contrôle à tout le monde (l'hôte le reprend en cliquant). */
    async resetControl(): Promise<void> {
      await withAdmin((token) => call("/room/control/reset", { method: "POST", token }));
    },
  };
}

export async function safeNeko<T>(what: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    log.warn(`API Neko : ${what}`, { error: (err as Error).message });
    return null;
  }
}
