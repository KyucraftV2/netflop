"use client";

import { Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const DEBOUNCE_MS = 350;

/**
 * Recherche toujours visible dans l'en-tête (icône qui se déplie sur mobile).
 * Met à jour ?q= sur l'accueil avec un debounce ; la requête TMDB est faite par le hub.
 */
export function SearchBox() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const initial = params.get("q") ?? "";
  const [value, setValue] = useState(initial);
  const [open, setOpen] = useState(initial.length > 0);
  const inputRef = useRef<HTMLInputElement>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const q = params.get("q") ?? "";
    // Synchronise le champ quand l'URL change (bouton Retour du navigateur).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setValue((v) => (v.trim() === q ? v : q));
  }, [params]);

  const push = (q: string) => {
    const next = new URLSearchParams(pathname === "/" ? params.toString() : "");
    if (q.trim()) next.set("q", q.trim());
    else next.delete("q");
    const url = `/${next.toString() ? `?${next.toString()}` : ""}`;
    if (pathname === "/") router.replace(url, { scroll: false });
    else router.push(url);
  };

  const onChange = (q: string) => {
    setValue(q);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => push(q), DEBOUNCE_MS);
  };

  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        window.clearTimeout(timer.current);
        push(value);
        inputRef.current?.blur();
      }}
      className={cn(
        "flex h-11 items-center rounded-card border transition-all duration-200",
        open
          ? "w-[min(60vw,22rem)] border-white/40 bg-black/70 pl-3"
          : "w-11 border-transparent bg-transparent md:w-[22rem] md:border-white/25 md:bg-black/40 md:pl-3",
      )}
    >
      <button
        type="button"
        className={cn(
          "flex size-11 shrink-0 items-center justify-center md:hidden",
          open && "hidden",
        )}
        aria-label="Rechercher"
        onClick={() => {
          setOpen(true);
          window.setTimeout(() => inputRef.current?.focus(), 50);
        }}
      >
        <Search className="size-5" aria-hidden />
      </button>
      <Search
        className={cn("size-4 shrink-0 text-muted", open ? "block" : "hidden md:block")}
        aria-hidden
      />
      <label htmlFor="search" className="sr-only">
        Rechercher un film ou une série
      </label>
      <input
        id="search"
        ref={inputRef}
        type="search"
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            onChange("");
            setOpen(false);
          }
        }}
        placeholder="Films, séries…"
        className={cn(
          "h-full min-w-0 flex-1 bg-transparent px-2 text-sm outline-none placeholder:text-muted [&::-webkit-search-cancel-button]:hidden",
          open ? "block" : "hidden md:block",
        )}
      />
      {value ? (
        <button
          type="button"
          onClick={() => {
            onChange("");
            inputRef.current?.focus();
          }}
          className={cn(
            "flex size-11 shrink-0 items-center justify-center",
            !open && "hidden md:flex",
          )}
          aria-label="Effacer la recherche"
        >
          <X className="size-4" aria-hidden />
        </button>
      ) : null}
    </form>
  );
}
