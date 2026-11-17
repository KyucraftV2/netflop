import Image from "next/image";

/** Attribution obligatoire TMDB + JustWatch (pied de page). */
export function Attribution() {
  return (
    <footer className="safe-bottom safe-px mx-auto mt-20 max-w-[1600px] border-t border-white/10 py-8 text-xs text-muted">
      <div className="flex flex-wrap items-center gap-4">
        <a
          href="https://www.themoviedb.org/"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center"
          aria-label="The Movie Database (TMDB)"
        >
          <Image src="/tmdb.svg" alt="TMDB" width={90} height={24} />
        </a>
        <p className="max-w-xl">
          Ce produit utilise l&apos;API TMDB mais n&apos;est ni approuvé ni certifié par TMDB.
          Données de disponibilité fournies par{" "}
          <a
            href="https://www.justwatch.com/fr"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-white"
          >
            JustWatch
          </a>
          .
        </p>
      </div>
      <p className="mt-4">Netflop — usage privé.</p>
    </footer>
  );
}
