"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import type { PlatformId } from "@/lib/platforms";
import { connectionHint } from "./connection";

export interface OpenTitleInput {
  platform: PlatformId;
  tmdbId: number;
  type: "movie" | "tv";
  title: string;
  season?: number;
  episode?: number;
  resumeUrl?: string;
}

/** Ouvre un titre dans Chrome (POST /api/browser/open) puis va sur la page de lecture. */
export function useOpenTitle() {
  const router = useRouter();
  const [opening, setOpening] = useState<OpenTitleInput | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = useCallback(
    async (input: OpenTitleInput) => {
      setOpening(input);
      setError(null);
      try {
        const res = await fetch("/api/browser/open", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...input, connection: connectionHint() }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { watchUrl: string };
        router.push(data.watchUrl);
      } catch {
        setError("Impossible d'ouvrir ce titre pour le moment.");
        setOpening(null);
      }
    },
    [router],
  );

  return { open, opening, error, clearError: () => setError(null) };
}
