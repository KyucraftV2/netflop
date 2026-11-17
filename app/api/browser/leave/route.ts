import { requireUser } from "@/lib/auth-guard";
import { lifecycle } from "@/lib/browser-lifecycle";
import { route } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * Appelé par navigator.sendBeacon sur pagehide : demande d'arrêt différée de 30 s
 * (annulée par le heartbeat suivant si la page est simplement rechargée).
 */
export const POST = route(async () => {
  const user = await requireUser();
  await lifecycle().leave(user.id);
  return new Response(null, { status: 204 });
});
