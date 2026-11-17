import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireUser } from "@/lib/auth-guard";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db";
import { browserSessions } from "@/lib/db/schema";
import { HttpError, parseJson, route } from "@/lib/http";
import { createNekoApi, safeNeko } from "@/lib/neko-api";
import { nekoAdminPassword } from "@/lib/neko-secret";
import { createInvite, InviteError, listInvites, revokeInvites } from "@/lib/watch-party";

export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store" };

/** Invitations actives de ma séance. */
export const GET = route(async () => {
  const user = await requireUser();
  return Response.json({ invites: await listInvites(user.id) }, { headers: noStore });
});

/** Crée un lien « Regarder ensemble » pour ma séance en cours. */
export const POST = route(async () => {
  const user = await requireUser();
  let invite;
  try {
    invite = await createInvite(user.id);
  } catch (err) {
    if (err instanceof InviteError) throw new HttpError(err.status, err.message);
    throw err;
  }
  // Lecture seule par défaut pour les invités : seul l'hôte (admin Neko) prend le contrôle.
  const [s] = await getDb()
    .select({ id: browserSessions.id, slot: browserSessions.slot })
    .from(browserSessions)
    .where(eq(browserSessions.userId, user.id));
  if (s) {
    await safeNeko("verrouillage du contrôle", () =>
      createNekoApi(
        { slug: user.slug, slot: s.slot, adminPassword: nekoAdminPassword(s.id) },
        getConfig(),
      ).lockControls(),
    );
  }
  return Response.json(
    { id: invite.id, path: `/ensemble/${invite.token}`, expiresAt: invite.expiresAt },
    { status: 201, headers: noStore },
  );
});

/** Révoque une invitation (id) ou toutes. */
export const DELETE = route(async (req: Request) => {
  const user = await requireUser();
  const { id } = await parseJson(req, z.object({ id: z.uuid().optional() }).strict());
  const n = await revokeInvites(user.id, id);
  return Response.json({ revoked: n }, { headers: noStore });
});
