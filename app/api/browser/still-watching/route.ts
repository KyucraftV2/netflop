import { requireUser } from "@/lib/auth-guard";
import { lifecycle } from "@/lib/browser-lifecycle";
import { route } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Interaction de l'utilisateur (ou réponse « Oui » à la popup) : repousse l'arrêt. */
export const POST = route(async () => {
  const user = await requireUser();
  await lifecycle().stillWatching(user.id);
  return new Response(null, { status: 204 });
});
