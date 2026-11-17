import type { ReactNode } from "react";

/**
 * « Regarder ensemble » côté invité : plein écran comme la lecture, mais l'authentification
 * est faite par la page elle-même, pour revenir sur le lien d'invitation après connexion.
 */
export default function EnsembleLayout({ children }: { children: ReactNode }) {
  return <div className="fixed inset-0 bg-black">{children}</div>;
}
