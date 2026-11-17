import type { ServerConfig } from "./config";

/**
 * Spécification FIGÉE d'un conteneur navigateur Neko.
 * Seuls le slug utilisateur (validé) et le numéro de slot (calculé par le hub)
 * varient ; tout le reste vient du code ou de la configuration serveur.
 */

export const SLUG_REGEX = /^[a-z0-9_-]{1,32}$/;

export const BROWSER_LABEL_MANAGED = "netflop.managed";
export const BROWSER_LABEL_USER = "netflop.user";
export const BROWSER_LABEL_SLOT = "netflop.slot";

/** Port interne du relais socat → CDP (jamais publié, jamais routé par Traefik). */
export const CDP_RELAY_PORT = 9223;
/** Port HTTP de Neko dans le conteneur. */
export const NEKO_HTTP_PORT = 8080;
/** Montage du profil Chrome : hors du répertoire par défaut (Chrome ≥ 136 refuse le CDP sinon). */
export const PROFILE_MOUNT = "/home/neko/chrome-profile";

const GiB = 1024 ** 3;
export const BROWSER_LIMITS = {
  memoryBytes: 1.5 * GiB,
  nanoCpus: 1.5e9,
  shmSizeBytes: 2 * GiB,
  pidsLimit: 4096,
} as const;

export class InvalidSlugError extends Error {
  constructor() {
    super("Nom d'utilisateur invalide");
    this.name = "InvalidSlugError";
  }
}

export function assertSlug(user: unknown): asserts user is string {
  if (typeof user !== "string" || !SLUG_REGEX.test(user)) throw new InvalidSlugError();
}

export function assertSlot(slot: unknown, cfg: ServerConfig): asserts slot is number {
  if (
    typeof slot !== "number" ||
    !Number.isInteger(slot) ||
    slot < 0 ||
    slot >= cfg.MAX_ACTIVE_BROWSERS
  ) {
    throw new Error("Slot invalide");
  }
}

export const containerName = (user: string) => `neko-${user}`;
export const profileVolumeName = (user: string) => `netflop-profile-${user}`;
export const routerName = (user: string) => `netflop-b-${user}`;

/** IP fixe du navigateur du slot n sur le réseau des navigateurs : <préfixe>.(10 + n). */
export function internalIpForSlot(slot: number, cfg: ServerConfig): string {
  return `${cfg.BROWSER_SUBNET_PREFIX}.${10 + slot}`;
}

/** Seuls le hub (.2) et le worker (.3) peuvent joindre le relais CDP d'un navigateur. */
export function controlPlaneRange(cfg: ServerConfig): string {
  return `${cfg.BROWSER_SUBNET_PREFIX}.2/31`;
}

export interface NekoCredentials {
  adminPassword: string;
  userPassword: string;
}

export function slotPort(slot: number, cfg: ServerConfig): number {
  const port = cfg.SLOT_PORTS[slot];
  if (port === undefined) throw new Error("Aucun port pour ce slot");
  return port;
}

export type VideoQuality = "normal" | "saver";

/**
 * Résolutions Neko (doivent exister dans le xorg.conf de Neko).
 * « saver » : 1024x576, le plus petit mode 16:9 disponible (pas de 480p dans Neko).
 */
export const SCREEN_BY_QUALITY: Record<VideoQuality, string> = {
  normal: "1280x720@30",
  saver: "1024x576@30",
};

export interface BrowserSpec {
  name: string;
  volumeName: string;
  internalIp: string;
  port: number;
  labels: Record<string, string>;
  /** Corps de POST /containers/create (API Docker Engine). */
  createBody: Record<string, unknown>;
}

