import { requireUser } from "@/lib/auth-guard";
import { stopBrowserForUser } from "@/lib/browser-service";
import { route } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Bouton « Quitter » : arrêt immédiat. */
export const POST = route(async () => {
  const user = await requireUser();
  await stopBrowserForUser(user.id, "bouton Quitter");
  return new Response(null, { status: 204 });
});
