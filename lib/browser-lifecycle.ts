import { and, asc, count, eq, isNotNull, isNull, lt, lte, or } from "drizzle-orm";
import { healthUrl, resolveQuality } from "./browser-spec";
import { getConfig, type ServerConfig } from "./config";
import { getDb, type Db } from "./db";
import {
  browserQueue,
  browserEvents,
  browserSessions,
  users,
  type BrowserSession,
  type OpenedContent,
} from "./db/schema";
import { createDockerClient, type DockerClient } from "./docker";
import { errorMessage, logger } from "./log";
import { nekoAdminPassword, nekoUserPassword } from "./neko-secret";
import type { PlatformId } from "./platforms";

/**
 * Cycle de vie automatique des navigateurs, partagé par le hub (API) et le worker.
 * Personne ne gère un conteneur à la main : un navigateur existe uniquement pendant
 * qu'un utilisateur regarde. Le volume de profil n'est JAMAIS supprimé ici.
 *
 * Invariants garantis par la base :
 *  - une seule session par utilisateur (unique user_id) ;
 *  - un slot ne peut être attribué qu'une fois (unique slot) → pas de double attribution.
 */

const log = logger("lifecycle");

export type BrowserStatusView =
  | { state: "off" }
  | { state: "queued"; position: number; platform: PlatformId }
  | {
      state: "starting" | "ready" | "stopping";
      slot: number;
      slug: string;
      platform: PlatformId;
      stillWatchingPrompt: boolean;
      /** Minuteur de sommeil actif. */
      sleep: { at: string | null; afterEpisode: boolean };
      opened: OpenedContent | null;
      pendingUrl: string | null;
      error: string | null;
      /** Mot de passe Neko de la séance : renvoyé uniquement à son propriétaire. */
      nekoPassword: string;
    };

export type SleepMode =
  { kind: "off" } | { kind: "episode" } | { kind: "minutes"; minutes: number };

export interface StartRequest {
  platform: PlatformId;
  /** URL validée (liste blanche) à ouvrir une fois prêt. */
  url?: string | null;
  opened?: OpenedContent | null;
}

export interface LifecycleHooks {
  /** Un utilisateur en file vient d'obtenir un navigateur (notification « C'est ton tour »). */
  onQueueServed?: (userId: string, platform: PlatformId) => Promise<void>;
  /** Appelé juste avant l'arrêt (étape 5 : dernière capture de progression). */
  beforeStop?: (session: BrowserSession, slug: string) => Promise<void>;
  /** Appelé quand le navigateur devient prêt (étape 4 : navigation vers pendingUrl). */
  onReady?: (session: BrowserSession, slug: string) => Promise<void>;
}

export interface LifecycleDeps {
  db?: Db;
  docker?: DockerClient;
  config?: ServerConfig;
  now?: () => Date;
  probe?: (url: string) => Promise<boolean>;
}

async function defaultProbe(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}

const hooks: LifecycleHooks = {};
export function registerLifecycleHooks(h: LifecycleHooks): void {
  Object.assign(hooks, h);
}

