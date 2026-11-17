import Link from "next/link";
import { cn } from "@/lib/utils";

/** Logo texte original « Netflop » (aucune police ni logo Netflix). */
export function Logo({ className, href = "/" }: { className?: string; href?: string | null }) {
  const mark = (
    <span
      className={cn(
        "inline-flex items-baseline font-black tracking-tight text-accent uppercase select-none",
        className,
      )}
      style={{ fontStretch: "condensed" }}
    >
      Netfl
      <span className="relative inline-block -rotate-12 translate-y-0.5 text-white">o</span>p
    </span>
  );
  if (href === null) return mark;
  return (
    <Link href={href} aria-label="Netflop — accueil" className="rounded-card">
      {mark}
    </Link>
  );
}
