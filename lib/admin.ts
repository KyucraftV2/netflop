import "server-only";
import { asc } from "drizzle-orm";
import { getDb } from "./db";
import { userSubscriptions, users } from "./db/schema";
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
