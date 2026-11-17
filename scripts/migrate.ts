import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { errorMessage, logger } from "../lib/log";

/**
 * Applique les migrations versionnées de drizzle/ (service `migrate` du compose,
 * lancé avant hub et worker). Idempotent.
 */
const log = logger("migrate");

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL manquant");
  const folder = process.env.MIGRATIONS_DIR ?? "./drizzle";
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    for (let attempt = 1; ; attempt++) {
      try {
        await sql`select 1`;
        break;
      } catch (err) {
        if (attempt >= 30) throw err;
        log.warn("base indisponible, nouvel essai", { attempt });
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    await migrate(drizzle(sql), { migrationsFolder: folder });
    log.info("migrations appliquées", { folder });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err: unknown) => {
  log.error("échec des migrations", { error: errorMessage(err) });
  process.exit(1);
});
