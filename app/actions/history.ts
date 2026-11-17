"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth-guard";
import { logger } from "@/lib/log";
import {
  confirmIdentification,
  deleteAllHistory,
  deleteProgress,
  dismissFromContinue,
  setWatched,
} from "@/lib/watch-history";
import type { ActionResult } from "./profile";

const log = logger("history");
const idSchema = z.object({ id: z.number().int().positive() });

function done(message?: string): ActionResult {
  revalidatePath("/", "layout");
  return { ok: true, message };
}

export async function removeFromContinue(input: { id: number }): Promise<ActionResult> {
  const user = await requireUser();
  const p = idSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Entrée invalide" };
  await dismissFromContinue(user.id, p.data.id);
  return done();
}

export async function removeHistoryEntry(input: { id: number }): Promise<ActionResult> {
  const user = await requireUser();
  const p = idSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Entrée invalide" };
  await deleteProgress(user.id, p.data.id);
  return done("Entrée supprimée");
}

export async function markWatched(input: { id: number; watched: boolean }): Promise<ActionResult> {
  const user = await requireUser();
  const p = idSchema.extend({ watched: z.boolean() }).safeParse(input);
  if (!p.success) return { ok: false, error: "Entrée invalide" };
  await setWatched(user.id, p.data.id, p.data.watched);
  return done();
}

const confirmSchema = z.object({
  id: z.number().int().positive(),
  tmdbId: z.number().int().positive(),
  type: z.enum(["movie", "tv"]),
  season: z.number().int().min(1).max(500).optional(),
  episode: z.number().int().min(1).max(5000).optional(),
});

export async function confirmEntry(input: z.input<typeof confirmSchema>): Promise<ActionResult> {
  const user = await requireUser();
  const p = confirmSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Sélection invalide" };
  try {
    await confirmIdentification(user.id, p.data.id, p.data);
  } catch {
    return { ok: false, error: "Correction impossible pour le moment." };
  }
  return done("Identification corrigée");
}

export async function clearHistory(input: { confirm: boolean }): Promise<ActionResult> {
  const user = await requireUser();
  if (!z.object({ confirm: z.literal(true) }).safeParse(input).success) {
    return { ok: false, error: "Confirmation requise" };
  }
  await deleteAllHistory(user.id);
  log.info("historique effacé", { user: user.slug });
  return done("Historique supprimé");
}
