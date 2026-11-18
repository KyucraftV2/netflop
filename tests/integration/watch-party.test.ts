import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createLifecycle } from "@/lib/browser-lifecycle";
import type { Db } from "@/lib/db";
import { watchInvites } from "@/lib/db/schema";
import { TEST_DB_URL, createUsers, fakeDocker, resetData, setupDb, testConfig } from "./helpers";

describe.skipIf(!TEST_DB_URL)("Regarder ensemble (Postgres réel)", () => {
  let db: Db;
  let close: () => Promise<void>;
  let ids: Record<string, string>;
  let wp: typeof import("@/lib/watch-party");
  let lc: ReturnType<typeof createLifecycle>;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB_URL;
    ({ db, close } = await setupDb());
    wp = await import("@/lib/watch-party");
  });
  afterAll(async () => {
    const { closeDb } = await import("@/lib/db");
    await closeDb();
    await close();
  });
  beforeEach(async () => {
    await resetData(db);
    ids = await createUsers(db, ["bob", "alice", "carol"]);
    lc = createLifecycle({
      db,
      docker: fakeDocker().client,
      config: testConfig,
      probe: async () => true,
    });
  });

  it("pas d'invitation sans séance en cours", async () => {
    await expect(wp.createInvite(ids.bob!)).rejects.toMatchObject({ status: 409 });
  });

  it("lien à usage unique : le premier membre devient l'invité", async () => {
    await lc.start(ids.bob!, { platform: "netflix" });
    const { token } = await wp.createInvite(ids.bob!);
    const joined = await wp.acceptInvite(token, ids.alice!);
    expect(joined).toMatchObject({ hostSlug: "bob", platform: "netflix" });
    // L'invité peut rouvrir son lien, un autre membre non, l'hôte non plus.
    await expect(wp.acceptInvite(token, ids.alice!)).resolves.toMatchObject({ hostSlug: "bob" });
    await expect(wp.acceptInvite(token, ids.carol!)).rejects.toMatchObject({ status: 403 });
    await expect(wp.acceptInvite(token, ids.bob!)).rejects.toMatchObject({ status: 400 });
    await expect(wp.acceptInvite("x".repeat(32), ids.carol!)).rejects.toMatchObject({
      status: 404,
    });

    expect(await wp.hasGuestAccess("alice", "bob")).toBe(true);
    expect(await wp.hasGuestAccess("carol", "bob")).toBe(false);
    expect(await wp.hasGuestAccess("alice", "carol")).toBe(false);
    const [stored] = await db.select().from(watchInvites);
    expect(stored!.tokenHash).not.toContain(token);
  });

  it("accès coupé à la fin de la séance de l'hôte (même s'il en relance une)", async () => {
    await lc.start(ids.bob!, { platform: "netflix" });
    const { token, id } = await wp.createInvite(ids.bob!);
    await wp.acceptInvite(token, ids.alice!);
    await lc.stopForUser(ids.bob!, "quitter");
    expect(await wp.hasGuestAccess("alice", "bob")).toBe(false);
    expect(await wp.guestInviteState(id, ids.alice!)).toBe("ended");
    await lc.start(ids.bob!, { platform: "netflix" });
    expect(await wp.hasGuestAccess("alice", "bob")).toBe(false);
    await expect(wp.acceptInvite(token, ids.alice!)).rejects.toMatchObject({ status: 410 });
  });

  it("révocation et expiration", async () => {
    await lc.start(ids.bob!, { platform: "netflix" });
    const a = await wp.createInvite(ids.bob!);
    await wp.acceptInvite(a.token, ids.alice!);
    expect(await wp.listInvites(ids.bob!)).toEqual([
      expect.objectContaining({ id: a.id, guestSlug: "alice" }),
    ]);
    expect(await wp.revokeInvites(ids.bob!, a.id)).toBe(1);
    expect(await wp.hasGuestAccess("alice", "bob")).toBe(false);

    const b = await wp.createInvite(ids.bob!);
    await db
      .update(watchInvites)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(watchInvites.id, b.id));
    await expect(wp.acceptInvite(b.token, ids.carol!)).rejects.toMatchObject({ status: 404 });
  });

  it("au plus 3 invitations actives par séance", async () => {
    await lc.start(ids.bob!, { platform: "netflix" });
    for (let i = 0; i < wp.MAX_ACTIVE_INVITES; i++) await wp.createInvite(ids.bob!);
    await expect(wp.createInvite(ids.bob!)).rejects.toMatchObject({ status: 429 });
    await wp.revokeInvites(ids.bob!);
    await expect(wp.createInvite(ids.bob!)).resolves.toBeTruthy();
  });
});
