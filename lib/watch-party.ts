import { createHash, randomBytes } from "node:crypto";
import { and, count, eq, gt, isNull } from "drizzle-orm";
import { getDb } from "./db";
import { browserSessions, users, watchInvites } from "./db/schema";
import { logger } from "./log";
import type { PlatformId } from "./platforms";

/**
 * « Regarder ensemble » : l'hôte invite un autre membre dans SON navigateur.
 *  - lien à usage unique : le premier membre qui l'ouvre devient l'invité ;
 *  - valable pour la séance en cours de l'hôte uniquement, et au plus INVITE_HOURS ;
 *  - l'invité rejoint Neko comme simple membre (mot de passe « user » de la séance) ;
 *  - aucun accès sans compte Netflop (page protégée + forwardAuth).
 */

const log = logger("watch-party");

export const INVITE_HOURS = 3;
export const MAX_ACTIVE_INVITES = 3;

export class InviteError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const INVITE_TOKEN_REGEX = /^[A-Za-z0-9_-]{32}$/;

function activeFilter(now: Date) {
  return and(isNull(watchInvites.revokedAt), gt(watchInvites.expiresAt, now));
}

async function hostSession(hostUserId: string) {
  const [s] = await getDb()
    .select()
    .from(browserSessions)
    .where(eq(browserSessions.userId, hostUserId));
  return s ?? null;
}

/** Crée un lien d'invitation pour la séance en cours de l'hôte. */
export async function createInvite(
  hostUserId: string,
  now = new Date(),
): Promise<{ id: string; token: string; expiresAt: Date }> {
  const session = await hostSession(hostUserId);
  if (!session || session.status === "stopping") {
    throw new InviteError(409, "Lance d'abord une lecture pour inviter quelqu'un.");
  }
  const db = getDb();
  const [{ n } = { n: 0 }] = await db
    .select({ n: count() })
    .from(watchInvites)
    .where(and(eq(watchInvites.sessionId, session.id), activeFilter(now)));
  if (n >= MAX_ACTIVE_INVITES) {
    throw new InviteError(429, `${MAX_ACTIVE_INVITES} invitations au plus par séance.`);
  }
  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(now.getTime() + INVITE_HOURS * 3_600_000);
  const [row] = await db
    .insert(watchInvites)
    .values({ tokenHash: hashToken(token), hostUserId, sessionId: session.id, expiresAt })
    .returning({ id: watchInvites.id });
  log.info("invitation créée", { invite: row!.id });
  return { id: row!.id, token, expiresAt };
}

export interface JoinedInvite {
  inviteId: string;
  hostSlug: string;
  hostName: string;
  platform: PlatformId;
  sessionId: string;
}

/** L'invité ouvre le lien : rattachement au premier membre, puis contrôles de validité. */
export async function acceptInvite(
  token: string,
  guestUserId: string,
  now = new Date(),
): Promise<JoinedInvite> {
  if (!INVITE_TOKEN_REGEX.test(token)) throw new InviteError(404, "Invitation introuvable.");
  const db = getDb();
  const [invite] = await db
    .select()
    .from(watchInvites)
    .where(eq(watchInvites.tokenHash, hashToken(token)));
  if (!invite || invite.revokedAt || invite.expiresAt <= now) {
    throw new InviteError(404, "Cette invitation n'est plus valable.");
  }
  if (invite.hostUserId === guestUserId) {
    throw new InviteError(400, "C'est ton propre navigateur : ouvre-le depuis l'accueil.");
  }
  if (invite.guestUserId === null) {
    // Rattachement atomique : un seul membre peut utiliser le lien.
    const bound = await db
      .update(watchInvites)
      .set({ guestUserId })
      .where(and(eq(watchInvites.id, invite.id), isNull(watchInvites.guestUserId)))
      .returning({ id: watchInvites.id });
    if (bound.length === 0) return acceptInvite(token, guestUserId, now);
  } else if (invite.guestUserId !== guestUserId) {
    throw new InviteError(403, "Ce lien a déjà été utilisé par un autre membre.");
  }
  const [host] = await db
    .select({
      slug: users.slug,
      name: users.displayName,
      sessionId: browserSessions.id,
      platform: browserSessions.platform,
      status: browserSessions.status,
    })
    .from(users)
    .innerJoin(browserSessions, eq(browserSessions.userId, users.id))
    .where(eq(users.id, invite.hostUserId));
  if (!host || host.sessionId !== invite.sessionId || host.status === "stopping") {
    throw new InviteError(410, "La séance de ton hôte est terminée.");
  }
  return {
    inviteId: invite.id,
    hostSlug: host.slug,
    hostName: host.name,
    platform: host.platform,
    sessionId: host.sessionId,
  };
}

