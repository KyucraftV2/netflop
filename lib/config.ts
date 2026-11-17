import { z } from "zod";

/**
 * Configuration serveur, lue depuis l'environnement et validée par zod.
 * Chargée paresseusement (getConfig) pour ne pas planter `next build`,
 * qui n'a pas accès au .env de production.
 */

const portSchema = z.number().int().min(1024).max(65535);

const ipv4 = z
  .string()
  .regex(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/, "adresse IPv4 attendue")
  .refine((ip) => ip.split(".").every((o) => Number(o) <= 255), "adresse IPv4 invalide");

const serverSchema = z
  .object({
    // Obligatoire, sans valeur par défaut : une instance ne doit jamais démarrer sur un
    // domaine d'exemple.
    HUB_DOMAIN: z.string().regex(/^[a-z0-9.-]+$/, "nom de domaine attendu"),
    TRAEFIK_ENTRYPOINT: z
      .string()
      .regex(/^[a-zA-Z0-9_-]+$/)
      .default("websecure"),
    CERT_RESOLVER: z
      .string()
      .regex(/^[a-zA-Z0-9_-]+$/)
      .default("myresolver"),
    PUBLIC_IP: ipv4,
    SLOT_PORTS: z
      .string()
      .transform((s) => s.split(",").map((p) => Number(p.trim())))
      .pipe(z.array(portSchema).min(1))
      .refine((ports) => new Set(ports).size === ports.length, "ports de slot en double"),
    MAX_ACTIVE_BROWSERS: z.coerce.number().int().min(1).max(32).default(3),
    DOCKER_PROXY_URL: z.url().default("http://docker-proxy:2375"),
    /**
     * Réseau DÉDIÉ aux navigateurs (hub, worker, navigateurs, Traefik). Les navigateurs
     * n'ont accès à AUCUN autre réseau : ni Postgres, ni docker-proxy, ni les autres
     * services du VPS.
     */
    BROWSER_NETWORK: z
      .string()
      .regex(/^[a-zA-Z0-9_.-]+$/)
      .default("netflop-browsers"),
    /** Préfixe /24 du réseau des navigateurs : .2 = hub, .3 = worker, .10 + n = slot n. */
    BROWSER_SUBNET_PREFIX: z
      .string()
      .regex(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/, "préfixe /24 attendu, ex. 172.30.250")
      .default("172.30.250"),
    BROWSER_IMAGE: z
      .string()
      .regex(/^[a-z0-9._/:-]+$/)
      .default("netflop-browser:latest"),
    BROWSER_VIDEO_CODEC: z.enum(["h264", "vp8"]).default("h264"),
    // Cycle de vie (étape 3)
    HEARTBEAT_TIMEOUT_SECONDS: z.coerce.number().int().min(20).max(3600).default(60),
    LEAVE_GRACE_SECONDS: z.coerce.number().int().min(0).max(600).default(30),
    STILL_WATCHING_HOURS: z.coerce.number().min(0.05).max(48).default(4),
    STILL_WATCHING_GRACE_MINUTES: z.coerce.number().min(1).max(60).default(5),
    BROWSER_START_TIMEOUT_SECONDS: z.coerce.number().int().min(30).max(900).default(180),
    // Suivi (étape 5)
    TRACKER_INTERVAL_SECONDS: z.coerce.number().int().min(5).max(600).default(30),
    PAUSED_STOP_MINUTES: z.coerce.number().min(1).max(600).default(30),
    // Sécurité : revérification des droits Authentik des sessions actives
    ACCESS_RECHECK_MINUTES: z.coerce.number().min(1).max(1440).default(15),
  })
  .refine((c) => c.SLOT_PORTS.length >= c.MAX_ACTIVE_BROWSERS, {
    message: "SLOT_PORTS doit contenir au moins MAX_ACTIVE_BROWSERS ports",
    path: ["SLOT_PORTS"],
  });

export type ServerConfig = z.infer<typeof serverSchema>;

let cached: ServerConfig | undefined;

export function parseConfig(env: Record<string, string | undefined>): ServerConfig {
  const result = serverSchema.safeParse(env);
  if (!result.success) {
    // On ne liste que les clés en erreur, jamais les valeurs (secrets possibles).
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Configuration invalide : ${issues}`);
  }
  return result.data;
}

export function getConfig(): ServerConfig {
  cached ??= parseConfig(process.env);
  return cached;
}
