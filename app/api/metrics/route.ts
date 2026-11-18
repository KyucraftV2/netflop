import { collectMetrics } from "@/lib/metrics";
import { hasOpsToken, opsTokenConfigured } from "@/lib/ops-token";

export const dynamic = "force-dynamic";

/** Métriques Prometheus (format texte). Désactivé sans METRICS_TOKEN. */
export async function GET(req: Request) {
  if (!opsTokenConfigured()) return new Response("Not found", { status: 404 });
  if (!hasOpsToken(req)) return new Response("Unauthorized", { status: 401 });
  return new Response(await collectMetrics(), {
    headers: {
      "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
