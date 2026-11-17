"use client";

import { Film, Tv } from "lucide-react";
import Image from "next/image";
import { PlatformBadge } from "@/components/platform-badge";
import type { PlatformId } from "@/lib/platforms";
import { cn } from "@/lib/utils";

export interface TitleCardData {
  tmdbId: number;
  type: "movie" | "tv";
  title: string;
  year: number | null;
  posterPath: string | null;
  platforms: PlatformId[];
  available: boolean;
}

export function TitleCard({
  item,
  subscribed,
  onSelect,
}: {
  item: TitleCardData;
  subscribed: PlatformId[];
  onSelect: (item: TitleCardData) => void;
}) {
  const label = `${item.title}${item.year ? ` (${item.year})` : ""} — ${
    item.type === "movie" ? "Film" : "Série"
  }${item.platforms.length ? `, sur ${item.platforms.join(", ")}` : ", indisponible en abonnement"}`;
  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      disabled={item.platforms.length === 0}
      aria-label={label}
      className={cn(
        "group flex w-full flex-col text-left disabled:cursor-not-allowed",
        !item.available && "opacity-55 grayscale-[60%]",
      )}
    >
      <span className="relative block aspect-[2/3] w-full overflow-hidden rounded-card bg-surface-2 shadow-card transition-transform duration-200 ease-netflop motion-safe:group-hover:scale-[1.03] motion-safe:group-focus-visible:scale-[1.03]">
        {item.posterPath ? (
          <Image
            src={`https://image.tmdb.org/t/p/w342${item.posterPath}`}
            alt=""
            fill
            sizes="(max-width: 640px) 45vw, (max-width: 1024px) 25vw, 180px"
            className="object-cover"
          />
        ) : (
          <span className="flex h-full items-center justify-center p-3 text-center text-sm text-muted">
            {item.title}
          </span>
        )}
        <span className="absolute inset-x-0 bottom-0 flex flex-wrap gap-1 bg-gradient-to-t from-black/90 to-transparent p-2 pt-8">
          {item.platforms.map((p) => (
            <PlatformBadge key={p} id={p} dimmed={!subscribed.includes(p)} />
          ))}
        </span>
      </span>
      <span className="mt-2 line-clamp-2 text-sm font-semibold">{item.title}</span>
      <span className="mt-0.5 flex items-center gap-1 text-xs text-muted">
        {item.type === "movie" ? (
          <Film className="size-3" aria-hidden />
        ) : (
          <Tv className="size-3" aria-hidden />
        )}
        {item.type === "movie" ? "Film" : "Série"}
        {item.year ? ` · ${item.year}` : ""}
      </span>
    </button>
  );
}
