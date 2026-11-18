import { z } from "zod";
import { requireUser } from "@/lib/auth-guard";
import { lifecycle } from "@/lib/browser-lifecycle";
import { parseJson, route } from "@/lib/http";
import { SLEEP_MINUTES } from "@/lib/sleep";

export const dynamic = "force-dynamic";

const bodySchema = z.union([
  z.object({ mode: z.enum(["off", "episode"]) }).strict(),
  z
    .object({
      minutes: z
        .number()
        .int()
        .refine((m) => (SLEEP_MINUTES as readonly number[]).includes(m)),
    })
    .strict(),
]);

/** Minuteur de sommeil : arrêt dans N minutes, à la fin de l'épisode, ou annulation. */
export const POST = route(async (req: Request) => {
  const user = await requireUser();
  const body = await parseJson(req, bodySchema);
  await lifecycle().setSleep(
    user.id,
    "minutes" in body ? { kind: "minutes", minutes: body.minutes } : { kind: body.mode },
  );
  return new Response(null, { status: 204 });
});