export function createLifecycle(deps: LifecycleDeps = {}) {
  const db = () => deps.db ?? getDb();
  const cfg = () => deps.config ?? getConfig();
  const docker = () => deps.docker ?? createDockerClient({ config: cfg() });
  const now = () => (deps.now ? deps.now() : new Date());
  const probe = deps.probe ?? defaultProbe;

  async function userInfo(userId: string) {
    const [u] = await db()
      .select({
        slug: users.slug,
        videoQuality: users.videoQuality,
        autoQualityHint: users.autoQualityHint,
      })
      .from(users)
      .where(eq(users.id, userId));
    return u ?? null;
  }

  async function queuePosition(userId: string): Promise<number | null> {
    const [mine] = await db()
      .select({ requestedAt: browserQueue.requestedAt })
      .from(browserQueue)
      .where(eq(browserQueue.userId, userId));
    if (!mine) return null;
    const [ahead] = await db()
      .select({ n: count() })
      .from(browserQueue)
      .where(
        or(
          lt(browserQueue.requestedAt, mine.requestedAt),
          and(eq(browserQueue.requestedAt, mine.requestedAt), lt(browserQueue.userId, userId)),
        ),
      );
    return (ahead?.n ?? 0) + 1;
  }

  /**
   * Réserve un slot libre pour l'utilisateur (insertion protégée par les contraintes
   * d'unicité). Renvoie la session créée, ou null si tous les slots sont pris.
   */
  async function reserveSlot(
    userId: string,
    req: StartRequest,
    tx: Db = db(),
  ): Promise<BrowserSession | null> {
    const max = cfg().MAX_ACTIVE_BROWSERS;
    for (let attempt = 0; attempt < 5; attempt++) {
      const used = new Set(
        (await tx.select({ slot: browserSessions.slot }).from(browserSessions)).map((r) => r.slot),
      );
      const free = Array.from({ length: max }, (_, i) => i).find((i) => !used.has(i));
      if (free === undefined) return null;
      try {
        // Sous-transaction (SAVEPOINT) : une violation d'unicité n'annule pas la transaction parente.
        const [row] = await tx.transaction(async (sp) =>
          sp
            .insert(browserSessions)
            .values({
              userId,
              slot: free,
              platform: req.platform,
              pendingUrl: req.url ?? null,
              openedContent: req.opened ?? null,
              lastHeartbeatAt: now(),
              lastInteractionAt: now(),
            })
            .returning(),
        );
        return row ?? null;
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        // Slot pris entre-temps (ou session déjà créée pour cet utilisateur) : on recommence.
        const [existing] = await tx
          .select()
          .from(browserSessions)
          .where(eq(browserSessions.userId, userId));
        if (existing) return existing;
      }
    }
    return null;
  }

  /** Crée et démarre le conteneur d'une session réservée. En cas d'échec, libère le slot. */
  async function launch(session: BrowserSession): Promise<void> {
    const u = await userInfo(session.userId);
    if (!u) throw new Error("Utilisateur introuvable");
    const d = docker();
    try {
      // Un conteneur résiduel (crash, réconciliation pas encore passée) gênerait la création.
      if (await d.inspect(u.slug)) await d.removeBrowser(u.slug);
      const info = await d.createBrowser(
        u.slug,
        session.slot,
        resolveQuality(u.videoQuality, u.autoQualityHint),
        {
          adminPassword: nekoAdminPassword(session.id),
          userPassword: nekoUserPassword(session.id),
        },
      );
      await d.startBrowser(u.slug);
      await db()
        .update(browserSessions)
        .set({ containerId: info.id })
        .where(eq(browserSessions.id, session.id));
      log.info("séance démarrée", { user: u.slug, slot: session.slot, platform: session.platform });
    } catch (err) {
      log.error("démarrage du navigateur impossible", {
        user: u.slug,
        slot: session.slot,
        error: errorMessage(err),
      });
      await d.removeBrowser(u.slug).catch(() => {});
      await db().delete(browserSessions).where(eq(browserSessions.id, session.id));
      throw err;
    }
  }

  /**
   * POST /api/browser/start : réutilise la session existante, sinon prend un slot libre,
   * sinon met en file d'attente (première arrivée, première servie).
   */
  async function start(userId: string, req: StartRequest): Promise<BrowserStatusView> {
    const [existing] = await db()
      .select()
      .from(browserSessions)
      .where(eq(browserSessions.userId, userId));
    if (existing) {
      // Arrêt en cours : le client réessaiera quand l'état sera « off ».
      if (existing.status === "stopping") return status(userId);
      await db()
        .update(browserSessions)
        .set({
          lastHeartbeatAt: now(),
          stopRequestedAt: null,
          ...(req.url ? { pendingUrl: req.url, openedContent: req.opened ?? null } : {}),
          platform: req.platform,
        })
        .where(eq(browserSessions.id, existing.id));
      return status(userId);
    }

    const queued = await queuePosition(userId);
    if (queued !== null) {
      await db()
        .update(browserQueue)
        .set({
          platform: req.platform,
          pendingUrl: req.url ?? null,
          openedContent: req.opened ?? null,
          lastSeenAt: now(),
        })
        .where(eq(browserQueue.userId, userId));
      return status(userId);
    }

    // Équité : si d'autres attendent déjà, on passe derrière eux.
    const [waiting] = await db().select({ n: count() }).from(browserQueue);
    const session = (waiting?.n ?? 0) === 0 ? await reserveSlot(userId, req) : null;
    if (!session) {
      await db()
        .insert(browserQueue)
        .values({
          userId,
          platform: req.platform,
          pendingUrl: req.url ?? null,
          openedContent: req.opened ?? null,
          requestedAt: now(),
          lastSeenAt: now(),
        })
        .onConflictDoNothing();
      const u = await userInfo(userId);
      log.info("mis en file d'attente", {
        user: u?.slug ?? null,
        position: await queuePosition(userId),
      });
      return status(userId);
    }
    if (!session.containerId) await launch(session);
    return status(userId);
  }

  /** Vérifie la santé de Neko pour une session « starting » et la passe en « ready ». */
  async function promoteIfReady(session: BrowserSession, slug: string): Promise<BrowserSession> {
    if (session.status !== "starting" || !session.containerId) return session;
    const ok = await probe(healthUrl(slug, session.slot, cfg()));
    if (!ok) return session;
    const [updated] = await db()
      .update(browserSessions)
      .set({ status: "ready", readyAt: now() })
      .where(and(eq(browserSessions.id, session.id), eq(browserSessions.status, "starting")))
      .returning();
    if (!updated) return session;
    log.info("navigateur prêt", {
      user: slug,
      slot: updated.slot,
      startupSeconds: Math.round((now().getTime() - updated.createdAt.getTime()) / 1000),
    });
    if (hooks.onReady) {
      await hooks
        .onReady(updated, slug)
        .catch((err: unknown) =>
          log.warn("action à la disponibilité", { user: slug, error: errorMessage(err) }),
        );
    }
    return updated;
  }

  async function status(userId: string): Promise<BrowserStatusView> {
    const [row] = await db()
      .select({ session: browserSessions, slug: users.slug })
      .from(browserSessions)
      .innerJoin(users, eq(users.id, browserSessions.userId))
      .where(eq(browserSessions.userId, userId));
    if (row) {
      const s = await promoteIfReady(row.session, row.slug);
      return {
        state: s.status,
        slot: s.slot,
        slug: row.slug,
        platform: s.platform,
        stillWatchingPrompt: s.stillWatchingPromptAt !== null,
        sleep: { at: s.sleepAt?.toISOString() ?? null, afterEpisode: s.sleepAfterEpisode },
        opened: s.openedContent ?? null,
        pendingUrl: s.pendingUrl,
        error: s.lastError,
        nekoPassword: nekoAdminPassword(s.id),
      };
    }
    const [q] = await db()
      .select({ platform: browserQueue.platform })
      .from(browserQueue)
      .where(eq(browserQueue.userId, userId));
    if (q) {
      await db()
        .update(browserQueue)
        .set({ lastSeenAt: now() })
        .where(eq(browserQueue.userId, userId));
      return {
        state: "queued",
        position: (await queuePosition(userId)) ?? 1,
        platform: q.platform,
      };
    }
    return { state: "off" };
  }

  /** Heartbeat (toutes les 20 s) : annule une demande d'arrêt, garde la place en file. */
  async function heartbeat(userId: string): Promise<BrowserStatusView> {
    await db()
      .update(browserSessions)
      .set({ lastHeartbeatAt: now(), stopRequestedAt: null })
      .where(eq(browserSessions.userId, userId));
    return status(userId);
  }

  /** sendBeacon sur pagehide : arrêt différé (un rechargement l'annule). */
  async function leave(userId: string): Promise<void> {
    await db()
      .update(browserSessions)
      .set({ stopRequestedAt: now() })
      .where(eq(browserSessions.userId, userId));
    await db().delete(browserQueue).where(eq(browserQueue.userId, userId));
  }

  async function stillWatching(userId: string): Promise<void> {
    await db()
      .update(browserSessions)
      .set({ lastInteractionAt: now(), stillWatchingPromptAt: null })
      .where(eq(browserSessions.userId, userId));
  }

  /** Minuteur de sommeil : arrêt à une heure donnée, à la fin de l'épisode, ou annulation. */
  async function setSleep(userId: string, mode: SleepMode): Promise<void> {
    await db()
      .update(browserSessions)
      .set(
        mode.kind === "minutes"
          ? { sleepAt: new Date(now().getTime() + mode.minutes * 60_000), sleepAfterEpisode: false }
          : { sleepAt: null, sleepAfterEpisode: mode.kind === "episode" },
      )
      .where(eq(browserSessions.userId, userId));
  }

  /** Arrête + supprime le navigateur et libère le slot. Idempotent. */
  async function stopSession(session: BrowserSession, slug: string, reason: string): Promise<void> {
    await db()
      .update(browserSessions)
      .set({ status: "stopping" })
      .where(eq(browserSessions.id, session.id));
    if (hooks.beforeStop) {
      await hooks
        .beforeStop(session, slug)
        .catch((err: unknown) =>
          log.warn("dernière capture avant arrêt", { user: slug, error: errorMessage(err) }),
        );
    }
    const d = docker();
    try {
      await d.stopBrowser(slug, 10);
      await d.removeBrowser(slug);
    } catch (err) {
      log.error("arrêt du conteneur", { user: slug, error: errorMessage(err) });
    }
    const deleted = await db()
      .delete(browserSessions)
      .where(eq(browserSessions.id, session.id))
      .returning({ id: browserSessions.id });
    const durationSeconds = Math.max(
      0,
      Math.round((now().getTime() - session.createdAt.getTime()) / 1000),
    );
    // Arrêts concurrents (worker + Quitter) : seul celui qui a supprimé la ligne journalise.
    if (deleted.length > 0) {
      await db()
        .insert(browserEvents)
        .values({
          userId: session.userId,
          slug,
          platform: session.platform,
          startedAt: session.createdAt,
          stoppedAt: now(),
          durationSeconds,
          reason: reason.slice(0, 200),
        })
        .catch((err: unknown) =>
          log.warn("journal des séances", { user: slug, error: errorMessage(err) }),
        );
    }
    log.info("séance terminée", { user: slug, slot: session.slot, reason, durationSeconds });
  }

  /** Vide la file d'attente (admin). Renvoie le nombre d'entrées retirées. */
  async function clearQueue(): Promise<number> {
    const removed = await db().delete(browserQueue).returning({ userId: browserQueue.userId });
    return removed.length;
  }

  async function stopForUser(userId: string, reason: string): Promise<void> {
    await db().delete(browserQueue).where(eq(browserQueue.userId, userId));
    const [row] = await db()
      .select({ session: browserSessions, slug: users.slug })
      .from(browserSessions)
      .innerJoin(users, eq(users.id, browserSessions.userId))
      .where(eq(browserSessions.userId, userId));
    if (row) {
      await stopSession(row.session, row.slug, reason);
      return;
    }
    // Pas de session en base : on nettoie quand même un éventuel conteneur résiduel.
    const u = await userInfo(userId);
    if (u) {
      await docker()
        .removeBrowser(u.slug)
        .catch(() => {});
    }
  }

  /** Sert la file : tant qu'il y a un slot libre, le premier en attente obtient son navigateur. */
  async function serveQueue(): Promise<number> {
    let served = 0;
    for (;;) {
      const session = await db().transaction(async (tx) => {
        const [first] = await tx
          .select()
          .from(browserQueue)
          .orderBy(asc(browserQueue.requestedAt), asc(browserQueue.userId))
          .limit(1)
          .for("update", { skipLocked: true });
        if (!first) return null;
        const reserved = await reserveSlot(
          first.userId,
          { platform: first.platform, url: first.pendingUrl, opened: first.openedContent },
          tx as unknown as Db,
        );
        if (!reserved) return null;
        await tx.delete(browserQueue).where(eq(browserQueue.userId, first.userId));
        return reserved;
      });
      if (!session) return served;
      try {
        await launch(session);
        served++;
        if (hooks.onQueueServed) {
          void hooks
            .onQueueServed(session.userId, session.platform)
            .catch((err: unknown) =>
              log.warn("notification de file", { error: errorMessage(err) }),
            );
        }
      } catch {
        // launch a déjà loggé et libéré le slot ; on passe au suivant au prochain tour.
        return served;
      }
    }
  }

  /** Une itération du worker (toutes les 10 s). */
  async function tick(): Promise<void> {
    const c = cfg();
    const t = now();
    const ago = (seconds: number) => new Date(t.getTime() - seconds * 1000);

    // 1. Popup « Tu regardes toujours ? » après STILL_WATCHING_HOURS sans interaction.
    await db()
      .update(browserSessions)
      .set({ stillWatchingPromptAt: t })
      .where(
        and(
          isNull(browserSessions.stillWatchingPromptAt),
          eq(browserSessions.status, "ready"),
          lt(browserSessions.lastInteractionAt, ago(c.STILL_WATCHING_HOURS * 3600)),
        ),
      );

    // 2. Arrêts : onglet fermé, heartbeat perdu, popup expirée, démarrage bloqué.
    const toStop = await db()
      .select({ session: browserSessions, slug: users.slug })
      .from(browserSessions)
      .innerJoin(users, eq(users.id, browserSessions.userId))
      .where(
        or(
          lte(browserSessions.stopRequestedAt, ago(c.LEAVE_GRACE_SECONDS)),
          lt(browserSessions.lastHeartbeatAt, ago(c.HEARTBEAT_TIMEOUT_SECONDS)),
          lte(browserSessions.stillWatchingPromptAt, ago(c.STILL_WATCHING_GRACE_MINUTES * 60)),
          lte(browserSessions.sleepAt, t),
          and(
            eq(browserSessions.status, "starting"),
            lt(browserSessions.createdAt, ago(c.BROWSER_START_TIMEOUT_SECONDS)),
          ),
          and(eq(browserSessions.status, "stopping"), lt(browserSessions.createdAt, ago(30))),
        ),
      );
    for (const { session, slug } of toStop) {
      const reason =
        session.stopRequestedAt && session.stopRequestedAt <= ago(c.LEAVE_GRACE_SECONDS)
          ? "onglet fermé"
          : session.stillWatchingPromptAt &&
              session.stillWatchingPromptAt <= ago(c.STILL_WATCHING_GRACE_MINUTES * 60)
            ? "pas de réponse à « Tu regardes toujours ? »"
            : session.lastHeartbeatAt < ago(c.HEARTBEAT_TIMEOUT_SECONDS)
              ? "heartbeat perdu"
              : session.sleepAt && session.sleepAt <= t
                ? "minuteur de sommeil"
                : session.status === "starting"
                  ? "démarrage trop long"
                  : "arrêt inachevé";
      await stopSession(session, slug, reason).catch((err: unknown) =>
        log.error("arrêt", { user: slug, error: errorMessage(err) }),
      );
    }

    // 3. File d'attente : on retire les entrées abandonnées, puis on sert.
    const dropped = await db()
      .delete(browserQueue)
      .where(lt(browserQueue.lastSeenAt, ago(c.HEARTBEAT_TIMEOUT_SECONDS)))
      .returning({ userId: browserQueue.userId });
    if (dropped.length > 0)
      log.info("entrées de file abandonnées retirées", { count: dropped.length });
    const served = await serveQueue();
    if (served > 0) log.info("file d'attente servie", { count: served });

    // 4. Démarrages en cours : passage en « ready » dès que Neko répond.
    const starting = await db()
      .select({ session: browserSessions, slug: users.slug })
      .from(browserSessions)
      .innerJoin(users, eq(users.id, browserSessions.userId))
      .where(and(eq(browserSessions.status, "starting"), isNotNull(browserSessions.containerId)));
    for (const { session, slug } of starting) await promoteIfReady(session, slug);
  }

  /**
   * Réconciliation base ↔ Docker (démarrage du worker, puis périodiquement) :
   * conteneurs netflop.managed sans session → supprimés ; sessions sans conteneur → nettoyées.
   */
  async function reconcile(): Promise<{ removedContainers: number; removedSessions: number }> {
    const d = docker();
    const containers = await d.listBrowsers();
    const rows = await db()
      .select({ session: browserSessions, slug: users.slug })
      .from(browserSessions)
      .innerJoin(users, eq(users.id, browserSessions.userId));
    const bySlug = new Map(rows.map((r) => [r.slug, r]));
    const containerSlugs = new Set(containers.map((c) => c.user));
    const graceLimit = new Date(now().getTime() - 60_000);

    let removedContainers = 0;
    for (const c of containers) {
      const row = bySlug.get(c.user);
      const orphan = !row || (row.session.containerId && row.session.containerId !== c.id);
      if (orphan && c.createdAt < graceLimit) {
        await d.removeBrowser(c.user).catch(() => {});
        removedContainers++;
        log.warn("conteneur orphelin supprimé", { user: c.user, slot: c.slot });
      } else if (!c.running && row && row.session.status !== "starting") {
        // Chrome/Neko planté : on libère le slot.
        await stopSession(row.session, row.slug, "conteneur arrêté");
      }
    }

    let removedSessions = 0;
    for (const r of rows) {
      if (!containerSlugs.has(r.slug) && r.session.createdAt < graceLimit) {
        await db().delete(browserSessions).where(eq(browserSessions.id, r.session.id));
        removedSessions++;
        log.warn("session sans conteneur nettoyée", { user: r.slug, slot: r.session.slot });
      }
    }
    return { removedContainers, removedSessions };
  }

  /** Sessions actives (worker : suivi, admin). */
  async function activeSessions() {
    return db()
      .select({
        session: browserSessions,
        slug: users.slug,
        displayName: users.displayName,
        pausedStopMinutes: users.pausedStopMinutes,
      })
      .from(browserSessions)
      .innerJoin(users, eq(users.id, browserSessions.userId))
      .orderBy(asc(browserSessions.slot));
  }

  async function queue() {
    return db()
      .select({
        userId: browserQueue.userId,
        platform: browserQueue.platform,
        requestedAt: browserQueue.requestedAt,
        slug: users.slug,
        displayName: users.displayName,
      })
      .from(browserQueue)
      .innerJoin(users, eq(users.id, browserQueue.userId))
      .orderBy(asc(browserQueue.requestedAt), asc(browserQueue.userId));
  }

  async function setPendingNavigation(
    userId: string,
    url: string,
    opened: OpenedContent | null,
  ): Promise<void> {
    await db()
      .update(browserSessions)
      .set({ pendingUrl: url, openedContent: opened, lastHeartbeatAt: now() })
      .where(eq(browserSessions.userId, userId));
    await db()
      .update(browserQueue)
      .set({ pendingUrl: url, openedContent: opened })
      .where(eq(browserQueue.userId, userId));
  }

  async function clearPendingNavigation(sessionId: string, url: string): Promise<void> {
    await db()
      .update(browserSessions)
      .set({ pendingUrl: null })
      .where(and(eq(browserSessions.id, sessionId), eq(browserSessions.pendingUrl, url)));
  }

  async function setOpenedContent(userId: string, opened: OpenedContent | null): Promise<void> {
    await db()
      .update(browserSessions)
      .set({ openedContent: opened })
      .where(eq(browserSessions.userId, userId));
  }

  async function setError(userId: string, error: string | null): Promise<void> {
    await db()
      .update(browserSessions)
      .set({ lastError: error })
      .where(eq(browserSessions.userId, userId));
  }

  return {
    start,
    status,
    heartbeat,
    leave,
    stillWatching,
    setSleep,
    clearQueue,
    stopForUser,
    stopSession,
    serveQueue,
    tick,
    reconcile,
    activeSessions,
    queue,
    setPendingNavigation,
    clearPendingNavigation,
    setOpenedContent,
    setError,
    promoteIfReady,
  };
}

