import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { loginWithAuthentik } from "@/app/actions/auth";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { currentUser } from "@/lib/auth-guard";

export const metadata: Metadata = { title: "Connexion" };

const ERRORS: Record<string, string> = {
  AccessDenied:
    "Ton compte n'a pas accès à Netflop. Demande à l'administrateur de t'ajouter au groupe « netflop ».",
  Configuration: "Le service d'authentification est mal configuré. Préviens l'administrateur.",
  Verification: "Le lien de connexion a expiré. Réessaie.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; logout?: string }>;
}) {
  const { error, logout } = await searchParams;
  if (!error && (await currentUser())) redirect("/");
  const message = error ? (ERRORS[error] ?? "La connexion a échoué. Réessaie.") : null;

  return (
    <main className="safe-px flex min-h-dvh flex-col items-center justify-center bg-[radial-gradient(ellipse_at_top,#3a0a0d_0%,#141414_60%)]">
      <Logo href={null} className="text-5xl md:text-6xl" />
      <div className="mt-10 w-full max-w-sm rounded-tile bg-black/60 p-8 shadow-pop">
        <h1 className="text-2xl font-bold">Connexion</h1>
        <p className="mt-2 text-sm text-muted">
          Utilise ton compte habituel. Ta séance reste ouverte 30 jours.
        </p>
        {message ? (
          <p role="alert" className="mt-4 rounded-card bg-danger/15 p-3 text-sm text-danger">
            {message}
          </p>
        ) : null}
        {logout ? (
          <p role="status" className="mt-4 rounded-card bg-white/10 p-3 text-sm">
            Tu es déconnecté. À bientôt !
          </p>
        ) : null}
        <form action={loginWithAuthentik} className="mt-6">
          <Button type="submit" size="lg" className="w-full">
            Se connecter
          </Button>
        </form>
      </div>
    </main>
  );
}
