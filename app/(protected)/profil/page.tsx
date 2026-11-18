import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { Suspense } from "react";
import { logout } from "@/app/actions/profile";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { requirePageUser } from "@/lib/auth-guard";
import { browserStateForSlug } from "@/lib/browser-lifecycle";
import { getDb } from "@/lib/db";
import { userSubscriptions, users } from "@/lib/db/schema";
import { BrowserCard, PauseForm, QualityForm, SubscriptionsForm } from "./profile-forms";
import { getConfig } from "@/lib/config";
import { enabledPlatformIds } from "@/lib/platforms";

export const metadata: Metadata = { title: "Profil" };

export default async function ProfilePage() {
  const user = await requirePageUser();
  const db = getDb();
  const [subs, [row]] = await Promise.all([
    db.select().from(userSubscriptions).where(eq(userSubscriptions.userId, user.id)),
    db
      .select({ videoQuality: users.videoQuality, pausedStopMinutes: users.pausedStopMinutes })
      .from(users)
      .where(eq(users.id, user.id)),
  ]);

  return (
    <main className="mx-auto max-w-3xl px-4 pt-24 md:px-8">
      <h1 className="text-3xl font-bold">Profil</h1>
      <p className="mt-1 text-muted">
        {user.displayName} · {user.email ?? "pas d'e-mail"}
      </p>

      <section aria-labelledby="abonnements" className="mt-10">
        <h2 id="abonnements" className="text-xl font-semibold">
          Mes abonnements
        </h2>
        <p className="mt-1 text-sm text-muted">
          Utilisé par le filtre « mes abonnements » de la recherche et par l&apos;accueil.
        </p>
        <SubscriptionsForm initial={subs.map((s) => s.platform)} available={enabledPlatformIds()} />
      </section>

      <section aria-labelledby="navigateur" className="mt-12">
        <h2 id="navigateur" className="text-xl font-semibold">
          Mon navigateur
        </h2>
        <Suspense fallback={<Skeleton className="mt-4 h-28" />}>
          <BrowserSection slug={user.slug} />
        </Suspense>
      </section>

      <section aria-labelledby="qualite" className="mt-12">
        <h2 id="qualite" className="text-xl font-semibold">
          Qualité vidéo
        </h2>
        <QualityForm initial={row?.videoQuality ?? "normal"} />
      </section>

      <section aria-labelledby="pause" className="mt-12">
        <h2 id="pause" className="text-xl font-semibold">
          Pause prolongée
        </h2>
        <p className="mt-1 text-sm text-muted">
          Une vidéo en pause trop longtemps libère le navigateur pour les autres. Ta progression est
          enregistrée.
        </p>
        <PauseForm initial={row?.pausedStopMinutes ?? null} max={getConfig().PAUSED_STOP_MINUTES} />
      </section>

      <section className="mt-12 border-t border-white/10 pt-8">
        <form action={logout}>
          <Button type="submit" variant="outline">
            Se déconnecter
          </Button>
        </form>
      </section>
    </main>
  );
}

async function BrowserSection({ slug }: { slug: string }) {
  const state = await browserStateForSlug(slug).catch(() => null);
  return <BrowserCard running={state ? state.state !== "off" : null} />;
}
