import { requireUser } from "@/lib/auth-guard";
import { browserHeartbeat } from "@/lib/browser-service";
import { route } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Toutes les 20 s depuis /watch : garde le navigateur (ou la place en file) en vie. */
export const POST = route(async () => {
  const user = await requireUser();
  return Response.json(await browserHeartbeat(user.id), {
    headers: { "Cache-Control": "no-store" },
  });
});
