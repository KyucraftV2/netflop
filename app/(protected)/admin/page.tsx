import type { Metadata } from "next";
import { forbidden } from "next/navigation";
import { Suspense } from "react";
import { PlatformBadge } from "@/components/platform-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { listActiveBrowsersForAdmin, listQueueForAdmin, listUsersForAdmin } from "@/lib/admin";
import { requirePageUser } from "@/lib/auth-guard";
import { formatBytes, formatDateTime, formatDuration } from "@/lib/utils";
import { StopBrowserButton } from "./stop-button";

export const metadata: Metadata = { title: "Administration" };
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await requirePageUser();
  if (user.role !== "admin") forbidden();

  return (
    <main className="mx-auto max-w-[1200px] px-4 pt-24 md:px-8">
      <h1 className="text-3xl font-bold">Administration</h1>

      <section aria-labelledby="actifs" className="mt-10">
        <h2 id="actifs" className="text-xl font-semibold">
          Navigateurs actifs
        </h2>
        <Suspense fallback={<Skeleton className="mt-4 h-24" />}>
          <ActiveBrowsers />
        </Suspense>
      </section>

      <section aria-labelledby="file" className="mt-12">
        <h2 id="file" className="text-xl font-semibold">
          File d&apos;attente
        </h2>
        <Suspense fallback={<Skeleton className="mt-4 h-16" />}>
          <Queue />
        </Suspense>
      </section>

      <section aria-labelledby="utilisateurs" className="mt-12">
        <h2 id="utilisateurs" className="text-xl font-semibold">
          Utilisateurs
        </h2>
        <Suspense fallback={<Skeleton className="mt-4 h-40" />}>
          <Users />
        </Suspense>
      </section>
    </main>
  );
}

const th = "px-3 py-2 text-left text-xs font-semibold tracking-wide text-muted uppercase";
const td = "px-3 py-3 align-middle";

async function ActiveBrowsers() {
  const rows = await listActiveBrowsersForAdmin().catch(() => null);
  if (rows === null) return <p className="mt-4 text-danger">docker-proxy injoignable.</p>;
  if (rows.length === 0) return <p className="mt-4 text-muted">Aucun navigateur en cours.</p>;
  return (
    <div className="mt-4 overflow-x-auto rounded-tile bg-surface">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr>
            <th className={th}>Utilisateur</th>
            <th className={th}>Slot</th>
            <th className={th}>État</th>
            <th className={th}>Durée</th>
            <th className={th}>RAM</th>
            <th className={th}>CPU</th>
            <th className={th}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((b) => (
            <tr key={b.slug} className="border-t border-white/5">
              <td className={td}>{b.slug}</td>
              <td className={td}>{b.slot ?? "?"}</td>
              <td className={td}>{b.status}</td>
              <td className={td}>{formatDuration(b.durationSeconds)}</td>
              <td className={td}>
                {b.memoryBytes !== null
                  ? `${formatBytes(b.memoryBytes)} / ${formatBytes(b.memoryLimitBytes ?? 0)}`
                  : "—"}
              </td>
              <td className={td}>{b.cpuPercent !== null ? `${b.cpuPercent.toFixed(0)} %` : "—"}</td>
              <td className={td}>
                <StopBrowserButton slug={b.slug} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function Queue() {
  const rows = await listQueueForAdmin();
  if (rows.length === 0) return <p className="mt-4 text-muted">Personne n&apos;attend.</p>;
  return (
    <ol className="mt-4 space-y-2">
      {rows.map((q, i) => (
        <li key={q.slug} className="flex items-center gap-3 rounded-card bg-surface px-4 py-3">
          <span className="font-bold">{i + 1}.</span>
          <span>{q.displayName}</span>
          <PlatformBadge id={q.platform} />
          <span className="ml-auto text-sm text-muted">{formatDateTime(q.requestedAt)}</span>
        </li>
      ))}
    </ol>
  );
}

async function Users() {
  const rows = await listUsersForAdmin();
  return (
    <div className="mt-4 overflow-x-auto rounded-tile bg-surface">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr>
            <th className={th}>Nom</th>
            <th className={th}>Identifiant</th>
            <th className={th}>Rôle</th>
            <th className={th}>Dernière connexion</th>
            <th className={th}>Abonnements</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((u) => (
            <tr key={u.id} className="border-t border-white/5">
              <td className={td}>{u.displayName}</td>
              <td className={td}>{u.slug}</td>
              <td className={td}>{u.role === "admin" ? "Admin" : "Utilisateur"}</td>
              <td className={td}>{formatDateTime(u.lastLoginAt)}</td>
              <td className={td}>
                <span className="flex flex-wrap gap-1">
                  {u.subscriptions.length === 0 ? (
                    <span className="text-muted">—</span>
                  ) : (
                    u.subscriptions.map((p) => <PlatformBadge key={p} id={p} />)
                  )}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
