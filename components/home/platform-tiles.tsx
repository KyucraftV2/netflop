import Image from "next/image";
import Link from "next/link";
import { PLATFORM_LIST, type PlatformId } from "@/lib/platforms";
import { cn } from "@/lib/utils";

/** Grandes tuiles plateformes (2 colonnes mobile, 3 tablette/ordi). */
export function PlatformTiles({
  subscribed,
  showAll,
}: {
  subscribed: PlatformId[];
  showAll: boolean;
}) {
  const visible = PLATFORM_LIST.filter((p) => showAll || subscribed.includes(p.id));
  const hidden = PLATFORM_LIST.length - visible.length;

  return (
    <section aria-labelledby="plateformes" className="mt-10">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="plateformes" className="text-xl font-bold md:text-2xl">
          Mes plateformes
        </h2>
        {hidden > 0 || showAll ? (
          <Link
            href={showAll ? "/" : "/?toutes=1"}
            scroll={false}
            className="inline-flex min-h-11 items-center text-sm text-muted underline-offset-4 hover:text-white hover:underline"
          >
            {showAll ? "Seulement mes abonnements" : "Voir toutes les plateformes"}
          </Link>
        ) : null}
      </div>
      {visible.length === 0 ? (
        <p className="mt-4 text-muted">
          Aucun abonnement sélectionné.{" "}
          <Link href="/profil" className="underline">
            Choisis tes plateformes
          </Link>{" "}
          ou{" "}
          <Link href="/?toutes=1" className="underline">
            affiche-les toutes
          </Link>
          .
        </p>
      ) : (
        <ul className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-5">
          {visible.map((p) => (
            <li key={p.id}>
              <Link
                href={`/watch/${p.id}`}
                className={cn(
                  "group relative flex aspect-video flex-col items-center justify-center gap-2 overflow-hidden rounded-tile p-4 shadow-card transition-transform duration-200 ease-netflop motion-safe:hover:scale-[1.04] motion-safe:focus-visible:scale-[1.04]",
                  !subscribed.includes(p.id) && "opacity-60",
                )}
                style={{
                  backgroundColor: p.tileColor,
                  color: p.textColor,
                  boxShadow: `inset 0 -4px 0 ${p.color}`,
                }}
                aria-label={`Regarder ${p.name}${p.tagline ? ` (${p.tagline})` : ""}`}
              >
                <span
                  className="absolute inset-0 bg-gradient-to-br from-white/10 to-black/30"
                  aria-hidden
                />
                <Image
                  src={p.logo}
                  alt=""
                  width={200}
                  height={60}
                  className="relative h-8 w-auto md:h-12"
                  priority
                />
                {p.tagline ? (
                  <span className="relative text-center text-[11px] font-medium opacity-90 md:text-sm">
                    {p.tagline}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
