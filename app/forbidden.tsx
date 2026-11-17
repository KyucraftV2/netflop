import Link from "next/link";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";

export default function Forbidden() {
  return (
    <main className="safe-px flex min-h-dvh flex-col items-center justify-center gap-6 text-center">
      <Logo className="text-4xl" />
      <h1 className="text-5xl font-black">403</h1>
      <p className="text-muted">Cette page est réservée aux administrateurs.</p>
      <Button asChild variant="light">
        <Link href="/">Retour à l&apos;accueil</Link>
      </Button>
    </main>
  );
}
