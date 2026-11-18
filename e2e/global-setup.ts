import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as schema from "../lib/db/schema";

export const E2E_SESSION_TOKEN = "e2e-session-token-alice";

/** Base de test vierge + utilisateur « alice » connecté (session insérée = connexion simulée). */
export default async function globalSetup() {
  const url = process.env.E2E_DATABASE_URL;
  if (!url) throw new Error("E2E_DATABASE_URL manquant");
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  await sql.unsafe(
    "drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;",
  );
  await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
  const db = drizzle(sql, { schema });
  const [alice] = await db
    .insert(schema.users)
    .values({
      authentikSub: "sub-alice",
      slug: "alice",
      name: "Alice",
      displayName: "Alice",
      email: "alice@example.org",
      role: "admin",
      onboardedAt: new Date(),
    })
    .returning();
  await db.insert(schema.sessions).values({
    sessionToken: E2E_SESSION_TOKEN,
    userId: alice!.id,
    expires: new Date(Date.now() + 86_400_000),
  });
  await db.insert(schema.userSubscriptions).values([
    { userId: alice!.id, platform: "netflix" },
    { userId: alice!.id, platform: "canalplus" },
  ]);
  await db.insert(schema.watchProgress).values({
    userId: alice!.id,
    tmdbId: 63333,
    type: "tv",
    season: 2,
    episode: 4,
    platform: "netflix",
    title: "The Last Kingdom",
    resumeUrl: "https://www.netflix.com/watch/80074249",
    position: 1200,
    duration: 3300,
    percent: 0.36,
    confidence: 1,
  });
  // Tableau de bord admin : 1 h de lecture aujourd'hui et une séance terminée.
  const now = new Date();
  await db.insert(schema.watchSamples).values(
    Array.from({ length: 120 }, () => ({
      userId: alice!.id,
      platform: "netflix" as const,
      url: "https://www.netflix.com/watch/80074249",
      position: 1200,
      duration: 3300,
      paused: false,
      capturedAt: now,
    })),
  );
  await db.insert(schema.browserEvents).values({
    userId: alice!.id,
    slug: "alice",
    platform: "netflix",
    startedAt: new Date(now.getTime() - 3_600_000),
    stoppedAt: now,
    durationSeconds: 3600,
    reason: "onglet fermé",
  });
  await sql.end();
}
