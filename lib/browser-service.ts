import { eq } from "drizzle-orm";
import {
  lifecycle,
  registerLifecycleHooks,
  type BrowserStatusView,
  type StartRequest,
} from "./browser-lifecycle";
import { navigate } from "./cdp";
import { notifyQueueServed } from "./notifications";
import { getDb } from "./db";
import { hintToQuality, type ConnectionHint } from "./browser-spec";
import { browserSessions, users, type BrowserSession } from "./db/schema";
import { errorMessage, logger } from "./log";
import { createTracker, type Tracker } from "./tracker/tracker";

/**
 * Point d'entrée du hub et du worker : cycle de vie + actions branchées dessus
 * (navigation vers l'URL demandée quand le navigateur est prêt ; dernière capture du
 * suivi avant arrêt, ajoutée à l'étape 5).
 */

const log = logger("browser");
const PENDING_GIVE_UP_MS = 60_000;
const inFlight = new Set<string>();

/** Ouvre pendingUrl dans le Chrome de la session (une seule tentative à la fois par session). */
export async function deliverPendingNavigation(
  session: BrowserSession,
  slug: string,
): Promise<void> {
  const url = session.pendingUrl;
  if (!url || session.status !== "ready" || inFlight.has(session.id)) return;
  inFlight.add(session.id);
  try {
    await navigate(session.slot, url);
    await lifecycle().clearPendingNavigation(session.id, url);
    await lifecycle().setError(session.userId, null);
  } catch (err) {
    const since = Date.now() - (session.readyAt ?? session.createdAt).getTime();
    log.warn("navigation différée", { user: slug, error: errorMessage(err) });
    if (since > PENDING_GIVE_UP_MS) {
      await lifecycle().clearPendingNavigation(session.id, url);
      log.error("ouverture abandonnée", { user: slug });
    }
  } finally {
    inFlight.delete(session.id);
  }
}

let registered = false;
let trackerInstance: Tracker | undefined;

export function tracker(): Tracker {
  trackerInstance ??= createTracker(lifecycle());
  return trackerInstance;
}

/**
 * Branche les actions sur le cycle de vie : navigation à la disponibilité (étape 4) et
 * dernière capture de progression avant tout arrêt de navigateur (étape 5).
 */
export function ensureBrowserHooks(): void {
  if (registered) return;
  registered = true;
  registerLifecycleHooks({
    onReady: deliverPendingNavigation,
    beforeStop: (session, slug) => tracker().finalCapture(session, slug),
    onQueueServed: (userId, platform) => notifyQueueServed(userId, platform),
  });
}

async function retryPending(userId: string, status: BrowserStatusView): Promise<BrowserStatusView> {
  if (status.state !== "ready" || !status.pendingUrl) return status;
  const [session] = await getDb()
    .select()
    .from(browserSessions)
    .where(eq(browserSessions.userId, userId));
  if (session) await deliverPendingNavigation(session, status.slug);
  return lifecycle().status(userId);
}

/** Qualité « auto » : mémorise l'estimation de connexion envoyée par l'appareil. */
export async function rememberConnectionHint(userId: string, hint: ConnectionHint): Promise<void> {
  await getDb()
    .update(users)
    .set({ autoQualityHint: hintToQuality(hint) })
    .where(eq(users.id, userId));
}

/** Démarre/rejoint le navigateur et ouvre l'URL demandée (immédiatement s'il tourne déjà). */
export async function startAndOpen(userId: string, req: StartRequest): Promise<BrowserStatusView> {
  ensureBrowserHooks();
  return retryPending(userId, await lifecycle().start(userId, req));
}

export async function browserStatus(userId: string): Promise<BrowserStatusView> {
  ensureBrowserHooks();
  return retryPending(userId, await lifecycle().status(userId));
}

export async function browserHeartbeat(userId: string): Promise<BrowserStatusView> {
  ensureBrowserHooks();
  return lifecycle().heartbeat(userId);
}

export { lifecycle };

/** Arrêts déclenchés côté hub (Quitter, déconnexion, admin) : avec dernière capture. */
export async function stopBrowserForUser(userId: string, reason: string): Promise<void> {
  ensureBrowserHooks();
  await lifecycle().stopForUser(userId, reason);
}

export async function stopBrowserForSlug(slug: string, reason: string): Promise<void> {
  ensureBrowserHooks();
  const { stopBrowserForSlug: stop } = await import("./browser-lifecycle");
  await stop(slug, reason);
}
