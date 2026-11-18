"use client";

import { Copy, Link2, MousePointer2, Share2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

interface Invite {
  id: string;
  guestSlug: string | null;
  guestName: string | null;
  expiresAt: string;
}

async function json<T>(res: Response): Promise<T> {
  const b = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(b.error ?? `HTTP ${res.status}`);
  return b;
}

/**
 * « Regarder ensemble » côté hôte : lien d'invitation à usage unique, invités connectés,
 * contrôle prêté ou repris, révocation.
 */
export function InvitePanel({ onClose }: { onClose: () => void }) {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [link, setLink] = useState<string | null>(null);
  const [controlTo, setControlTo] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/browser/invite", { cache: "no-store" }).catch(() => null);
    if (res?.ok) setInvites(((await res.json()) as { invites: Invite[] }).invites);
  }, []);

  useEffect(() => {
    const first = window.setTimeout(() => void refresh(), 0);
    const id = window.setInterval(() => void refresh(), 10_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [refresh]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
      void refresh();
    }
  };

  const create = () =>
    run(async () => {
      const r = await json<{ path: string }>(
        await fetch("/api/browser/invite", { method: "POST" }),
      );
      setLink(new URL(r.path, window.location.origin).href);
    });

  const copy = async () => {
    if (!link) return;
    await navigator.clipboard.writeText(link).catch(() => {});
    setMsg("Lien copié");
  };

  const share = async () => {
    if (link && navigator.share) {
      await navigator.share({ title: "Regarder ensemble sur Netflop", url: link }).catch(() => {});
    }
  };

  const control = (inv: Invite, give: boolean) =>
    run(async () => {
      const res = await fetch("/api/browser/invite/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteId: inv.id, give }),
      });
      if (!res.ok) await json(res);
      setControlTo(give ? inv.id : null);
      setMsg(give ? `${inv.guestName ?? "Ton invité"} a le contrôle` : "Tu as repris le contrôle");
    });

  const revoke = (inv: Invite) =>
    run(async () => {
      await json(
        await fetch("/api/browser/invite", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: inv.id }),
        }),
      );
      if (controlTo === inv.id) setControlTo(null);
    });

  return (
    <div
      role="dialog"
      aria-label="Regarder ensemble"
      className="safe-px absolute top-16 right-2 z-40 w-[min(92vw,24rem)] rounded-tile bg-surface/95 p-4 shadow-pop backdrop-blur md:right-4"
    >
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Regarder ensemble</h2>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Fermer">
          <X />
        </Button>
      </div>
      <p className="mt-1 text-xs text-muted">
        Invite un membre de Netflop dans ton navigateur. Il regarde en lecture seule ; tu peux lui
        prêter la souris et le clavier. Le lien ne sert qu&apos;une fois et expire à la fin de ta
        séance (3 h au plus).
      </p>

      {link ? (
        <div className="mt-3 flex items-center gap-2">
          <input
            readOnly
            value={link}
            aria-label="Lien d'invitation"
            className="min-h-11 min-w-0 flex-1 rounded-card bg-black/40 px-3 text-xs"
            onFocus={(e) => e.currentTarget.select()}
          />
          <Button size="icon" variant="ghost" onClick={copy} aria-label="Copier le lien">
            <Copy />
          </Button>
          {typeof navigator !== "undefined" && "share" in navigator ? (
            <Button size="icon" variant="ghost" onClick={share} aria-label="Partager le lien">
              <Share2 />
            </Button>
          ) : null}
        </div>
      ) : null}
      <Button className="mt-3" onClick={create} disabled={busy}>
        <Link2 aria-hidden /> {link ? "Nouveau lien" : "Créer un lien d'invitation"}
      </Button>

      {invites.length > 0 ? (
        <ul className="mt-4 space-y-2" aria-label="Invitations">
          {invites.map((inv) => (
            <li
              key={inv.id}
              className="flex items-center gap-2 rounded-card bg-black/30 p-2 text-sm"
            >
              <span className="min-w-0 flex-1 truncate">
                {inv.guestName ?? <span className="text-muted">Lien pas encore ouvert</span>}
              </span>
              {inv.guestSlug ? (
                <Button
                  size="sm"
                  variant={controlTo === inv.id ? "light" : "ghost"}
                  disabled={busy}
                  onClick={() => control(inv, controlTo !== inv.id)}
                >
                  <MousePointer2 aria-hidden />
                  {controlTo === inv.id ? "Reprendre" : "Prêter le contrôle"}
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => revoke(inv)}
                aria-label={`Retirer l'invitation${inv.guestName ? ` de ${inv.guestName}` : ""}`}
              >
                Retirer
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {msg ? (
        <p role="status" className="mt-3 text-xs text-muted">
          {msg}
        </p>
      ) : null}
    </div>
  );
}
