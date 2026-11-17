"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { browserApi, type BrowserStatusView } from "@/lib/client/browser-api";
import { createTicker } from "@/lib/client/ticker";
import { PLATFORMS, type PlatformId } from "@/lib/platforms";
import { KeyboardPanel } from "./keyboard-panel";
import { RotateHint } from "./rotate-hint";
import { SoundOverlay } from "./sound-overlay";
import { StatusScreen, type ScreenKind } from "./status-screen";
import { StillWatchingDialog } from "./still-watching-dialog";
import type { SleepChoice } from "./sleep-menu";
import { Toolbar } from "./toolbar";

const HEARTBEAT_MS = 20_000;
const POLL_MS = 2_000;
const INTERACTION_THROTTLE_MS = 60_000;

type Active = Extract<BrowserStatusView, { state: "starting" | "ready" | "stopping" }>;

export function WatchClient({
  platform,
  slug,
  alreadyRequested,
}: {
  platform: PlatformId;
  slug: string;
  alreadyRequested: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<BrowserStatusView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [frameLoaded, setFrameLoaded] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const quittingRef = useRef(false);
  const lastInteractionRef = useRef(0);
  const prevStateRef = useRef<string | null>(null);

  const platformInfo = PLATFORMS[platform];

  /* ---------- démarrage ---------- */
  const start = useCallback(async () => {
    setError(null);
    try {
      setStatus(await browserApi.start(platform));
    } catch {
      setError("Impossible de démarrer ton navigateur.");
    }
  }, [platform]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = alreadyRequested ? await browserApi.status() : await browserApi.start(platform);
        if (!cancelled) setStatus(s);
      } catch {
        if (!cancelled) setError("Impossible de démarrer ton navigateur.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [platform, alreadyRequested]);

  /* ---------- sondage rapide tant que le navigateur n'est pas prêt ---------- */
  const state = status?.state ?? null;
  const pendingOpen = status && "pendingUrl" in status ? status.pendingUrl : null;
  useEffect(() => {
    if (state === "ready" && !pendingOpen) return;
    if (state === "off" || error) return;
    const id = window.setInterval(async () => {
      try {
        const s = await browserApi.status();
        // Arrêt terminé pendant qu'on attendait : on relance.
        if (s.state === "off" && prevStateRef.current === "stopping") {
          await start();
          return;
        }
        setStatus(s);
      } catch {
        /* réseau : on réessaie au prochain tour */
      }
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [state, pendingOpen, error, start]);

  /* ---------- heartbeat (y compris onglet en arrière-plan) ---------- */
  useEffect(() => {
    return createTicker(HEARTBEAT_MS, async () => {
      if (quittingRef.current) return;
      try {
        setStatus(await browserApi.heartbeat());
      } catch {
        /* réseau : le prochain heartbeat rattrapera */
      }
    });
  }, []);

  /* ---------- départ : fermeture d'onglet ou navigation interne ---------- */
  useEffect(() => {
    const onPageHide = () => {
      if (!quittingRef.current) browserApi.leave();
    };
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      // Navigation interne (bouton Retour…) : pagehide ne se déclenche pas.
      if (!quittingRef.current) browserApi.leave();
    };
  }, []);

  /* ---------- notification quand on sort de la file ---------- */
  useEffect(() => {
    const prev = prevStateRef.current;
    prevStateRef.current = state;
    if (prev === "queued" && (state === "starting" || state === "ready")) {
      document.title = "▶ C'est ton tour ! · Netflop";
      if (document.hidden && "Notification" in window && Notification.permission === "granted") {
        new Notification("Netflop", { body: "C'est ton tour : ton navigateur se prépare." });
      }
    }
  }, [state]);

  /* ---------- interactions (pour « Tu regardes toujours ? ») ---------- */
  const reportInteraction = useCallback(() => {
    const now = Date.now();
    if (now - lastInteractionRef.current < INTERACTION_THROTTLE_MS) return;
    lastInteractionRef.current = now;
    void browserApi.stillWatching().catch(() => {});
  }, []);

  useEffect(() => {
    const events = ["pointerdown", "keydown", "touchstart", "wheel"] as const;
    events.forEach((e) => window.addEventListener(e, reportInteraction, { passive: true }));
    // L'iframe Neko est sur la même origine : on écoute aussi ses interactions.
    let frameWin: Window | null = null;
    if (frameLoaded) {
      try {
        frameWin = frameRef.current?.contentWindow ?? null;
        events.forEach((e) =>
          frameWin?.addEventListener(e, reportInteraction, { passive: true, capture: true }),
        );
      } catch {
        frameWin = null;
      }
    }
    return () => {
      events.forEach((e) => window.removeEventListener(e, reportInteraction));
      events.forEach((e) =>
        frameWin?.removeEventListener(e, reportInteraction, {
          capture: true,
        } as EventListenerOptions),
      );
    };
  }, [frameLoaded, reportInteraction]);

  /* ---------- actions ---------- */
  const quit = useCallback(async () => {
    quittingRef.current = true;
    try {
      await browserApi.quit();
    } finally {
      router.push("/");
    }
  }, [router]);

  const answerStillWatching = useCallback(async () => {
    lastInteractionRef.current = Date.now();
    await browserApi.stillWatching().catch(() => {});
    setStatus((s) => (s && "stillWatchingPrompt" in s ? { ...s, stillWatchingPrompt: false } : s));
  }, []);

  const chooseSleep = useCallback(async (c: SleepChoice) => {
    const sleep =
      "minutes" in c
        ? { at: new Date(Date.now() + c.minutes * 60_000).toISOString(), afterEpisode: false }
        : { at: null, afterEpisode: c.mode === "episode" };
    setStatus((s) => (s && "sleep" in s ? { ...s, sleep } : s)); // optimiste
    await browserApi.sleep(c).catch(() => setError("Minuteur indisponible pour le moment."));
  }, []);

  const retry = useCallback(async () => {
    setStatus(null);
    setFrameLoaded(false);
    await browserApi.quit().catch(() => {});
    await start();
  }, [start]);

  /* ---------- rendu ---------- */
  const active: Active | null =
    status &&
    (status.state === "starting" || status.state === "ready" || status.state === "stopping")
      ? status
      : null;
  const ready = active?.state === "ready";
  const opening = ready && Boolean(active?.pendingUrl);
  const title = active?.opened?.title ?? null;

  let screen: ScreenKind | null = null;
  if (error) screen = "error";
  else if (!status) screen = "starting";
  else if (status.state === "queued") screen = "queued";
  else if (status.state === "off") screen = "ended";
  else if (status.state === "stopping") screen = "stopping";
  else if (status.state === "starting" || !frameLoaded) screen = "starting";
  else if (opening) screen = "opening";
  if (active?.error) screen = "error";

  const iframeSrc = active
    ? `/b/${slug}/?usr=${encodeURIComponent(slug)}&pwd=${encodeURIComponent(active.nekoPassword)}&embed=1`
    : null;

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden bg-black">
      {ready && iframeSrc ? (
        <iframe
          ref={frameRef}
          src={iframeSrc}
          title={`Navigateur Netflop — ${platformInfo.name}`}
          className="absolute inset-0 h-full w-full border-0"
          allow="autoplay; fullscreen; clipboard-read; clipboard-write; encrypted-media"
          allowFullScreen
          onLoad={() => setFrameLoaded(true)}
        />
      ) : null}

      {screen ? (
        <StatusScreen
          kind={screen}
          platform={platform}
          title={title}
          position={status?.state === "queued" ? status.position : null}
          errorMessage={active?.error ?? error}
          onRetry={retry}
          onQuit={quit}
        />
      ) : null}

      <Toolbar
        platform={platform}
        title={title}
        containerRef={containerRef}
        onQuit={quit}
        onKeyboard={() => setKeyboardOpen((o) => !o)}
        keyboardOpen={keyboardOpen}
        canUseBrowser={ready && !screen}
        sleep={active?.sleep ?? null}
        onSleep={(c) => void chooseSleep(c)}
      />

      {ready && !screen ? <SoundOverlay frameRef={frameRef} /> : null}
      {ready && !screen ? <RotateHint /> : null}
      {keyboardOpen && ready ? <KeyboardPanel onClose={() => setKeyboardOpen(false)} /> : null}

      <StillWatchingDialog
        open={Boolean(active && "stillWatchingPrompt" in active && active.stillWatchingPrompt)}
        onYes={answerStillWatching}
        onStop={quit}
      />
    </div>
  );
}
