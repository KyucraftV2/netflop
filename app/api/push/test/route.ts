import { requireUser } from "@/lib/auth-guard";
import { HttpError, route } from "@/lib/http";
import { pushConfig, sendToUser } from "@/lib/push";

export const dynamic = "force-dynamic";

const lastTest = new Map<string, number>();

/** Notification de test vers tous les appareils de l'utilisateur (1 par 30 s). */
export const POST = route(async () => {
  const user = await requireUser();
  if (!pushConfig()) throw new HttpError(503, "Notifications non configurées sur ce serveur");
  const now = Date.now();
  if (now - (lastTest.get(user.id) ?? 0) < 30_000) {
    throw new HttpError(429, "Patiente quelques secondes avant un nouveau test");
  }
  lastTest.set(user.id, now);
  const sent = await sendToUser(user.id, {
    title: "Netflop",
    body: "Les notifications fonctionnent sur cet appareil.",
    url: "/profil",
    tag: "test",
  });
  return Response.json({ sent });
});
