import { z } from "zod";
import { requireUser } from "@/lib/auth-guard";
import { HttpError, parseJson, route } from "@/lib/http";
import {
  isAllowedPushEndpoint,
  pushConfig,
  removeSubscription,
  saveSubscription,
  subscriptionSchema,
} from "@/lib/push";

export const dynamic = "force-dynamic";

/** Enregistre l'abonnement push de cet appareil. */
export const POST = route(async (req: Request) => {
  const user = await requireUser();
  if (!pushConfig()) throw new HttpError(503, "Notifications non configurées sur ce serveur");
  const sub = await parseJson(req, subscriptionSchema);
  await saveSubscription(user.id, sub, req.headers.get("user-agent"));
  return new Response(null, { status: 204 });
});

/** Supprime l'abonnement de cet appareil. */
export const DELETE = route(async (req: Request) => {
  const user = await requireUser();
  const { endpoint } = await parseJson(
    req,
    z.object({ endpoint: z.string().max(1000).refine(isAllowedPushEndpoint) }),
  );
  await removeSubscription(user.id, endpoint);
  return new Response(null, { status: 204 });
});
