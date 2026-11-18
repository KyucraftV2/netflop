import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Jeton des sondes d'exploitation (/api/health?deep=1, /api/metrics), dans
 * METRICS_TOKEN. Absent ou trop court (< 32 caractères) → endpoints désactivés.
 */
export function opsTokenConfigured(): boolean {
  return (process.env.METRICS_TOKEN ?? "").length >= 32;
}

export function hasOpsToken(req: Request): boolean {
  const expected = process.env.METRICS_TOKEN ?? "";
  if (expected.length < 32) return false;
  const header = req.headers.get("authorization") ?? "";
  const m = /^Bearer (.+)$/.exec(header);
  if (!m) return false;
  // Comparaison à temps constant sur des empreintes de même longueur.
  const a = createHash("sha256").update(m[1]!).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