export type Lifecycle = ReturnType<typeof createLifecycle>;

let defaultLifecycle: Lifecycle | undefined;
export function lifecycle(): Lifecycle {
  defaultLifecycle ??= createLifecycle();
  return defaultLifecycle;
}

/* Raccourcis utilisés par Auth.js (déconnexion), le profil et l'admin. */

export async function stopBrowserForUser(userId: string, reason: string): Promise<void> {
  await lifecycle().stopForUser(userId, reason);
}

export async function stopBrowserForSlug(slug: string, reason: string): Promise<void> {
  const [u] = await getDb().select({ id: users.id }).from(users).where(eq(users.slug, slug));
  if (u) await lifecycle().stopForUser(u.id, reason);
}

export type BrowserState =
  { state: "off" } | { state: "running" | "starting"; slot: number | null };

/** État pour la page profil : session en base, sinon conteneur résiduel éventuel. */
export async function browserStateForSlug(slug: string): Promise<BrowserState> {
  const [row] = await getDb()
    .select({ status: browserSessions.status, slot: browserSessions.slot })
    .from(browserSessions)
    .innerJoin(users, eq(users.id, browserSessions.userId))
    .where(eq(users.slug, slug));
  if (row) return { state: row.status === "ready" ? "running" : "starting", slot: row.slot };
  const info = await createDockerClient().inspect(slug);
  if (!info) return { state: "off" };
  return { state: info.running ? "running" : "starting", slot: info.slot };
}
