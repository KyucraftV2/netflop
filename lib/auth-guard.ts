import "server-only";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { HttpError } from "./http";

/**
 * Helpers d'autorisation pour route handlers, server actions et pages.
 * Aucune logique d'auth dans le middleware edge : tout passe par ici.
 */

export type SessionUser = {
  id: string;
  slug: string;
  role: "user" | "admin";
  displayName: string;
  onboarded: boolean;
  email?: string | null;
  image?: string | null;
};

export async function currentUser(): Promise<SessionUser | null> {
  const session = await auth();
  const u = session?.user;
  if (!u?.id || !u.slug) return null;
  return u as SessionUser;
}

/** Route handlers / server actions : 401 si pas de session. */
export async function requireUser(): Promise<SessionUser> {
  const u = await currentUser();
  if (!u) throw new HttpError(401, "Non authentifié");
  return u;
}

/** Route handlers / server actions : 403 si pas admin. */
export async function requireAdmin(): Promise<SessionUser> {
  const u = await requireUser();
  if (u.role !== "admin") throw new HttpError(403, "Réservé aux administrateurs");
  return u;
}

/** Pages : redirige vers /login si pas de session. */
export async function requirePageUser(): Promise<SessionUser> {
  const u = await currentUser();
  if (!u) redirect("/login");
  return u;
}
