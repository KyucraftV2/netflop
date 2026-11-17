import { PLATFORMS, type PlatformId } from "@/lib/platforms";
import { cn } from "@/lib/utils";

export function PlatformBadge({
  id,
  className,
  dimmed,
}: {
  id: PlatformId;
  className?: string;
  dimmed?: boolean;
}) {
  const p = PLATFORMS[id];
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-[4px] px-2 text-[11px] font-bold tracking-wide whitespace-nowrap",
        dimmed && "opacity-50 grayscale",
        className,
      )}
      style={{
        backgroundColor: p.color,
        color: p.textColor,
        border: "1px solid rgb(255 255 255 / 0.15)",
      }}
    >
      {p.name}
    </span>
  );
}
