import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireUser } from "@/lib/auth-guard";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db";
import { browserSessions } from "@/lib/db/schema";
import { HttpError, parseJson, route } from "@/lib/http";
import { createNekoApi } from "@/lib/neko-api";
import { nekoAdminPassword } from "@/lib/neko-secret";
import { inviteGuestSlug } from "@/lib/watch-party";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ inviteId: z.uuid(), give: z.boolean() }).strict();

/** L'hôte passe le contrôle (souris, clavier) à son invité, ou le reprend. */
export const POST = route(async (req: Request) => {
  const user = await requireUser();
  const { inviteId, give } = await parseJson(req, bodySchema);
  const guest = await inviteGuestSlug(user.id, inviteId);
  if (!guest) throw new HttpError(404, "Invitation introuvable ou pas encore utilisée");
  const [s] = await getDb()
    .select({ id: browserSessions.id, slot: browserSessions.slot })
    .from(browserSessions)
    .where(eq(browserSessions.userId, user.id));
  if (!s) throw new HttpError(409, "Aucune séance en cours");
  const neko = createNekoApi(
    { slug: user.slug, slot: s.slot, adminPassword: nekoAdminPassword(s.id) },
    getConfig(),
  );
  try {
    if (give) {
      if (!(await neko.giveControl(guest))) {
        throw new HttpError(409, "Ton invité n'est pas connecté au navigateur");
      }
    } else {
      await neko.resetControl();
    }
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(502, "Le navigateur n'a pas répondu");
  }
  return new Response(null, { status: 204 });
});