/**
 * forwardAuth : <guestSlug> peut-il ouvrir /b/<hostSlug>/ ? Oui s'il a une invitation
 * active pour la séance EN COURS de l'hôte.
 */
export async function hasGuestAccess(
  guestSlug: string,
  hostSlug: string,
  now = new Date(),
): Promise<boolean> {
  const db = getDb();
  const [guest] = await db.select({ id: users.id }).from(users).where(eq(users.slug, guestSlug));
  if (!guest) return false;
  const rows = await db
    .select({ id: watchInvites.id })
    .from(watchInvites)
    .innerJoin(users, eq(users.id, watchInvites.hostUserId))
    .innerJoin(
      browserSessions,
      and(
        eq(browserSessions.userId, watchInvites.hostUserId),
        eq(browserSessions.id, watchInvites.sessionId),
      ),
    )
    .where(and(eq(users.slug, hostSlug), eq(watchInvites.guestUserId, guest.id), activeFilter(now)))
    .limit(1);
  return rows.length > 0;
}

/** État vu par l'invité (sondé régulièrement par sa page). */
export async function guestInviteState(
  inviteId: string,
  guestUserId: string,
  now = new Date(),
): Promise<"active" | "ended"> {
  const rows = await getDb()
    .select({ id: watchInvites.id })
    .from(watchInvites)
    .innerJoin(
      browserSessions,
      and(
        eq(browserSessions.userId, watchInvites.hostUserId),
        eq(browserSessions.id, watchInvites.sessionId),
      ),
    )
    .where(
      and(
        eq(watchInvites.id, inviteId),
        eq(watchInvites.guestUserId, guestUserId),
        activeFilter(now),
      ),
    )
    .limit(1);
  return rows.length > 0 ? "active" : "ended";
}

export interface HostInviteView {
  id: string;
  guestSlug: string | null;
  guestName: string | null;
  expiresAt: Date;
}

/** Invitations actives de la séance en cours de l'hôte. */
export async function listInvites(hostUserId: string, now = new Date()): Promise<HostInviteView[]> {
  const session = await hostSession(hostUserId);
  if (!session) return [];
  const rows = await getDb()
    .select({
      id: watchInvites.id,
      guestSlug: users.slug,
      guestName: users.displayName,
      expiresAt: watchInvites.expiresAt,
    })
    .from(watchInvites)
    .leftJoin(users, eq(users.id, watchInvites.guestUserId))
    .where(
      and(
        eq(watchInvites.hostUserId, hostUserId),
        eq(watchInvites.sessionId, session.id),
        activeFilter(now),
      ),
    );
  return rows;
}

/** Révoque une invitation (ou toutes, sans id) de l'hôte. */
export async function revokeInvites(hostUserId: string, inviteId?: string): Promise<number> {
  const rows = await getDb()
    .update(watchInvites)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(watchInvites.hostUserId, hostUserId),
        isNull(watchInvites.revokedAt),
        inviteId ? eq(watchInvites.id, inviteId) : undefined,
      ),
    )
    .returning({ id: watchInvites.id });
  return rows.length;
}

/** Invité d'une invitation active de l'hôte (pour lui passer ou reprendre le contrôle). */
export async function inviteGuestSlug(
  hostUserId: string,
  inviteId: string,
): Promise<string | null> {
  const [row] = await getDb()
    .select({ slug: users.slug })
    .from(watchInvites)
    .innerJoin(users, eq(users.id, watchInvites.guestUserId))
    .where(
      and(
        eq(watchInvites.id, inviteId),
        eq(watchInvites.hostUserId, hostUserId),
        activeFilter(new Date()),
      ),
    );
  return row?.slug ?? null;
}
