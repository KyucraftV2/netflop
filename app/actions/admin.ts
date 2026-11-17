"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth-guard";
import { stopBrowserForSlug } from "@/lib/browser-service";
import { SLUG_REGEX } from "@/lib/browser-spec";
import { logger } from "@/lib/log";
import type { ActionResult } from "./profile";

const log = logger("admin");

export async function adminStopBrowser(input: { slug: string }): Promise<ActionResult> {
  const admin = await requireAdmin();
  const parsed = z.object({ slug: z.string().regex(SLUG_REGEX) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Utilisateur invalide" };
  await stopBrowserForSlug(parsed.data.slug, `arrêt par l'admin ${admin.slug}`);
  log.info("navigateur arrêté par un admin", { admin: admin.slug, user: parsed.data.slug });
  revalidatePath("/admin");
  return { ok: true, message: "Navigateur arrêté" };
}
