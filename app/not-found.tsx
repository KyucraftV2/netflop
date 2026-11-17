import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Page introuvable" };

export default function NotFound() {
  return (
    <main className="safe-px flex min-h-dvh flex-col items-center justify-center gap-6 bg-[radial-gradient(ellipse_at_center,#2a0a0c_0%,#141414_65%)] text-center">
      <Logo className="text-4xl" />
      <p className="text-8xl font-black text-white/90">404</p>
      <h1 className="text-2xl font-bold">Ce programme n&apos;existe pas (ou plus)</h1>
      <p className="max-w-md text-muted">
        La page demandée est introuvable. Retourne à l&apos;accueil pour choisir autre chose.
      </p>
      <Button asChild variant="light" size="lg">
        <Link href="/">Accueil Netflop</Link>
      </Button>
    </main>
  );
}
