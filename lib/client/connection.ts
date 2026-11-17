import type { ConnectionHint } from "@/lib/browser-spec";

type NetworkInformation = {
  effectiveType?: string;
  downlink?: number;
  saveData?: boolean;
};

/**
 * Estimation de la connexion pour la qualité « auto » (Network Information API).
 * Indisponible (Safari, Firefox) → undefined : le serveur garde la dernière estimation.
 */
export function connectionHint(): ConnectionHint | undefined {
  if (typeof navigator === "undefined") return undefined;
  const c = (navigator as Navigator & { connection?: NetworkInformation }).connection;
  if (!c) return undefined;
  if (c.saveData) return "slow";
  if (c.effectiveType && ["slow-2g", "2g", "3g"].includes(c.effectiveType)) return "slow";
  // Débit estimé en Mb/s : le 720p de Neko demande environ 4 Mb/s.
  if (typeof c.downlink === "number" && c.downlink > 0 && c.downlink < 5) return "slow";
  return "fast";
}
