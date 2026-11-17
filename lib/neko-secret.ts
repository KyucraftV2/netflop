import { createHmac } from "node:crypto";

/**
 * Mots de passe Neko propres à chaque séance, dérivés (HMAC) du secret serveur : rien
 * n'est stocké. Sans eux, un processus qui atteindrait le port de Neko (autre conteneur
 * compromis, réseau Traefik…) ne peut pas prendre le contrôle du navigateur d'un
 * utilisateur connecté à ses plateformes.
 */

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16 || s.startsWith("<")) {
    throw new Error("AUTH_SECRET manquant ou trop court (mots de passe Neko)");
  }
  return s;
}

function derive(label: string, sessionId: string): string {
  return createHmac("sha256", secret())
    .update(`netflop-neko:${label}:${sessionId}`)
    .digest("base64url")
    .slice(0, 32);
}

/** Mot de passe « admin » Neko : donné uniquement au propriétaire de la séance. */
export function nekoAdminPassword(sessionId: string): string {
  return derive("admin", sessionId);
}

/** Mot de passe « user » Neko : jamais communiqué (le rôle spectateur est inutilisé). */
export function nekoUserPassword(sessionId: string): string {
  return derive("user", sessionId);
}
