import "server-only";
import { and, asc, count, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import { getDb } from "./db";
import { browserEvents, userSubscriptions, users, watchSamples } from "./db/schema";
import { getConfig } from "./config";
import { lifecycle } from "./browser-lifecycle";
import { browserStats } from "./docker";
import type { PlatformId } from "./platforms";

export interface AdminUserRow {
  id: string;
  slug: string;
  displayName: string;
  email: string | null;
  role: "user" | "admin";
  lastLoginAt: Date | null;
  subscriptions: PlatformId[];
}

export interface AdminBrowserRow {
  slug: string;
  slot: number | null;
  status: string;
  startedAt: Date;
  durationSeconds: number;
  memoryBytes: number | null;
  memoryLimitBytes: number | null;
  cpuPercent: number | null;
}

export interface AdminQueueRow {
  slug: string;
  displayName: string;
  platform: PlatformId;
  requestedAt: Date;
}

export async function listUsersForAdmin(): Promise<AdminUserRow[]> {
  const db = getDb();
  const [rows, subs] = await Promise.all([
    db
      .select({
        id: users.id,
        slug: users.slug,
        displayName: users.displayName,
        email: users.email,
        role: users.role,
        lastLoginAt: users.lastLoginAt,
      })
      .from(users)
      .orderBy(asc(users.displayName)),
    db.select().from(userSubscriptions),
  ]);
  return rows.map((u) => ({
    ...u,
    subscriptions: subs.filter((s) => s.userId === u.id).map((s) => s.platform),
  }));
}

export async function listActiveBrowsersForAdmin(): Promise<AdminBrowserRow[]> {
  const sessions = await lifecycle().activeSessions();
  const now = Date.now();
  return Promise.all(
    sessions.map(async ({ session, slug }) => {
      const stats = await browserStats(slug).catch(() => null);
      return {
        slug,
        slot: session.slot,
        status: session.status,
        startedAt: session.createdAt,
        durationSeconds: (now - session.createdAt.getTime()) / 1000,
        memoryBytes: stats?.memoryBytes ?? null,
        memoryLimitBytes: stats?.memoryLimitBytes ?? null,
        cpuPercent: stats?.cpuPercent ?? null,
      };
    }),
  );
}

export async function listQueueForAdmin(): Promise<AdminQueueRow[]> {
  const rows = await lifecycle().queue();
  return rows.map((q) => ({
    slug: q.slug,
    displayName: q.displayName,
    platform: q.platform,
    requestedAt: q.requestedAt,
  }));
}

/* ------------------------------------------------------------------ */
/* Statistiques de visionnage (échantillons du tracker, 30 jours)      */
/* ------------------------------------------------------------------ */

export const STATS_TIMEZONE = "Europe/Paris";

/** Échantillons « vidéo en lecture » : chacun vaut TRACKER_INTERVAL_SECONDS de visionnage. */
function playing() {
  return and(eq(watchSamples.paused, false), isNotNull(watchSamples.position));
}

function hours(samples: number): number {
  return (samples * getConfig().TRACKER_INTERVAL_SECONDS) / 3600;
}

export interface DayUsage {
  /** AAAA-MM-JJ (fuseau STATS_TIMEZONE). */
  day: string;
  hours: number;
}

/** Heures de visionnage par jour sur les `days` derniers jours (jours vides inclus). */
export async function usageByDay(days = 14, nowMs = Date.now()): Promise<DayUsage[]> {
  const since = new Date(nowMs - days * 86_400_000);
  // Fuseau constant inséré tel quel : un paramètre ($1, $2…) empêcherait Postgres de
  // reconnaître la même expression dans le SELECT et le GROUP BY.
  const dayExpr = sql<string>`to_char(${watchSamples.capturedAt} at time zone ${sql.raw(`'${STATS_TIMEZONE}'`)}, 'YYYY-MM-DD')`;
  const rows = await getDb()
    .select({ day: dayExpr, n: count() })
    .from(watchSamples)
    .where(and(playing(), gte(watchSamples.capturedAt, since)))
    .groupBy(dayExpr);
  const byDay = new Map(rows.map((r) => [r.day, r.n]));
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: STATS_TIMEZONE });
  return Array.from({ length: days }, (_, i) => {
    const day = fmt.format(new Date(nowMs - (days - 1 - i) * 86_400_000));
    return { day, hours: hours(byDay.get(day) ?? 0) };
  });
}

export interface UsageShare {
  key: string;
  label: string;
  hours: number;
}

export async function usageByPlatform(days = 30): Promise<UsageShare[]> {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await getDb()
    .select({ platform: watchSamples.platform, n: count() })
    .from(watchSamples)
    .where(and(playing(), gte(watchSamples.capturedAt, since)))
    .groupBy(watchSamples.platform)
    .orderBy(desc(count()));
  return rows.map((r) => ({ key: r.platform, label: r.platform, hours: hours(r.n) }));
}

export async function usageByUser(days = 30): Promise<UsageShare[]> {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await getDb()
    .select({ slug: users.slug, name: users.displayName, n: count() })
    .from(watchSamples)
    .innerJoin(users, eq(users.id, watchSamples.userId))
    .where(and(playing(), gte(watchSamples.capturedAt, since)))
    .groupBy(users.slug, users.displayName)
    .orderBy(desc(count()));
  return rows.map((r) => ({ key: r.slug, label: r.name, hours: hours(r.n) }));
}

/* ------------------------------------------------------------------ */
/* Journal des séances                                                 */
/* ------------------------------------------------------------------ */

export async function recentSessions(limit = 30) {
  return getDb()
    .select()
    .from(browserEvents)
    .orderBy(desc(browserEvents.stoppedAt), desc(browserEvents.id))
    .limit(limit);
}
