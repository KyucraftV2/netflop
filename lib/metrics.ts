import "server-only";
import { and, count, eq, gte, isNotNull } from "drizzle-orm";
import { getConfig } from "./config";
import { getDb } from "./db";
import { browserEvents, browserQueue, browserSessions, users, watchSamples } from "./db/schema";
import { deepHealth } from "./health";

type Sample = { labels?: Record<string, string>; value: number };

/** Échappement des valeurs de label (format texte Prometheus). */
export function escapeLabel(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function metric(name: string, help: string, type: "gauge" | "counter", samples: Sample[]): string {
  const lines = [`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`];
  for (const s of samples) {
    const labels = s.labels
      ? `{${Object.entries(s.labels)
          .map(([k, v]) => `${k}="${escapeLabel(v)}"`)
          .join(",")}}`
      : "";
    lines.push(`${name}${labels} ${Number.isFinite(s.value) ? s.value : 0}`);
  }
  return lines.join("\n");
}

/** Métriques agrégées (aucune donnée personnelle : ni nom, ni titre). */
export async function collectMetrics(): Promise<string> {
  const db = getDb();
  const cfg = getConfig();
  const dayAgo = new Date(Date.now() - 86_400_000);
  const [sessions, [queue], [usersTotal], [stops24h], [playing24h], health] = await Promise.all([
    db
      .select({ status: browserSessions.status, platform: browserSessions.platform, n: count() })
      .from(browserSessions)
      .groupBy(browserSessions.status, browserSessions.platform),
    db.select({ n: count() }).from(browserQueue),
    db.select({ n: count() }).from(users),
    db.select({ n: count() }).from(browserEvents).where(gte(browserEvents.stoppedAt, dayAgo)),
    db
      .select({ n: count() })
      .from(watchSamples)
      .where(
        and(
          eq(watchSamples.paused, false),
          isNotNull(watchSamples.position),
          gte(watchSamples.capturedAt, dayAgo),
        ),
      ),
    deepHealth(),
  ]);
  return (
    [
      metric(
        "netflop_browsers",
        "Navigateurs par état et plateforme",
        "gauge",
        sessions.map((s) => ({ labels: { status: s.status, platform: s.platform }, value: s.n })),
      ),
      metric("netflop_browsers_max", "Navigateurs simultanés autorisés", "gauge", [
        { value: cfg.MAX_ACTIVE_BROWSERS },
      ]),
      metric("netflop_queue_length", "Personnes en file d'attente", "gauge", [
        { value: queue?.n ?? 0 },
      ]),
      metric("netflop_users", "Comptes Netflop", "gauge", [{ value: usersTotal?.n ?? 0 }]),
      metric("netflop_sessions_ended_24h", "Séances terminées sur 24 h", "gauge", [
        { value: stops24h?.n ?? 0 },
      ]),
      metric("netflop_watch_hours_24h", "Heures de visionnage sur 24 h", "gauge", [
        { value: ((playing24h?.n ?? 0) * cfg.TRACKER_INTERVAL_SECONDS) / 3600 },
      ]),
      metric(
        "netflop_up",
        "Dépendances joignables (1 = oui)",
        "gauge",
        Object.entries(health.checks).map(([k, v]) => ({
          labels: { check: k },
          value: v === "ok" ? 1 : 0,
        })),
      ),
    ].join("\n\n") + "\n"
  );
}
