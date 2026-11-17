import { and, eq, gt, lt } from "drizzle-orm";
import { getDb } from "./db";
import { apiCache } from "./db/schema";
import { errorMessage, logger } from "./log";

const log = logger("cache");

/** Cache en base (table api_cache) avec durée de vie. Une erreur de cache n'est jamais bloquante. */
export async function cached<T>(
  key: string,
  ttlSeconds: number,
  produce: () => Promise<T>,
): Promise<T> {
  const db = getDb();
  try {
    const [hit] = await db
      .select({ value: apiCache.value })
      .from(apiCache)
      .where(and(eq(apiCache.key, key), gt(apiCache.expiresAt, new Date())));
    if (hit) return hit.value as T;
  } catch (err) {
    log.warn("lecture du cache", { error: errorMessage(err) });
  }
  const value = await produce();
  try {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    await db
      .insert(apiCache)
      .values({ key, value: value as object, expiresAt })
      .onConflictDoUpdate({ target: apiCache.key, set: { value: value as object, expiresAt } });
  } catch (err) {
    log.warn("écriture du cache", { error: errorMessage(err) });
  }
  return value;
}

export async function purgeExpiredCache(): Promise<number> {
  const rows = await getDb()
    .delete(apiCache)
    .where(lt(apiCache.expiresAt, new Date()))
    .returning({ key: apiCache.key });
  return rows.length;
}
