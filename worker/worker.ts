import { createAccessRevalidator } from "../lib/access-revalidation";
import { ensureBrowserHooks, lifecycle, stopBrowserForUser, tracker } from "../lib/browser-service";
import { getConfig } from "../lib/config";
import { closeDb } from "../lib/db";
import { createDockerClient } from "../lib/docker";
import { errorMessage, logger } from "../lib/log";
import { notifyNewEpisodes } from "../lib/notifications";
import { pushConfig } from "../lib/push";

/**
 * Worker Netflop : cycle de vie automatique des navigateurs.
 *  - toutes les 10 s : arrêts (onglet fermé, heartbeat perdu, popup expirée), file d'attente,
 *    passage en « ready » ;
 *  - au démarrage puis toutes les 60 s : réconciliation base ↔ Docker ;
 *  - toutes les TRACKER_INTERVAL_SECONDS : suivi de visionnage (CDP, lecture seule).
 */

const log = logger("worker");
const LOOP_MS = 10_000;
const RECONCILE_EVERY = 6;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const cfg = getConfig();
  const docker = createDockerClient({ config: cfg });
  ensureBrowserHooks();
  const lc = lifecycle();
  log.info("démarrage", { slots: cfg.MAX_ACTIVE_BROWSERS, ports: cfg.SLOT_PORTS.join(",") });

  while (!(await docker.ping())) await sleep(5_000);
  log.info("docker-proxy joignable");

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info("arrêt du worker", { signal });
    await closeDb().catch(() => {});
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  const r = await lc.reconcile();
  log.info("réconciliation initiale", r);

  // Sécurité : droits Authentik revérifiés (retrait du groupe → accès coupé).
  const access = createAccessRevalidator({
    intervalMinutes: cfg.ACCESS_RECHECK_MINUTES,
    stopBrowser: stopBrowserForUser,
  });
  void (async () => {
    while (!stopping) {
      await access
        .tick()
        .catch((err: unknown) => log.error("revérification", { error: errorMessage(err) }));
      await sleep(60_000);
    }
  })();

  // Notifications « nouvel épisode » : toutes les 6 h (une seule par épisode).
  void (async () => {
    if (!pushConfig()) {
      log.info("notifications push désactivées (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY absentes)");
      return;
    }
    while (!stopping) {
      await notifyNewEpisodes().catch((err: unknown) =>
        log.error("notifications", { error: errorMessage(err) }),
      );
      await sleep(6 * 60 * 60 * 1000);
    }
  })();

  // Suivi de visionnage : boucle indépendante (TRACKER_INTERVAL_SECONDS).
  void (async () => {
    while (!stopping) {
      const t0 = Date.now();
      await tracker()
        .tick()
        .catch((err: unknown) => log.error("suivi", { error: errorMessage(err) }));
      await sleep(Math.max(1_000, cfg.TRACKER_INTERVAL_SECONDS * 1000 - (Date.now() - t0)));
    }
  })();

  for (let i = 1; !stopping; i++) {
    const started = Date.now();
    try {
      await lc.tick();
      if (i % RECONCILE_EVERY === 0) {
        const res = await lc.reconcile();
        if (res.removedContainers + res.removedSessions > 0) log.info("réconciliation", res);
      }
    } catch (err) {
      log.error("boucle worker", { error: errorMessage(err) });
    }
    await sleep(Math.max(1_000, LOOP_MS - (Date.now() - started)));
  }
}

main().catch((err: unknown) => {
  log.error("erreur fatale", { error: errorMessage(err) });
  process.exit(1);
});
