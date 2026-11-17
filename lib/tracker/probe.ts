import type { DomSelectors } from "../platforms";

/**
 * Script évalué par CDP dans chaque frame, dans un monde isolé, EN LECTURE SEULE :
 * il ne modifie jamais la page et ne lit ni cookies ni stockage. Il renvoie l'URL, le
 * titre du document, les métadonnées mediaSession, la plus grande <video> et le texte
 * des sélecteurs DOM de la plateforme.
 */

export interface ProbeVideo {
  currentTime: number;
  duration: number;
  paused: boolean;
  ended: boolean;
  area: number;
}

export interface ProbeResult {
  href: string;
  title: string;
  media: { title: string; artist: string; album: string } | null;
  video: ProbeVideo | null;
  dom: { title: string | null; episode: string | null };
}

export function buildProbeExpression(selectors: DomSelectors): string {
  const sel = JSON.stringify({ title: selectors.title ?? [], episode: selectors.episode ?? [] });
  // Uniquement des lectures de propriétés : aucune affectation sur des objets de la page.
  return `(() => {
  const SEL = ${sel};
  const text = (list) => {
    for (const s of list) {
      try {
        const el = document.querySelector(s);
        const t = el && el.textContent ? el.textContent.replace(/\\s+/g, " ").trim() : "";
        if (t) return t.slice(0, 300);
      } catch (e) {}
    }
    return null;
  };
  let video = null;
  for (const v of Array.from(document.querySelectorAll("video"))) {
    const r = v.getBoundingClientRect();
    const area = Math.max(r.width * r.height, (v.videoWidth || 0) * (v.videoHeight || 0));
    if (!video || area > video.area) {
      video = {
        currentTime: Number(v.currentTime) || 0,
        duration: Number.isFinite(v.duration) ? Number(v.duration) : 0,
        paused: Boolean(v.paused),
        ended: Boolean(v.ended),
        area,
      };
    }
  }
  const md = navigator.mediaSession && navigator.mediaSession.metadata;
  return {
    href: String(location.href).slice(0, 2000),
    title: String(document.title || "").slice(0, 300),
    media: md ? { title: String(md.title || ""), artist: String(md.artist || ""), album: String(md.album || "") } : null,
    video,
    dom: { title: text(SEL.title), episode: text(SEL.episode) },
  };
})()`;
}
