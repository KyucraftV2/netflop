import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { parseConfig, type ServerConfig } from "@/lib/config";
import * as schema from "@/lib/db/schema";
import type { Db } from "@/lib/db";
import type { BrowserInfo, DockerClient } from "@/lib/docker";

export const TEST_DB_URL = process.env.TEST_DATABASE_URL;

export async function setupDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  if (!TEST_DB_URL) throw new Error("TEST_DATABASE_URL manquant");
  const sql = postgres(TEST_DB_URL, { max: 10, onnotice: () => {} });
  await sql.unsafe(
    "drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;",
  );
  const db = drizzle(sql, { schema }) as unknown as Db;
  await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
  return { db, close: () => sql.end({ timeout: 5 }) };
}

export async function resetData(db: Db): Promise<void> {
  await db.execute(
    'truncate "user", session, account, user_subscription, browser_session, browser_queue cascade' as never,
  );
}

export async function createUsers(db: Db, slugs: string[]): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  for (const slug of slugs) {
    const [u] = await db
      .insert(schema.users)
      .values({ authentikSub: `sub-${slug}`, slug, displayName: slug, onboardedAt: new Date() })
      .returning();
    ids[slug] = u!.id;
  }
  return ids;
}

export const testConfig: ServerConfig = parseConfig({
  HUB_DOMAIN: "netflop.example.com",
  TRAEFIK_NETWORK: "traefik",
  PUBLIC_IP: "203.0.113.10",
  SLOT_PORTS: "52000,52001,52002",
  MAX_ACTIVE_BROWSERS: "3",
  HEARTBEAT_TIMEOUT_SECONDS: "60",
  STILL_WATCHING_HOURS: "4",
});

/** Faux Docker en mémoire. */
export function fakeDocker() {
  const containers = new Map<string, BrowserInfo>();
  let n = 0;
  const client = {
    async inspect(user: string) {
      return containers.get(user) ?? null;
    },
    async createBrowser(user: string, slot: number) {
      const info: BrowserInfo = {
        id: `c${++n}`,
        user,
        slot,
        state: "created",
        running: false,
        createdAt: new Date(),
      };
      containers.set(user, info);
      return info;
    },
    async startBrowser(user: string) {
      const c = containers.get(user);
      if (c) Object.assign(c, { state: "running", running: true });
    },
    async stopBrowser(user: string) {
      const c = containers.get(user);
      if (c) Object.assign(c, { state: "exited", running: false });
    },
    async removeBrowser(user: string) {
      containers.delete(user);
    },
    async listBrowsers() {
      return [...containers.values()];
    },
    async browserStats() {
      return null;
    },
    async removeProfileVolume() {
      return true;
    },
    async ping() {
      return true;
    },
  } satisfies DockerClient;
  return { client, containers };
}
