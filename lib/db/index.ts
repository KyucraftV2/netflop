import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Client Drizzle partagé (postgres.js). Singleton conservé sur globalThis pour
 * survivre au rechargement à chaud en développement.
 */

export type Db = PostgresJsDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { __netflopDb?: Db; __netflopSql?: postgres.Sql };

export function getDb(): Db {
  if (!globalForDb.__netflopDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL manquant");
    const sql = postgres(url, {
      max: Number(process.env.DATABASE_POOL_SIZE ?? 10),
      idle_timeout: 30,
      onnotice: () => {},
    });
    globalForDb.__netflopSql = sql;
    globalForDb.__netflopDb = drizzle(sql, { schema });
  }
  return globalForDb.__netflopDb;
}

export async function closeDb(): Promise<void> {
  await globalForDb.__netflopSql?.end({ timeout: 5 });
  globalForDb.__netflopDb = undefined;
  globalForDb.__netflopSql = undefined;
}

export { schema };
