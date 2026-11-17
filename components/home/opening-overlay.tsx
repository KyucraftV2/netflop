"use client";

import { Loader2 } from "lucide-react";
import { PLATFORMS, type PlatformId } from "@/lib/platforms";

export function OpeningOverlay({ title, platform }: { title: string; platform: PlatformId }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black/85 px-6 text-center backdrop-blur"
    >
      <Loader2 className="size-10 animate-spin text-accent" aria-hidden />
      <p className="text-xl font-bold">
        Ouverture de « {title} » sur {PLATFORMS[platform].name}…
      </p>
    </div>
  );
}
