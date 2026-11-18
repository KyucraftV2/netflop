"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth-guard";
import { lifecycle } from "@/lib/browser-lifecycle";
import { stopBrowserForSlug } from "@/lib/browser-service";
import { browserStateForSlug } from "@/lib/browser-lifecycle";
import { SLUG_REGEX } from "@/lib/browser-spec";
import { removeProfileVolume } from "@/lib/docker";
import { errorMessage, logger } from "@/lib/log";
import type { ActionResult } from "./profile";

const log = logger("admin");
const slugSchema = z.object({ slug: z.string().regex(SLUG_REGEX) });

export async function adminStopBrowser(input: { slug: string }): Promise<ActionResult> {
  const admin = await requireAdmin();
  const parsed = slugSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Utilisateur invalide" };
  await stopBrowserForSlug(parsed.data.slug, `arrêt par l'admin ${admin.slug}`);
  log.info("navigateur arrêté par un admin", { admin: admin.slug, user: parsed.data.slug });
  revalidatePath("/admin");
  return { ok: true, message: "Navigateur arrêté" };
}

export async function adminClearQueue(input: { confirm: boolean }): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!z.object({ confirm: z.literal(true) }).safeParse(input).success) {
    return { ok: false, error: "Confirmation requise" };
  }
  const n = await lifecycle().clearQueue();
  log.info("file d'attente vidée par un admin", { admin: admin.slug, count: n });
  revalidatePath("/admin");
  return { ok: true, message: n ? `${n} personne(s) retirée(s) de la file` : "La file était vide" };
}

/** Supprime le profil Chrome d'un utilisateur (navigateur éteint uniquement). */
export async function adminResetProfile(input: {
  slug: string;
  confirm: boolean;
}): Promise<ActionResult> {
  const admin = await requireAdmin();
  const parsed = slugSchema.extend({ confirm: z.literal(true) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Entrée invalide" };
  const { slug } = parsed.data;
  const state = await browserStateForSlug(slug);
  if (state.state !== "off") {
    return { ok: false, error: "Arrête d'abord le navigateur de cet utilisateur." };
  }
  try {
    const removed = await removeProfileVolume(slug);
    log.info("profil Chrome supprimé par un admin", { admin: admin.slug, user: slug, removed });
    revalidatePath("/admin");
    return {
      ok: true,
      message: removed ? "Profil Chrome supprimé" : "Aucun profil Chrome pour cet utilisateur",
    };
  } catch (err) {
    log.error("suppression du profil Chrome", { user: slug, error: errorMessage(err) });
    return { ok: false, error: "Suppression impossible pour le moment." };
  }
}
