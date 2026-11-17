import { z } from "zod";
import { requireUser } from "@/lib/auth-guard";
import { rememberConnectionHint, startAndOpen } from "@/lib/browser-service";
import { parseJson, route } from "@/lib/http";
import { PLATFORM_IDS, PLATFORMS } from "@/lib/platforms";

export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    platform: z.enum(PLATFORM_IDS),
    /** Estimation de la connexion (qualité « auto »). */
    connection: z.enum(["fast", "slow"]).optional(),
  })
  .strict();

/** Démarre (ou rejoint) le navigateur de l'utilisateur, sur la page d'accueil de la plateforme. */
export const POST = route(async (req: Request) => {
  const user = await requireUser();
  const { platform, connection } = await parseJson(req, bodySchema);
  if (connection) await rememberConnectionHint(user.id, connection);
  const status = await startAndOpen(user.id, {
    platform,
    url: PLATFORMS[platform].homeUrl,
    opened: null,
  });
  return Response.json(status, { headers: { "Cache-Control": "no-store" } });
});
