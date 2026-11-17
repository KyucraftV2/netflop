import type { MetadataRoute } from "next";

/** PWA : ajout à l'écran d'accueil (iPhone/Android), sans barre du navigateur. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Netflop",
    short_name: "Netflop",
    description: "Ton hub de streaming privé",
    lang: "fr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#141414",
    theme_color: "#141414",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
