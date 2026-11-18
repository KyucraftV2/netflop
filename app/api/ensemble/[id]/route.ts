import { z } from "zod";
import { requireUser } from "@/lib/auth-guard";
import { route } from "@/lib/http";
import { guestInviteState } from "@/lib/watch-party";

export const dynamic = "force-dynamic";

/** État de l'invitation vu par l'invité (sa page le sonde toutes les 15 s). */
export const GET = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const parsed = z.uuid().safeParse(id);
  const state = parsed.success ? await guestInviteState(parsed.data, user.id) : "ended";
  return Response.json({ state }, { headers: { "Cache-Control": "no-store" } });
});
