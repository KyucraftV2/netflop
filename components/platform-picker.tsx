"use client";

import { Check } from "lucide-react";
import Image from "next/image";
import { PLATFORM_LIST, type PlatformId } from "@/lib/platforms";
import { cn } from "@/lib/utils";

/** Sélection multiple des plateformes (cases à cocher accessibles). */
export function PlatformPicker({
  value,
  onChange,
  disabled,
}: {
  value: PlatformId[];
  onChange: (next: PlatformId[]) => void;
  disabled?: boolean;
}) {
  const toggle = (id: PlatformId) =>
    onChange(value.includes(id) ? value.filter((p) => p !== id) : [...value, id]);

  return (
    <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-3" disabled={disabled}>
      <legend className="sr-only">Tes abonnements</legend>
      {PLATFORM_LIST.map((p) => {
        const checked = value.includes(p.id);
        return (
          <label
            key={p.id}
            className={cn(
              "relative flex min-h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-tile border-2 p-4 transition-all has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-white",
              checked ? "border-white" : "border-transparent opacity-70 hover:opacity-100",
            )}
            style={{ backgroundColor: p.tileColor, color: p.textColor }}
          >
            <input
              type="checkbox"
              className="sr-only"
              checked={checked}
              onChange={() => toggle(p.id)}
            />
            <Image src={p.logo} alt={p.name} width={140} height={42} className="h-9 w-auto" />
            {p.tagline ? <span className="text-xs opacity-80">{p.tagline}</span> : null}
            <span
              className={cn(
                "absolute top-2 right-2 flex size-6 items-center justify-center rounded-pill border-2 border-white",
                checked ? "bg-white text-black" : "bg-transparent",
              )}
              aria-hidden
            >
              {checked ? <Check className="size-4" /> : null}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
