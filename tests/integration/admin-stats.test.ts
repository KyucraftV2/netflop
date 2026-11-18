import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/db";
import { watchSamples } from "@/lib/db/schema";
import { TEST_DB_URL, createUsers, resetData, setupDb } from "./helpers";

vi.mock("server-only", () => ({}));

describe.skipIf(!TEST_DB_URL)("statistiques admin (Postgres réel)", () => {
  let db: Db;
  let close: () => Promise<void>;
  let ids: Record<string, string>;
  let admin: typeof import("@/lib/admin");

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB_URL;
    process.env.HUB_DOMAIN = "netflop.example.com";
    process.env.PUBLIC_IP = "203.0.113.10";
    process.env.SLOT_PORTS = "52000,52001,52002";
    process.env.TRACKER_INTERVAL_SECONDS = "30";
    ({ db, close } = await setupDb());
    admin = await import("@/lib/admin");
  });
  afterAll(async () => {
    const { closeDb } = await import("@/lib/db");
    await closeDb();
    await close();
  });
  beforeEach(async () => {
    await resetData(db);
    await db.delete(watchSamples);
    ids = await createUsers(db, ["alice", "bob"]);
  });

  function samples(
    userId: string,
    platform: "netflix" | "canalplus",
    n: number,
    at: Date,
    paused = false,
  ) {
    return Array.from({ length: n }, () => ({
      userId,
      platform,
      url: "https://www.netflix.com/watch/1",
      position: 10,
      duration: 3000,
      paused,
      capturedAt: at,
    }));
  }

  it("heures par jour, par plateforme, par utilisateur (pauses exclues)", async () => {
    const now = new Date("2026-11-17T12:00:00Z");
    const yesterday = new Date("2026-11-16T20:00:00Z");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    try {
      await db.insert(watchSamples).values([
        ...samples(ids.alice!, "netflix", 120, now), // 1 h
        ...samples(ids.bob!, "canalplus", 60, yesterday), // 30 min
        ...samples(ids.bob!, "canalplus", 500, yesterday, true), // en pause : ignoré
      ]);
      const days = await admin.usageByDay(3, now.getTime());
      expect(days.map((d) => d.day)).toEqual(["2026-11-15", "2026-11-16", "2026-11-17"]);
      expect(days.map((d) => d.hours)).toEqual([0, 0.5, 1]);

      const platforms = await admin.usageByPlatform(30);
      expect(platforms).toEqual([
        { key: "netflix", label: "netflix", hours: 1 },
        { key: "canalplus", label: "canalplus", hours: 0.5 },
      ]);
      const people = await admin.usageByUser(30);
      expect(people.map((p) => [p.key, p.hours])).toEqual([
        ["alice", 1],
        ["bob", 0.5],
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});
