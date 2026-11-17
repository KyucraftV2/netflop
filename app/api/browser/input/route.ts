import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireUser } from "@/lib/auth-guard";
import { insertText, pressKey, REMOTE_KEYS, type RemoteKey } from "@/lib/cdp";
import { getDb } from "@/lib/db";
import { browserSessions } from "@/lib/db/schema";
import { HttpError, parseJson, route } from "@/lib/http";

export const dynamic = "force-dynamic";

const bodySchema = z.union([
  z.object({ text: z.string().min(1).max(512) }).strict(),
  z.object({ key: z.enum(Object.keys(REMOTE_KEYS) as [RemoteKey, ...RemoteKey[]]) }).strict(),
]);

/**
 * Clavier distant : texte (Input.insertText) ou touche spéciale vers le Chrome de
 * l'utilisateur. Le contenu n'est JAMAIS loggé (identifiants possibles).
 */
export const POST = route(async (req: Request) => {
  const user = await requireUser();
  const body = await parseJson(req, bodySchema);
  const [session] = await getDb()
    .select({ slot: browserSessions.slot, status: browserSessions.status })
    .from(browserSessions)
    .where(eq(browserSessions.userId, user.id));
  if (!session || session.status !== "ready") throw new HttpError(409, "Navigateur non prêt");
  if ("text" in body) await insertText(session.slot, body.text);
  else await pressKey(session.slot, body.key);
  return new Response(null, { status: 204 });
});
