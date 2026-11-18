"use client";

import { ArrowLeft, Keyboard, Maximize, Minimize, Users, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import { PLATFORMS, type PlatformId } from "@/lib/platforms";
import { cn } from "@/lib/utils";
import { SleepMenu, type SleepChoice, type SleepState } from "./sleep-menu";

const HIDE_AFTER_MS = 3_000;

type FsElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };
type FsDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void>;
};

function fullscreenSupported(): boolean {
  const el = document.documentElement as FsElement;
  return Boolean(el.requestFullscreen || el.webkitRequestFullscreen);
}

export function Toolbar({
  platform,
  title,
  containerRef,
  onQuit,
  onKeyboard,
  keyboardOpen,
  canUseBrowser,
  sleep,
  onSleep,
  onInvite,
  inviteOpen,
}: {
  platform: PlatformId;
  title: string | null;
  containerRef: RefObject<HTMLDivElement | null>;
  onQuit: () => void;
  onKeyboard: () => void;
  keyboardOpen: boolean;
  canUseBrowser: boolean;
  sleep: SleepState | null;
  onSleep: (c: SleepChoice) => void;
  onInvite: () => void;
  inviteOpen: boolean;
}) {
  const p = PLATFORMS[platform];
  const [visible, setVisible] = useState(true);
  const [isFs, setIsFs] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const hovering = useRef(false);

  const show = useCallback(() => {
    setVisible(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      if (!hovering.current) setVisible(false);
    }, HIDE_AFTER_MS);
  }, []);

  useEffect(() => {
    timer.current = window.setTimeout(() => {
      if (!hovering.current) setVisible(false);
    }, HIDE_AFTER_MS);
    const events = ["pointermove", "pointerdown", "keydown", "touchstart"] as const;
    const attach = (target: Window | null) =>
      events.forEach((e) => target?.addEventListener(e, show, { passive: true }));
    const detach = (target: Window | null) =>
      events.forEach((e) => target?.removeEventListener(e, show));
    attach(window);
    // Mouvements au-dessus de l'iframe Neko (même origine).
    let frameWin: Window | null = null;
    const hook = () => {
      detach(frameWin);
      try {
        frameWin = containerRef.current?.querySelector("iframe")?.contentWindow ?? null;
        attach(frameWin);
      } catch {
        frameWin = null;
      }
    };
    const id = window.setInterval(hook, 2_000);
    hook();
    return () => {
      detach(window);
      detach(frameWin);
      window.clearInterval(id);
      window.clearTimeout(timer.current);
    };
  }, [show, containerRef]);

  useEffect(() => {
    const onChange = () => {
      const d = document as FsDocument;
      setIsFs(Boolean(d.fullscreenElement ?? d.webkitFullscreenElement));
    };
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
    };
  }, []);

  // Raccourcis clavier (ordinateur) : Alt+Maj+F plein écran, Alt+Maj+K clavier, Alt+Maj+Q quitter.
  // Écoutés aussi dans l'iframe Neko (même origine), en capture pour ne pas les transmettre
  // au Chrome distant.
  const actions = useRef({ fullscreen: () => {}, keyboard: onKeyboard, quit: onQuit });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey) return;
      const a = actions.current;
      const fn = { KeyF: a.fullscreen, KeyK: a.keyboard, KeyQ: a.quit }[e.code];
      if (!fn) return;
      e.preventDefault();
      e.stopPropagation();
      fn();
    };
    let frameWin: Window | null = null;
    const hook = () => {
      frameWin?.removeEventListener("keydown", onKey, true);
      try {
        frameWin = containerRef.current?.querySelector("iframe")?.contentWindow ?? null;
        frameWin?.addEventListener("keydown", onKey, true);
      } catch {
        frameWin = null;
      }
    };
    window.addEventListener("keydown", onKey, true);
    const id = window.setInterval(hook, 2_000);
    hook();
    return () => {
      window.removeEventListener("keydown", onKey, true);
      frameWin?.removeEventListener("keydown", onKey, true);
      window.clearInterval(id);
    };
  }, [containerRef]);

  const toggleFullscreen = async () => {
    const d = document as FsDocument;
    if (d.fullscreenElement ?? d.webkitFullscreenElement) {
      await (d.exitFullscreen?.() ?? d.webkitExitFullscreen?.());
      return;
    }
    const el = (containerRef.current ?? document.documentElement) as FsElement;
    if (!fullscreenSupported()) {
      // iPhone : pas de Fullscreen API hors <video>.
      setHint(
        "Sur iPhone : ajoute Netflop à l'écran d'accueil (Partager → Sur l'écran d'accueil) et tourne ton téléphone en paysage.",
      );
      window.setTimeout(() => setHint(null), 8_000);
      return;
    }
    try {
      await (el.requestFullscreen?.({ navigationUI: "hide" }) ?? el.webkitRequestFullscreen?.());
      await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> })
        .lock?.("landscape")
        .catch(() => {});
    } catch {
      /* refusé par le navigateur */
    }
  };

  useEffect(() => {
    actions.current = {
      fullscreen: () => void toggleFullscreen(),
      keyboard: onKeyboard,
      quit: onQuit,
    };
  });

  return (
    <>
      {/* Zone de rappel de la barre (toujours présente, invisible) */}
      <div
        className="safe-top absolute inset-x-0 top-0 z-20 h-10"
        onPointerEnter={show}
        onPointerDown={show}
        aria-hidden
      />
      <div
        role="toolbar"
        aria-label="Commandes de lecture"
        onPointerEnter={() => {
          hovering.current = true;
          show();
        }}
        onPointerLeave={() => {
          hovering.current = false;
          show();
        }}
        onFocusCapture={show}
        className={cn(
          "safe-top safe-x absolute inset-x-0 top-0 z-30 bg-gradient-to-b from-black/85 to-transparent transition-all duration-300",
          visible ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-full opacity-0",
        )}
      >
        <div className="flex items-center gap-2 px-2 py-2 md:px-4">
          <Button asChild variant="ghost" size="icon" aria-label="Retour à l'accueil">
            <Link href="/">
              <ArrowLeft />
            </Link>
          </Button>
          <span
            className="hidden h-7 items-center rounded-[4px] px-2 sm:flex"
            style={{ backgroundColor: p.tileColor }}
          >
            <Image src={p.logo} alt={p.name} width={80} height={24} className="h-4 w-auto" />
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-semibold md:text-base">
            {title ?? p.name}
          </span>
          <Button
            variant={keyboardOpen ? "light" : "ghost"}
            size="icon"
            onClick={onKeyboard}
            disabled={!canUseBrowser}
            aria-label="Clavier"
            aria-pressed={keyboardOpen}
            title="Clavier (Alt+Maj+K)"
          >
            <Keyboard />
          </Button>
          <Button
            variant={inviteOpen ? "light" : "ghost"}
            size="icon"
            onClick={onInvite}
            disabled={!canUseBrowser}
            aria-label="Regarder ensemble"
            aria-pressed={inviteOpen}
            title="Regarder ensemble"
          >
            <Users />
          </Button>
          {sleep ? <SleepMenu sleep={sleep} onChoose={onSleep} disabled={!canUseBrowser} /> : null}
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleFullscreen}
            aria-label={isFs ? "Quitter le plein écran" : "Plein écran"}
            title={`${isFs ? "Quitter le plein écran" : "Plein écran"} (Alt+Maj+F)`}
          >
            {isFs ? <Minimize /> : <Maximize />}
          </Button>
          <Button
            variant="primary"
            size="sm"
            className="min-h-11"
            onClick={onQuit}
            title="Quitter (Alt+Maj+Q)"
          >
            <X aria-hidden /> Quitter
          </Button>
        </div>
      </div>
      {hint ? (
        <div
          role="status"
          className="safe-px absolute inset-x-4 top-20 z-30 mx-auto max-w-md rounded-tile bg-surface p-4 text-sm shadow-pop"
        >
          {hint}
        </div>
      ) : null}
    </>
  );
}
