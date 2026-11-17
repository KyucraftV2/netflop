import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createLifecycle } from "@/lib/browser-lifecycle";
import type { Db } from "@/lib/db";
import { browserSessions } from "@/lib/db/schema";
import { TEST_DB_URL, createUsers, fakeDocker, resetData, setupDb, testConfig } from "./helpers";

describe.skipIf(!TEST_DB_URL)("cycle de vie des navigateurs (Postgres réel)", () => {
  let db: Db;
  let close: () => Promise<void>;
  let clock: Date;
  let docker: ReturnType<typeof fakeDocker>;
  let healthy: boolean;
  let lc: ReturnType<typeof createLifecycle>;
  let ids: Record<string, string>;

  const advance = (seconds: number) => {
    clock = new Date(clock.getTime() + seconds * 1000);
  };

  beforeAll(async () => {
    ({ db, close } = await setupDb());
  });
  afterAll(async () => close());

  beforeEach(async () => {
    await resetData(db);
    clock = new Date();
    docker = fakeDocker();
    healthy = true;
    lc = createLifecycle({
      db,
      docker: docker.client,
      config: testConfig,
      now: () => clock,
      probe: async () => healthy,
    });
    ids = await createUsers(db, ["alice", "bob", "carol", "dave", "eve"]);
  });

  it("démarre un navigateur sur le premier slot libre puis le passe en ready", async () => {
    const s = await lc.start(ids.alice!, { platform: "netflix" });
    expect(s).toMatchObject({ state: "ready", slot: 0, slug: "alice" });
    expect(docker.containers.get("alice")?.running).toBe(true);
  });

  it("reste en starting tant que Neko ne répond pas", async () => {
    healthy = false;
    expect((await lc.start(ids.alice!, { platform: "netflix" })).state).toBe("starting");
    healthy = true;
    expect((await lc.status(ids.alice!)).state).toBe("ready");
  });

  it("réutilise la session existante (rechargement de page)", async () => {
    await lc.start(ids.alice!, { platform: "netflix" });
    await lc.leave(ids.alice!); // pagehide
    const again = await lc.start(ids.alice!, { platform: "canalplus" });
    expect(again).toMatchObject({ state: "ready", slot: 0, platform: "canalplus" });
    advance(60);
    await lc.tick();
    expect(docker.containers.has("alice")).toBe(true); // la demande d'arrêt a été annulée
  });

  it("aucune double attribution de slot sous concurrence", async () => {
    const results = await Promise.all(
      ["alice", "bob", "carol", "dave", "eve"].map((u) =>
        lc.start(ids[u]!, { platform: "netflix" }),
      ),
    );
    const slots = results.flatMap((r) => ("slot" in r ? [r.slot] : []));
    expect(new Set(slots).size).toBe(slots.length);
    expect(slots.sort()).toEqual([0, 1, 2]);
    expect(results.filter((r) => r.state === "queued")).toHaveLength(2);
    expect(docker.containers.size).toBe(3);
  });

  it("4e utilisateur en file, servi automatiquement quand un slot se libère", async () => {
    for (const u of ["alice", "bob", "carol"]) await lc.start(ids[u]!, { platform: "netflix" });
    const d = await lc.start(ids.dave!, { platform: "francetv", url: "https://www.france.tv/" });
    expect(d).toEqual({ state: "queued", position: 1, platform: "francetv" });
    advance(1);
    const e = await lc.start(ids.eve!, { platform: "netflix" });
    expect(e).toMatchObject({ state: "queued", position: 2 });

    await lc.leave(ids.bob!);
    advance(31);
    for (const u of ["alice", "carol", "dave", "eve"]) await lc.heartbeat(ids[u]!);
    await lc.tick();

    expect(docker.containers.has("bob")).toBe(false);
    const served = await lc.status(ids.dave!);
    expect(served).toMatchObject({ state: "ready", slot: 1, pendingUrl: "https://www.france.tv/" });
    expect(await lc.status(ids.eve!)).toMatchObject({ state: "queued", position: 1 });
  });

  it("arrête après la fermeture de l'onglet (30 s de grâce)", async () => {
    await lc.start(ids.alice!, { platform: "netflix" });
    await lc.leave(ids.alice!);
    advance(20);
    await lc.tick();
    expect(docker.containers.has("alice")).toBe(true);
    advance(15);
    await lc.tick();
    expect(docker.containers.has("alice")).toBe(false);
    expect(await lc.status(ids.alice!)).toEqual({ state: "off" });
  });

  it("arrête si le heartbeat est perdu", async () => {
    await lc.start(ids.alice!, { platform: "netflix" });
    advance(61);
    await lc.tick();
    expect(docker.containers.has("alice")).toBe(false);
  });

  it("popup « Tu regardes toujours ? » puis arrêt sans réponse", async () => {
    await lc.start(ids.alice!, { platform: "netflix" });
    for (let i = 0; i < 4 * 60 * 3 + 1; i++) {
      advance(20);
      await lc.heartbeat(ids.alice!);
    }
    await lc.tick();
    const s = await lc.status(ids.alice!);
    expect(s).toMatchObject({ stillWatchingPrompt: true });
    advance(4 * 60);
    await lc.heartbeat(ids.alice!);
    await lc.tick();
    expect(docker.containers.has("alice")).toBe(true);
    advance(61);
    await lc.heartbeat(ids.alice!);
    await lc.tick();
    expect(docker.containers.has("alice")).toBe(false);
  });

  it("répondre à la popup prolonge la séance", async () => {
    await lc.start(ids.alice!, { platform: "netflix" });
    await db
      .update(browserSessions)
      .set({ stillWatchingPromptAt: clock })
      .where(eq(browserSessions.userId, ids.alice!));
    await lc.stillWatching(ids.alice!);
    advance(10 * 60);
    await lc.heartbeat(ids.alice!);
    await lc.tick();
    expect(docker.containers.has("alice")).toBe(true);
  });

  it("retire de la file un utilisateur qui a abandonné l'attente", async () => {
    for (const u of ["alice", "bob", "carol"]) await lc.start(ids[u]!, { platform: "netflix" });
    await lc.start(ids.dave!, { platform: "netflix" });
    advance(61);
    for (const u of ["alice", "bob", "carol"]) await lc.heartbeat(ids[u]!);
    await lc.tick();
    expect(await lc.status(ids.dave!)).toEqual({ state: "off" });
  });

  it("réconciliation : conteneur orphelin supprimé, session sans conteneur nettoyée", async () => {
    await lc.start(ids.alice!, { platform: "netflix" });
    await lc.start(ids.bob!, { platform: "netflix" });
    // Conteneur sans session (worker tué au mauvais moment)
    await docker.client.createBrowser("carol", 2);
    docker.containers.get("carol")!.createdAt = new Date(Date.now() - 120_000);
    // Session sans conteneur
    docker.containers.delete("bob");
    advance(120);
    const r = await lc.reconcile();
    expect(r).toEqual({ removedContainers: 1, removedSessions: 1 });
    expect(docker.containers.has("carol")).toBe(false);
    expect(await lc.status(ids.bob!)).toEqual({ state: "off" });
    expect(await lc.status(ids.alice!)).toMatchObject({ state: "ready" });
  });

  it("stopForUser (bouton Quitter / déconnexion) libère le slot immédiatement", async () => {
    await lc.start(ids.alice!, { platform: "netflix" });
    await lc.stopForUser(ids.alice!, "quitter");
    expect(docker.containers.size).toBe(0);
    const s = await lc.start(ids.bob!, { platform: "netflix" });
    expect(s).toMatchObject({ slot: 0 });
  });

  it("échec Docker : le slot est libéré", async () => {
    docker.client.startBrowser = async () => {
      throw new Error("boom");
    };
    await expect(lc.start(ids.alice!, { platform: "netflix" })).rejects.toThrow("boom");
    expect(await lc.status(ids.alice!)).toEqual({ state: "off" });
    expect(docker.containers.size).toBe(0);
  });
});
