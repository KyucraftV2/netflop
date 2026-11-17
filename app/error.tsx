"use client";

import { RotateCcw } from "lucide-react";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";

export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="safe-px flex min-h-dvh flex-col items-center justify-center gap-6 text-center">
      <title>Erreur · Netflop</title>
      <Logo className="text-4xl" />
      <h1 className="text-3xl font-bold">Oups, un pépin technique</h1>
      <p className="max-w-md text-muted">
        Quelque chose s&apos;est mal passé de notre côté. Réessaie dans un instant.
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        <Button onClick={reset}>
          <RotateCcw aria-hidden /> Réessayer
        </Button>
        <Button asChild variant="secondary">
          <Link href="/">Accueil</Link>
        </Button>
      </div>
    </main>
  );
}
