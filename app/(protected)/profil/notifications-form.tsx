"use client";

import { Bell, BellOff } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { saveNotificationPrefs } from "@/app/actions/profile";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

type DeviceState = "loading" | "unsupported" | "denied" | "off" | "on";

function base64UrlToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  return (
    (await navigator.serviceWorker.getRegistration("/")) ??
    navigator.serviceWorker.register("/sw.js", { scope: "/" })
  );
}

async function send(method: "POST" | "DELETE", body: unknown) {
  const res = await fetch("/api/push/subscribe", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const b = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(b.error ?? `HTTP ${res.status}`);
  }
}

export function NotificationsForm({
  publicKey,
  initial,
}: {
  /** Clé VAPID publique ; null = notifications non configurées sur le serveur. */
  publicKey: string | null;
  initial: { newEpisodes: boolean; queue: boolean };
}) {
  const [device, setDevice] = useState<DeviceState>("loading");
  const [prefs, setPrefs] = useState(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let state: DeviceState;
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !publicKey) {
        state = "unsupported";
      } else if (Notification.permission === "denied") {
        state = "denied";
      } else {
        const reg = await navigator.serviceWorker.getRegistration("/");
        state = (await reg?.pushManager.getSubscription()) ? "on" : "off";
      }
      if (!cancelled) setDevice(state);
    })();
    return () => {
      cancelled = true;
    };
  }, [publicKey]);

  const enable = () =>
    start(async () => {
      try {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          setDevice(permission === "denied" ? "denied" : "off");
          return;
        }
        const reg = await registration();
        await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64UrlToBytes(publicKey!),
        });
        await send("POST", sub.toJSON());
        setDevice("on");
        setMsg({ ok: true, text: "Notifications activées sur cet appareil" });
      } catch (err) {
        setMsg({ ok: false, text: (err as Error).message || "Activation impossible" });
      }
    });

  const disable = () =>
    start(async () => {
      try {
        const reg = await navigator.serviceWorker.getRegistration("/");
        const sub = await reg?.pushManager.getSubscription();
        if (sub) {
          await send("DELETE", { endpoint: sub.endpoint }).catch(() => {});
          await sub.unsubscribe();
        }
        setDevice("off");
        setMsg({ ok: true, text: "Notifications désactivées sur cet appareil" });
      } catch {
        setMsg({ ok: false, text: "Désactivation impossible" });
      }
    });

  const test = () =>
    start(async () => {
      const res = await fetch("/api/push/test", { method: "POST" });
      const b = (await res.json().catch(() => ({}))) as { sent?: number; error?: string };
      setMsg(
        res.ok
          ? { ok: true, text: `Notification envoyée à ${b.sent ?? 0} appareil(s)` }
          : { ok: false, text: b.error ?? "Envoi impossible" },
      );
    });

  const savePref = (next: typeof prefs) => {
    setPrefs(next);
    start(async () => {
      const r = await saveNotificationPrefs(next);
      if (!r.ok) setMsg({ ok: false, text: r.error });
    });
  };

  if (!publicKey) {
    return (
      <p className="mt-4 text-sm text-muted">
        Les notifications ne sont pas configurées sur ce serveur (clés VAPID absentes).
      </p>
    );
  }

  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {device === "on" ? (
          <>
            <Button variant="outline" onClick={disable} disabled={pending}>
              <BellOff aria-hidden /> Désactiver sur cet appareil
            </Button>
            <Button variant="ghost" onClick={test} disabled={pending}>
              Envoyer un test
            </Button>
          </>
        ) : (
          <Button
            onClick={enable}
            disabled={
              pending || device === "loading" || device === "unsupported" || device === "denied"
            }
          >
            <Bell aria-hidden /> Activer sur cet appareil
          </Button>
        )}
      </div>
      {device === "unsupported" ? (
        <p className="text-sm text-muted">
          Cet appareil ne gère pas les notifications web. Sur iPhone et iPad : ajoute d&apos;abord
          Netflop à l&apos;écran d&apos;accueil (iOS 16.4 ou plus récent), puis ouvre-le depuis
          l&apos;icône.
        </p>
      ) : null}
      {device === "denied" ? (
        <p className="text-sm text-muted">
          Les notifications sont bloquées pour Netflop dans les réglages du navigateur.
        </p>
      ) : null}

      <fieldset className="space-y-3" disabled={pending}>
        <legend className="sr-only">Types de notifications</legend>
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
          <Switch
            checked={prefs.newEpisodes}
            onCheckedChange={(v) => savePref({ ...prefs, newEpisodes: v })}
            aria-label="Nouveaux épisodes des séries que je regarde"
          />
          Nouveaux épisodes des séries que je regarde
        </label>
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
          <Switch
            checked={prefs.queue}
            onCheckedChange={(v) => savePref({ ...prefs, queue: v })}
            aria-label="Quand mon tour arrive dans la file d'attente"
          />
          Quand mon tour arrive dans la file d&apos;attente
        </label>
      </fieldset>
      {msg ? (
        <p role="status" className={msg.ok ? "text-sm text-muted" : "text-sm text-danger"}>
          {msg.text}
        </p>
      ) : null}
    </div>
  );
}
