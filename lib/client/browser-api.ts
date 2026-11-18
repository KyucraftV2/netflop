import type { BrowserStatusView } from "@/lib/browser-lifecycle";
import type { PlatformId } from "@/lib/platforms";
import { connectionHint } from "./connection";

export type { BrowserStatusView };

async function post<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  if (res.status === 401) {
    // Session expirée : rechargement complet vers /login (et non navigation client).
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = "/login";
    throw new Error("Non authentifié");
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const browserApi = {
  start: (platform: PlatformId) =>
    post<BrowserStatusView>("/api/browser/start", { platform, connection: connectionHint() }),
  sleep: (body: { mode: "off" | "episode" } | { minutes: number }) =>
    post<void>("/api/browser/sleep", body),
  heartbeat: () => post<BrowserStatusView>("/api/browser/heartbeat"),
  stillWatching: () => post<void>("/api/browser/still-watching"),
  quit: () => post<void>("/api/browser/quit"),
  status: async (): Promise<BrowserStatusView> => {
    const res = await fetch("/api/browser/status", { cache: "no-store" });
    if (res.status === 401) {
      // Session expirée : rechargement complet vers /login (et non navigation client).
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = "/login";
      throw new Error("Non authentifié");
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as BrowserStatusView;
  },
  /** Fiable pendant la fermeture de l'onglet. */
  leave: () => {
    if (!navigator.sendBeacon?.("/api/browser/leave")) {
      void fetch("/api/browser/leave", { method: "POST", keepalive: true });
    }
  },
  input: (payload: { text: string } | { key: "Enter" | "Backspace" | "Escape" | "Tab" }) =>
    post<void>("/api/browser/input", payload),
};
