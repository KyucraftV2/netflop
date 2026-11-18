import { and, eq, inArray } from "drizzle-orm";
import webpush from "web-push";
import { z } from "zod";
import { getDb } from "./db";
import { pushSubscriptions } from "./db/schema";
import { errorMessage, logger } from "./log";

/**
 * Notifications Web Push (VAPID). Désactivées si les clés ne sont pas configurées :
 *   bunx web-push generate-vapid-keys  →  VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY dans .env
 */

const log = logger("push");

export interface PushConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export function pushConfig(
  env: Record<string, string | undefined> = process.env,
): PushConfig | null {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey || publicKey.startsWith("<")) return null;
  const subject = env.VAPID_SUBJECT?.trim() || (env.HUB_DOMAIN ? `https://${env.HUB_DOMAIN}` : "");
  if (!/^(mailto:|https:\/\/)/.test(subject)) return null;
  return { publicKey, privateKey, subject };
}

/**
 * Services de push des navigateurs. Le serveur envoie une requête à l'endpoint fourni
 * par le client : on n'accepte que ces hôtes (sinon le hub pourrait être utilisé pour
 * joindre un service interne).
 */
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/, // Chrome, Edge (Android), Opera
  /^updates\.push\.services\.mozilla\.com$/, // Firefox
  /^web\.push\.apple\.com$/, // Safari (macOS, iOS 16.4+)
  /^[a-z0-9-]+\.notify\.windows\.com$/, // Edge (Windows)
];

export function isAllowedPushEndpoint(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  return PUSH_HOSTS.some((re) => re.test(url.hostname));
}

export const subscriptionSchema = z.object({
  endpoint: z.string().max(1000).refine(isAllowedPushEndpoint, "service de push non reconnu"),
  keys: z.object({
    p256dh: z
      .string()
      .min(16)
      .max(200)
      .regex(/^[A-Za-z0-9_=-]+$/),
    auth: z
      .string()
      .min(8)
      .max(100)
      .regex(/^[A-Za-z0-9_=-]+$/),
  }),
});
export type SubscriptionInput = z.infer<typeof subscriptionSchema>;

/** Enregistre (ou rattache à cet utilisateur) l'abonnement d'un appareil. */
export async function saveSubscription(
  userId: string,
  sub: SubscriptionInput,
  userAgent: string | null,
): Promise<void> {
  const values = {
    userId,
    endpoint: sub.endpoint,
    p256dh: sub.keys.p256dh,
    auth: sub.keys.auth,
    userAgent: userAgent?.slice(0, 300) ?? null,
  };
  await getDb()
    .insert(pushSubscriptions)
    .values(values)
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: values });
}

export async function removeSubscription(userId: string, endpoint: string): Promise<void> {
  await getDb()
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)));
}

export async function countSubscriptions(userId: string): Promise<number> {
  const rows = await getDb()
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));
  return rows.length;
}

export interface PushPayload {
  title: string;
  body: string;
  /** Page du hub ouverte au clic (chemin relatif). */
  url: string;
  /** Une notification du même tag remplace la précédente. */
  tag?: string;
}

export type PushSender = (
  sub: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
  cfg: PushConfig,
) => Promise<void>;

const defaultSender: PushSender = async (sub, payload, cfg) => {
  await webpush.sendNotification(sub, payload, {
    vapidDetails: { subject: cfg.subject, publicKey: cfg.publicKey, privateKey: cfg.privateKey },
    TTL: 24 * 60 * 60,
    timeout: 10_000,
  });
};

/**
 * Envoie une notification à tous les appareils de l'utilisateur. Les abonnements
 * expirés (404/410) sont supprimés. Renvoie le nombre d'envois réussis.
 */
export async function sendToUser(
  userId: string,
  payload: PushPayload,
  deps: { sender?: PushSender; config?: PushConfig | null } = {},
): Promise<number> {
  const cfg = deps.config === undefined ? pushConfig() : deps.config;
  if (!cfg) return 0;
  if (!payload.url.startsWith("/") || payload.url.startsWith("//")) {
    throw new Error("URL de notification : chemin relatif attendu");
  }
  const send = deps.sender ?? defaultSender;
  const db = getDb();
  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));
  const body = JSON.stringify(payload);
  const expired: number[] = [];
  const ok: number[] = [];
  await Promise.all(
    subs.map(async (s) => {
      try {
        await send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, cfg);
        ok.push(s.id);
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) expired.push(s.id);
        else log.warn("envoi impossible", { status: status ?? null, error: errorMessage(err) });
      }
    }),
  );
  if (expired.length) {
    await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, expired));
  }
  if (ok.length) {
    await db
      .update(pushSubscriptions)
      .set({ lastSuccessAt: new Date() })
      .where(inArray(pushSubscriptions.id, ok));
  }
  return ok.length;
}
