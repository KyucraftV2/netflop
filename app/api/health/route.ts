export const dynamic = "force-dynamic";

/** Sonde de santé utilisée par le healthcheck Docker. */
export function GET() {
  return Response.json({ ok: true });
}
