import { z } from "zod";
import { errorMessage, logger } from "./log";

const log = logger("http");

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function jsonError(status: number, error: string, extra?: Record<string, unknown>) {
  return Response.json({ error, ...extra }, { status, headers: { "Cache-Control": "no-store" } });
}

export const MAX_JSON_BYTES = 16 * 1024;

/** Lit et valide le corps JSON d'une requête (400 si invalide, 413 si trop gros). */
export async function parseJson<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  let raw: unknown = {};
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_JSON_BYTES) throw new HttpError(413, "Requête trop volumineuse");
  const text = await req.text();
  if (text.length > MAX_JSON_BYTES) throw new HttpError(413, "Requête trop volumineuse");
  // Un corps JSON doit être annoncé comme tel : cela impose un préflight CORS à toute
  // requête cross-origin (impossible d'envoyer un « text/plain » forgé depuis un autre site).
  if (text.trim() && !(req.headers.get("content-type") ?? "").includes("application/json")) {
    throw new HttpError(415, "Content-Type application/json attendu");
  }
  if (text.trim()) {
    try {
      raw = JSON.parse(text);
    } catch {
      throw new HttpError(400, "JSON invalide");
    }
  }
  const r = schema.safeParse(raw);
  if (!r.success) throw new HttpError(400, "Requête invalide", { issues: z.treeifyError(r.error) });
  return r.data;
}

export function parseQuery<T extends z.ZodType>(url: string | URL, schema: T): z.infer<T> {
  const params = Object.fromEntries(new URL(url).searchParams.entries());
  const r = schema.safeParse(params);
  if (!r.success) throw new HttpError(400, "Paramètres invalides");
  return r.data;
}

/**
 * Anti-CSRF pour les méthodes qui modifient l'état : refuse une requête venant d'une autre
 * origine, y compris d'un sous-domaine « même site » de example.com (que SameSite=Lax ne
 * bloque pas). Origin et Sec-Fetch-Site sont envoyés par les navigateurs sur les POST,
 * sendBeacon compris.
 */
export function assertSameOrigin(req: Request, expected = process.env.AUTH_URL): void {
  if (req.method === "GET" || req.method === "HEAD") return;
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") {
    throw new HttpError(403, "Origine refusée");
  }
  const origin = req.headers.get("origin");
  if (origin && expected) {
    let want: string;
    try {
      want = new URL(expected).origin;
    } catch {
      return;
    }
    if (origin !== want) throw new HttpError(403, "Origine refusée");
  }
}

/** Enveloppe une route handler : HttpError → réponse JSON, autre erreur → 500 sans détail. */
export function route<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    try {
      if (args[0] instanceof Request) assertSameOrigin(args[0]);
      return await handler(...args);
    } catch (err) {
      if (err instanceof HttpError) return jsonError(err.status, err.message, err.body);
      // Les redirections/notFound de Next.js doivent remonter.
      if (err && typeof err === "object" && "digest" in err) throw err;
      log.error("erreur route", { error: errorMessage(err) });
      return jsonError(500, "Erreur interne");
    }
  };
}
