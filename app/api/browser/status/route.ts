import { requireUser } from "@/lib/auth-guard";
import { browserStatus } from "@/lib/browser-service";
import { route } from "@/lib/http";

export const dynamic = "force-dynamic";

/** starting | ready | queued (+ position) | stopping | off */
export const GET = route(async () => {
  const user = await requireUser();
  return Response.json(await browserStatus(user.id), {
    headers: { "Cache-Control": "no-store" },
  });
});
