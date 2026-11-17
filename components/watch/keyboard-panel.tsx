"use client";

import { CornerDownLeft, Delete, Send, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { browserApi } from "@/lib/client/browser-api";

/**
 * Clavier natif du téléphone → Chrome distant (CDP Input.insertText).
 * Indispensable pour saisir ses identifiants Netflix/Canal+ depuis un mobile.
 */
export function KeyboardPanel({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const send = async (payload: Parameters<typeof browserApi.input>[0]) => {
    setSending(true);
    setError(null);
    try {
      await browserApi.input(payload);
    } catch {
      setError("Envoi impossible : le navigateur n'est pas prêt.");
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  return (
    <div className="safe-bottom safe-px absolute inset-x-0 bottom-0 z-40 bg-surface/95 p-3 shadow-pop backdrop-blur">
      <form
        className="mx-auto flex max-w-3xl items-center gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!text) return;
          await send({ text });
          setText("");
        }}
      >
        <label htmlFor="remote-input" className="sr-only">
          Texte à envoyer au navigateur
        </label>
        <input
          id="remote-input"
          ref={inputRef}
          type={secret ? "password" : "text"}
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint="send"
          maxLength={512}
          placeholder="Tape ici, puis Envoyer"
          className="min-h-11 min-w-0 flex-1 rounded-card bg-surface-2 px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-white"
        />
        <Button type="submit" size="icon" disabled={sending || !text} aria-label="Envoyer le texte">
          <Send />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label="Fermer le clavier"
        >
          <X />
        </Button>
      </form>
      <div className="mx-auto mt-2 flex max-w-3xl flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="secondary" onClick={() => send({ key: "Enter" })}>
          <CornerDownLeft aria-hidden /> Entrée
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => send({ key: "Backspace" })}
        >
          <Delete aria-hidden /> Effacer
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => send({ key: "Tab" })}>
          Tab
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => send({ key: "Escape" })}>
          Échap
        </Button>
        <label className="ml-auto flex min-h-9 items-center gap-2 text-xs text-muted">
          <input type="checkbox" checked={secret} onChange={(e) => setSecret(e.target.checked)} />
          Masquer (mot de passe)
        </label>
      </div>
      {error ? (
        <p role="alert" className="mx-auto mt-2 max-w-3xl text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