export function buildBrowserSpec(
  user: string,
  slot: number,
  cfg: ServerConfig,
  quality: VideoQuality,
  credentials: NekoCredentials,
): BrowserSpec {
  assertSlug(user);
  assertSlot(slot, cfg);
  const screen = SCREEN_BY_QUALITY[quality] ?? SCREEN_BY_QUALITY.normal;

  const name = containerName(user);
  const volumeName = profileVolumeName(user);
  const port = slotPort(slot, cfg);
  const internalIp = internalIpForSlot(slot, cfg);
  const router = routerName(user);
  const pathPrefix = `/b/${user}`;

  const labels: Record<string, string> = {
    [BROWSER_LABEL_MANAGED]: "true",
    [BROWSER_LABEL_USER]: user,
    [BROWSER_LABEL_SLOT]: String(slot),

    "traefik.enable": "true",
    // Traefik joint le navigateur via le réseau dédié (Traefik doit y être connecté).
    "traefik.docker.network": cfg.BROWSER_NETWORK,
    // Slash final obligatoire : sans lui, /b/alice capterait aussi /b/alice2/...
    [`traefik.http.routers.${router}.rule`]: `Host(\`${cfg.HUB_DOMAIN}\`) && PathPrefix(\`${pathPrefix}/\`)`,
    [`traefik.http.routers.${router}.entrypoints`]: cfg.TRAEFIK_ENTRYPOINT,
    [`traefik.http.routers.${router}.tls`]: "true",
    [`traefik.http.routers.${router}.tls.certresolver`]: cfg.CERT_RESOLVER,
    [`traefik.http.routers.${router}.middlewares`]:
      "netflop-browser-auth@docker,netflop-browser-headers@docker",
    [`traefik.http.routers.${router}.service`]: router,
    [`traefik.http.services.${router}.loadbalancer.server.port`]: String(NEKO_HTTP_PORT),
  };

  const env: Record<string, string> = {
    // Neko sert lui-même sous /b/<user> (pas de StripPrefix : son client utilise des chemins absolus).
    NEKO_SERVER_PATH_PREFIX: pathPrefix,
    NEKO_SERVER_BIND: `:${NEKO_HTTP_PORT}`,
    NEKO_DESKTOP_SCREEN: screen,
    NEKO_CAPTURE_VIDEO_CODEC: cfg.BROWSER_VIDEO_CODEC,
    NEKO_WEBRTC_UDPMUX: String(port),
    NEKO_WEBRTC_TCPMUX: String(port),
    NEKO_WEBRTC_NAT1TO1: cfg.PUBLIC_IP,
    NEKO_WEBRTC_ICELITE: "true",
    // Accès contrôlé en amont par le forwardAuth Traefik ET par un mot de passe propre à
    // la séance (défense en profondeur : le port Neko reste joignable sur le réseau).
    NEKO_MEMBER_PROVIDER: "multiuser",
    NEKO_MEMBER_MULTIUSER_ADMIN_PASSWORD: credentials.adminPassword,
    NEKO_MEMBER_MULTIUSER_USER_PASSWORD: credentials.userPassword,
    NEKO_SESSION_IMPLICIT_HOSTING: "true",
    NEKO_SESSION_MERCIFUL_RECONNECT: "true",
    NEKO_SESSION_COOKIE_ENABLED: "false",
    // Le relais CDP n'écoute que sur l'IP du réseau dédié, et n'accepte que hub/worker.
    NETFLOP_CDP_BIND: internalIp,
    NETFLOP_CDP_ALLOW: controlPlaneRange(cfg),
    NETFLOP_CDP_PORT: String(CDP_RELAY_PORT),
  };

  const createBody: Record<string, unknown> = {
    Image: cfg.BROWSER_IMAGE,
    Hostname: name,
    Labels: labels,
    Env: Object.entries(env).map(([k, v]) => `${k}=${v}`),
    ExposedPorts: { [`${port}/udp`]: {}, [`${port}/tcp`]: {} },
    HostConfig: {
      Memory: BROWSER_LIMITS.memoryBytes,
      MemorySwap: BROWSER_LIMITS.memoryBytes,
      NanoCpus: BROWSER_LIMITS.nanoCpus,
      ShmSize: BROWSER_LIMITS.shmSizeBytes,
      PidsLimit: BROWSER_LIMITS.pidsLimit,
      Privileged: false,
      SecurityOpt: ["no-new-privileges:true"],
      // Capacités inutiles à Neko/Chrome retirées (Chrome tourne en --no-sandbox).
      CapDrop: ["NET_RAW", "MKNOD", "AUDIT_WRITE", "SETFCAP", "SYS_CHROOT"],
      RestartPolicy: { Name: "no" },
      AutoRemove: false,
      Mounts: [{ Type: "volume", Source: volumeName, Target: PROFILE_MOUNT, ReadOnly: false }],
      PortBindings: {
        [`${port}/udp`]: [{ HostIp: "0.0.0.0", HostPort: String(port) }],
        [`${port}/tcp`]: [{ HostIp: "0.0.0.0", HostPort: String(port) }],
      },
      NetworkMode: cfg.BROWSER_NETWORK,
      LogConfig: { Type: "json-file", Config: { "max-size": "10m", "max-file": "2" } },
    },
    // UN SEUL réseau, avec IP fixe : pas d'accès à Postgres ni à docker-proxy.
    NetworkingConfig: {
      EndpointsConfig: {
        [cfg.BROWSER_NETWORK]: { IPAMConfig: { IPv4Address: internalIp } },
      },
    },
  };

  return { name, volumeName, internalIp, port, labels, createBody };
}

/** URL interne de santé de Neko (servie sous le préfixe /b/<user>). */
export function healthUrl(user: string, slot: number, cfg: ServerConfig): string {
  return `http://${internalIpForSlot(slot, cfg)}:${NEKO_HTTP_PORT}/b/${user}/health`;
}

/** Base HTTP du relais CDP du navigateur (réseau interne uniquement). */
export function cdpBaseUrl(slot: number, cfg: ServerConfig): string {
  return `http://${internalIpForSlot(slot, cfg)}:${CDP_RELAY_PORT}`;
}
