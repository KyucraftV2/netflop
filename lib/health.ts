import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "./db";
import { pingDocker } from "./docker";
import { errorMessage, logger } from "./log";
import { pingTmdb } from "./tmdb";

const log = logger("health");

export type CheckState = "ok" | "erreur";
export interface DeepHealth {
  ok: boolean;
  checks: { db: CheckState; docker: CheckState; tmdb: CheckState };
  checkedAt: string;
}

const CACHE_MS = 30_000;
let cache: { value: DeepHealth; until: number } | null = null;

async function check(name: string, fn: () => Promise<unknown>): Promise<CheckState> {
  try {
    const ok = await Promise.race([
      fn().then((r) => r !== false),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5_000)),
    ]);
    return ok ? "ok" : "erreur";
  } catch (err) {
    log.warn("sonde en échec", { check: name, error: errorMessage(err) });
    return "erreur";
  }
}

/**
 * Base, docker-proxy et TMDB. `ok` ne dépend que de la base et de docker-proxy :
 * TMDB en panne dégrade la recherche, pas le reste. Résultat en cache 30 s.
 */
export async function deepHealth(): Promise<DeepHealth> {
  if (cache && cache.until > Date.now()) return cache.value;
  const [db, docker, tmdb] = await Promise.all([
    check("db", () => getDb().execute(sql`select 1`)),
    check("docker", () => pingDocker()),
    check("tmdb", () => pingTmdb()),
  ]);
  const value = {
    ok: db === "ok" && docker === "ok",
    checks: { db, docker, tmdb },
    checkedAt: new Date().toISOString(),
  };
  cache = { value, until: Date.now() + CACHE_MS };
  return value;
}
