"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth-guard";
import {
  addToWatchlist,
  removeFromWatchlist,
  WATCHLIST_MAX,
  watchlistItemSchema,
} from "@/lib/watchlist";
import type { ActionResult } from "./profile";

const toggleSchema = z.discriminatedUnion("inList", [
  z.object({ inList: z.literal(true), item: watchlistItemSchema }),
  z.object({
    inList: z.literal(false),
    item: z.object({ tmdbId: z.number().int().positive(), type: z.enum(["movie", "tv"]) }),
  }),
]);

/** Ajoute (inList: true) ou retire (inList: false) un titre de « Ma liste ». */
export async function setInWatchlist(input: z.input<typeof toggleSchema>): Promise<ActionResult> {
  const user = await requireUser();
  const p = toggleSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Entrée invalide" };
  if (p.data.inList) {
    const added = await addToWatchlist(user.id, p.data.item);
    if (!added) return { ok: false, error: `Ta liste est pleine (${WATCHLIST_MAX} titres).` };
  } else {
    await removeFromWatchlist(user.id, p.data.item.tmdbId, p.data.item.type);
  }
  revalidatePath("/");
  return { ok: true };
}
