"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { authentikEndSessionUrl, signOut } from "@/auth";
import { requireUser } from "@/lib/auth-guard";
import { browserStateForSlug } from "@/lib/browser-lifecycle";
import { getDb } from "@/lib/db";
import { accounts, userSubscriptions, users } from "@/lib/db/schema";
import { removeProfileVolume } from "@/lib/docker";
import { errorMessage, logger } from "@/lib/log";
import { PLATFORM_IDS } from "@/lib/platforms";
import { PAUSE_CHOICES } from "@/lib/sleep";

const log = logger("profile");

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

const subscriptionsSchema = z.object({
  platforms: z.array(z.enum(PLATFORM_IDS)).max(PLATFORM_IDS.length),
});

async function writeSubscriptions(userId: string, platforms: readonly string[]) {
  const db = getDb();
  const unique = [...new Set(platforms)] as (typeof PLATFORM_IDS)[number][];
  await db.transaction(async (tx) => {
    await tx.delete(userSubscriptions).where(eq(userSubscriptions.userId, userId));
    if (unique.length > 0) {
      await tx.insert(userSubscriptions).values(unique.map((platform) => ({ userId, platform })));
    }
  });
}

export async function saveSubscriptions(input: { platforms: string[] }): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = subscriptionsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Sélection invalide" };
  await writeSubscriptions(user.id, parsed.data.platforms);
  revalidatePath("/", "layout");
  return { ok: true, message: "Abonnements enregistrés" };
}

export async function completeOnboarding(input: { platforms: string[] }): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = subscriptionsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Sélection invalide" };
  await writeSubscriptions(user.id, parsed.data.platforms);
  await getDb().update(users).set({ onboardedAt: new Date() }).where(eq(users.id, user.id));
  log.info("onboarding terminé", { user: user.slug, platforms: parsed.data.platforms.join(",") });
  revalidatePath("/", "layout");
  redirect("/");
}

const qualitySchema = z.object({ quality: z.enum(["normal", "saver", "auto"]) });

export async function saveVideoQuality(input: { quality: string }): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = qualitySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Qualité invalide" };
  await getDb()
    .update(users)
    .set({ videoQuality: parsed.data.quality })
    .where(eq(users.id, user.id));
  revalidatePath("/profil");
  return { ok: true, message: "Appliqué au prochain démarrage du navigateur" };
}

const pauseSchema = z.object({
  minutes: z
    .number()
    .int()
    .refine((m) => (PAUSE_CHOICES as readonly number[]).includes(m))
    .nullable(),
});

/** Délai d'arrêt sur pause (NULL = valeur de l'admin, qui reste le plafond). */
export async function savePausedStop(input: { minutes: number | null }): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = pauseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Délai invalide" };
  await getDb()
    .update(users)
    .set({ pausedStopMinutes: parsed.data.minutes })
    .where(eq(users.id, user.id));
  revalidatePath("/profil");
  return { ok: true, message: "Enregistré" };
}

const notifSchema = z.object({ newEpisodes: z.boolean(), queue: z.boolean() });

export async function saveNotificationPrefs(input: {
  newEpisodes: boolean;
  queue: boolean;
}): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = notifSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Préférences invalides" };
  await getDb()
    .update(users)
    .set({ notifyNewEpisodes: parsed.data.newEpisodes, notifyQueue: parsed.data.queue })
    .where(eq(users.id, user.id));
  return { ok: true, message: "Enregistré" };
}

/** Supprime le volume netflop-profile-<slug> (navigateur éteint uniquement). */
export async function resetBrowser(input: { confirm: boolean }): Promise<ActionResult> {
  const user = await requireUser();
  if (!z.object({ confirm: z.literal(true) }).safeParse(input).success) {
    return { ok: false, error: "Confirmation requise" };
  }
  const state = await browserStateForSlug(user.slug);
  if (state.state !== "off") {
    return { ok: false, error: "Quitte d'abord ta séance : le navigateur doit être éteint." };
  }
  try {
    await removeProfileVolume(user.slug);
  } catch (err) {
    log.error("réinitialisation du navigateur", { user: user.slug, error: errorMessage(err) });
    return { ok: false, error: "Réinitialisation impossible pour le moment." };
  }
  log.info("navigateur réinitialisé", { user: user.slug });
  revalidatePath("/profil");
  return {
    ok: true,
    message: "Navigateur réinitialisé : reconnecte-toi à tes plateformes à la prochaine séance.",
  };
}

/** Déconnexion complète : session Netflop supprimée, navigateur arrêté, puis Authentik. */
export async function logout(): Promise<void> {
  const user = await requireUser();
  const [acc] = await getDb()
    .select({ idToken: accounts.id_token })
    .from(accounts)
    .where(and(eq(accounts.userId, user.id), eq(accounts.provider, "authentik")));
  // Déclenche events.signOut (arrêt du navigateur, purge du cache forwardAuth).
  await signOut({ redirect: false });
  redirect(authentikEndSessionUrl(acc?.idToken ?? null));
}
