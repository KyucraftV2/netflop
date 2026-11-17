import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Logo } from "@/components/logo";
import { requirePageUser } from "@/lib/auth-guard";
import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = { title: "Bienvenue" };

export default async function WelcomePage() {
  const user = await requirePageUser();
  if (user.onboarded) redirect("/");
  return (
    <main className="safe-px safe-top mx-auto flex min-h-dvh max-w-3xl flex-col justify-center py-12">
      <Logo href={null} className="text-4xl" />
      <h1 className="mt-8 text-3xl font-bold md:text-4xl">Bienvenue, {user.displayName} !</h1>
      <p className="mt-3 text-lg text-muted">
        Choisis les plateformes auxquelles tu es abonné : on n&apos;affichera que ce que tu peux
        regarder.
      </p>
      <OnboardingForm />
      <div className="mt-8 rounded-tile bg-surface p-5 text-sm leading-relaxed">
        <strong className="text-white">Bon à savoir :</strong> à ta première séance, connecte-toi
        une fois à chaque plateforme dans ton navigateur Netflop, ça restera enregistré.
      </div>
    </main>
  );
}
