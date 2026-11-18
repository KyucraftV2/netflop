import type { Metadata } from "next";
import Link from "next/link";
import { GuestClient } from "@/components/watch/guest-client";
import { requirePageUser } from "@/lib/auth-guard";
import { nekoUserPassword } from "@/lib/neko-secret";
import { InviteError, acceptInvite, type JoinedInvite } from "@/lib/watch-party";

export const metadata: Metadata = { title: "Regarder ensemble", referrer: "no-referrer" };
export const dynamic = "force-dynamic";

export default async function EnsemblePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const user = await requirePageUser(`/ensemble/${encodeURIComponent(token)}`);
  let joined: JoinedInvite | null = null;
  let message = "Impossible de rejoindre cette séance.";
  try {
    joined = await acceptInvite(token, user.id);
  } catch (err) {
    if (err instanceof InviteError) message = err.message;
  }

  if (!joined) {
    return (
      <main className="flex h-full flex-col items-center justify-center gap-6 p-6 text-center">
        <h1 className="text-2xl font-bold">Regarder ensemble</h1>
        <p role="alert" className="max-w-md text-muted">
          {message}
        </p>
        <Link href="/" className="underline">
          Retour à l&apos;accueil
        </Link>
      </main>
    );
  }
  return (
    <GuestClient
      inviteId={joined.inviteId}
      hostSlug={joined.hostSlug}
      hostName={joined.hostName}
      platform={joined.platform}
      guestSlug={user.slug}
      password={nekoUserPassword(joined.sessionId)}
    />
  );
}
