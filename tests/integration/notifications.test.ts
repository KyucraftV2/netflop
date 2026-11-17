import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db";
import { pushSubscriptions, users, watchProgress } from "@/lib/db/schema";
import type { PushSender } from "@/lib/push";
import { TEST_DB_URL, createUsers, resetData, setupDb } from "./helpers";

describe.skipIf(!TEST_DB_URL)("notifications push (Postgres réel, envoi simulé)", () => {
  let db: Db;
  let close: () => Promise<void>;
  let ids: Record<string, string>;
  let notif: typeof import("@/lib/notifications");
  let push: typeof import("@/lib/push");
  let sent: { endpoint: string; payload: { title: string; body: string; url: string } }[];
  let failWith: number | null;
  const sender: PushSender = async (sub, payload) => {
    if (failWith) throw Object.assign(new Error("push"), { statusCode: failWith });
    sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
  };
  const now = Date.parse("2026-11-17T10:00:00Z");

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB_URL;
    process.env.VAPID_PUBLIC_KEY = "pub";
    process.env.VAPID_PRIVATE_KEY = "priv";
    process.env.VAPID_SUBJECT = "mailto:admin@example.org";
    ({ db, close } = await setupDb());
    notif = await import("@/lib/notifications");
    push = await import("@/lib/push");
  });
  afterAll(async () => {
    const { closeDb } = await import("@/lib/db");
    await closeDb();
    await close();
  });
  beforeEach(async () => {
    await resetData(db);
    sent = [];
    failWith = null;
    ids = await createUsers(db, ["alice", "bob"]);
    for (const [slug, id] of Object.entries(ids)) {
      await push.saveSubscription(
        id,
        {
          endpoint: `https://fcm.googleapis.com/fcm/send/${slug}`,
          keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2", auth: "tBHItJI5svbpez7K" },
        },
        "test",
      );
      await db.insert(watchProgress).values({
        userId: id,
        tmdbId: 96677,
        type: "tv",
        season: 1,
        episode: 3,
        platform: "netflix",
        title: "Lupin",
        completed: true,
        lastWatchedAt: new Date(now - 3 * 86_400_000),
      });
    }
  });

  const aired = (season: number, episode: number, airDate: string) => async () => ({
    season,
    episode,
    airDate,
    name: "Chapitre",
  });

  it("nouvel épisode : une seule notification par épisode et par utilisateur", async () => {
    const deps = { sender, now, lastAired: aired(1, 4, "2026-11-15") };
    expect(await notif.notifyNewEpisodes(deps)).toBe(2);
    expect(sent.map((s) => s.payload.title)).toEqual([
      "Nouvel épisode : Lupin",
      "Nouvel épisode : Lupin",
    ]);
    expect(sent[0]!.payload.body).toBe("S1 · É4 — Chapitre");
    expect(await notif.notifyNewEpisodes(deps)).toBe(0);
  });

  it("rien pour un épisode déjà vu, trop ancien, ou si l'utilisateur a refusé", async () => {
    expect(
      await notif.notifyNewEpisodes({ sender, now, lastAired: aired(1, 3, "2026-11-15") }),
    ).toBe(0);
    expect(
      await notif.notifyNewEpisodes({ sender, now, lastAired: aired(1, 4, "2026-10-01") }),
    ).toBe(0);
    await db.update(users).set({ notifyNewEpisodes: false }).where(eq(users.id, ids.bob!));
    expect(
      await notif.notifyNewEpisodes({ sender, now, lastAired: aired(2, 1, "2026-11-16") }),
    ).toBe(1);
    expect(sent.map((s) => s.endpoint)).toEqual(["https://fcm.googleapis.com/fcm/send/alice"]);
  });

  it("abonnement expiré (410) supprimé", async () => {
    failWith = 410;
    await push.sendToUser(ids.alice!, { title: "t", body: "b", url: "/" }, { sender });
    const left = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, ids.alice!));
    expect(left).toHaveLength(0);
  });

  it("« C'est ton tour » selon la préférence", async () => {
    await notif.notifyQueueServed(ids.alice!, "netflix", { sender });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.payload).toMatchObject({ title: "C'est ton tour !", url: "/watch/netflix" });
    await db.update(users).set({ notifyQueue: false }).where(eq(users.id, ids.alice!));
    await notif.notifyQueueServed(ids.alice!, "netflix", { sender });
    expect(sent).toHaveLength(1);
  });

  it("URL de notification : chemin relatif uniquement", async () => {
    await expect(
      push.sendToUser(ids.alice!, { title: "t", body: "b", url: "https://evil.io" }, { sender }),
    ).rejects.toThrow();
  });
});
