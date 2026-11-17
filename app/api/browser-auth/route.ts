import { and, eq, gt } from "drizzle-orm";
import { checkBrowserAccess } from "@/lib/browser-auth";
import { getDb } from "@/lib/db";
import { sessions, users } from "@/lib/db/schema";
import { errorMessage, logger } from "@/lib/log";

export const dynamic = "force-dynamic";

const log = logger("browser-auth");

/**
 * forwardAuth Traefik pour /b/<slug>/… :
 *   401 sans session valide, 403 si <slug> n'est pas l'utilisateur connecté,
 *   200 + X-Netflop-User sinon. Le cookie n'est jamais loggé.
 */
export async function GET(request: Request) {
  const uri = request.headers.get("x-forwarded-uri");
  const ip = request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip");
  try {
    const result = await checkBrowserAccess(
      { uri, cookie: request.headers.get("cookie") },
      async (token) => {
        const [row] = await getDb()
          .select({ slug: users.slug, expires: sessions.expires })
          .from(sessions)
          .innerJoin(users, eq(users.id, sessions.userId))
          .where(and(eq(sessions.sessionToken, token), gt(sessions.expires, new Date())));
        return row ?? null;
      },
    );

    if (result.status === 200) {
      return new Response(null, {
        status: 200,
        headers: { "X-Netflop-User": result.slug, "Cache-Control": "no-store" },
      });
    }
    log.warn("accès navigateur refusé", {
      status: result.status,
      requested: result.requested,
      user: result.status === 403 ? result.slug : null,
      ip,
      reason: result.reason,
    });
    return new Response(result.status === 401 ? "Non authentifié" : "Accès refusé", {
      status: result.status,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    log.error("forwardAuth en erreur", { error: errorMessage(err) });
    return new Response("Erreur", { status: 503 });
  }
}
