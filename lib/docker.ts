import { getConfig, type ServerConfig } from "./config";
import {
  BROWSER_LABEL_MANAGED,
  BROWSER_LABEL_SLOT,
  BROWSER_LABEL_USER,
  assertSlug,
  buildBrowserSpec,
  containerName,
  profileVolumeName,
  type NekoCredentials,
  type VideoQuality,
} from "./browser-spec";
import { errorMessage, logger } from "./log";

/**
 * Client minimal de l'API Docker Engine, via tecnativa/docker-socket-proxy.
 * Toutes les fonctions publiques prennent un slug VALIDÉ et construisent elles-mêmes
 * noms et corps de requête : aucun paramètre client n'atteint l'API Docker tel quel.
 */

const API_VERSION = "v1.44";
const log = logger("docker");

export class DockerApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    message: string,
  ) {
    super(`Docker ${status} sur ${path} : ${message}`);
    this.name = "DockerApiError";
  }
}

export type Fetcher = typeof fetch;

export interface DockerClientOptions {
  config?: ServerConfig;
  fetcher?: Fetcher;
}

export interface BrowserInfo {
  id: string;
  user: string;
  slot: number | null;
  state: string;
  running: boolean;
  createdAt: Date;
}

export interface BrowserStats {
  memoryBytes: number;
  memoryLimitBytes: number;
  cpuPercent: number;
}

interface ContainerSummary {
  Id: string;
  State: string;
  Created: number;
  Labels?: Record<string, string>;
}

interface ContainerInspect {
  Id: string;
  Created: string;
  State: { Status: string; Running: boolean };
  Config: { Labels?: Record<string, string> };
}

function toInfo(id: string, labels: Record<string, string>, state: string, created: Date) {
  const slotRaw = labels[BROWSER_LABEL_SLOT];
  const slot = slotRaw !== undefined && /^\d+$/.test(slotRaw) ? Number(slotRaw) : null;
  return {
    id,
    user: labels[BROWSER_LABEL_USER] ?? "",
    slot,
    state,
    running: state === "running",
    createdAt: created,
  } satisfies BrowserInfo;
}

export function createDockerClient(opts: DockerClientOptions = {}) {
  const cfg = () => opts.config ?? getConfig();
  const doFetch: Fetcher = opts.fetcher ?? fetch;

  async function call<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    { body, okStatuses = [] }: { body?: unknown; okStatuses?: number[] } = {},
  ): Promise<{ status: number; data: T | null }> {
    const url = new URL(`/${API_VERSION}${path}`, cfg().DOCKER_PROXY_URL);
    const res = await doFetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    if (!res.ok && !okStatuses.includes(res.status)) {
      let message = text.slice(0, 300);
      try {
        message = (JSON.parse(text) as { message?: string }).message ?? message;
      } catch {
        /* corps non JSON */
      }
      throw new DockerApiError(res.status, path.split("?")[0] ?? path, message);
    }
    const data = text && res.ok ? (JSON.parse(text) as T) : null;
    return { status: res.status, data };
  }

  /** Inspecte neko-<user> ; null s'il n'existe pas OU s'il n'est pas géré par Netflop. */
  async function inspect(user: string): Promise<BrowserInfo | null> {
    assertSlug(user);
    const { status, data } = await call<ContainerInspect>(
      "GET",
      `/containers/${containerName(user)}/json`,
      { okStatuses: [404] },
    );
    if (status === 404 || !data) return null;
    const labels = data.Config.Labels ?? {};
    if (labels[BROWSER_LABEL_MANAGED] !== "true" || labels[BROWSER_LABEL_USER] !== user) {
      log.warn("conteneur homonyme non géré par Netflop ignoré", { user });
      return null;
    }
    return toInfo(data.Id, labels, data.State.Status, new Date(data.Created));
  }

  async function requireManaged(user: string): Promise<BrowserInfo> {
    const info = await inspect(user);
    if (!info) throw new DockerApiError(404, `/containers/${containerName(user)}`, "introuvable");
    return info;
  }

  async function ensureProfileVolume(user: string): Promise<void> {
    // Idempotent : Docker renvoie le volume existant s'il est déjà créé.
    await call("POST", "/volumes/create", {
      body: {
        Name: profileVolumeName(user),
        Labels: { [BROWSER_LABEL_MANAGED]: "true", [BROWSER_LABEL_USER]: user },
      },
    });
  }

  /** Crée (sans démarrer) le navigateur de <user> sur le slot <slot>. */
  async function createBrowser(
    user: string,
    slot: number,
    quality: VideoQuality,
    credentials: NekoCredentials,
  ): Promise<BrowserInfo> {
    const c = cfg();
    const spec = buildBrowserSpec(
      user,
      slot,
      c,
      quality === "saver" ? "saver" : "normal",
      credentials,
    );
    await ensureProfileVolume(user);

    const { data } = await call<{ Id: string }>(
      "POST",
      `/containers/create?name=${encodeURIComponent(spec.name)}`,
      { body: spec.createBody },
    );
    if (!data?.Id) throw new Error("Réponse de création de conteneur inattendue");

    log.info("navigateur créé", { user, slot, port: spec.port, quality });
    return toInfo(data.Id, spec.labels, "created", new Date());
  }

  async function startBrowser(user: string): Promise<void> {
    const info = await requireManaged(user);
    // 304 = déjà démarré
    await call("POST", `/containers/${info.id}/start`, { okStatuses: [304] });
    log.info("navigateur démarré", { user, slot: info.slot });
  }

  async function stopBrowser(user: string, timeoutSeconds = 10): Promise<void> {
    const info = await inspect(user);
    if (!info) return;
    // 304 = déjà arrêté
    await call("POST", `/containers/${info.id}/stop?t=${Math.trunc(timeoutSeconds)}`, {
      okStatuses: [304, 404],
    });
    log.info("navigateur arrêté", { user, slot: info.slot });
  }

  /** Supprime le conteneur. Le volume de profil n'est JAMAIS supprimé ici. */
  async function removeBrowser(user: string): Promise<void> {
    const info = await inspect(user);
    if (!info) return;
    await call("DELETE", `/containers/${info.id}?force=true&v=false`, { okStatuses: [404] });
    log.info("navigateur supprimé", { user, slot: info.slot });
  }

  /** Tous les conteneurs Netflop (label netflop.managed=true), démarrés ou non. */
  async function listBrowsers(): Promise<BrowserInfo[]> {
    const filters = encodeURIComponent(
      JSON.stringify({ label: [`${BROWSER_LABEL_MANAGED}=true`] }),
    );
    const { data } = await call<ContainerSummary[]>(
      "GET",
      `/containers/json?all=true&filters=${filters}`,
    );
    return (data ?? [])
      .filter((c) => c.Labels?.[BROWSER_LABEL_MANAGED] === "true")
      .map((c) => toInfo(c.Id, c.Labels ?? {}, c.State, new Date(c.Created * 1000)));
  }

  /** Consommation instantanée (équivalent `docker stats --no-stream`). */
  async function browserStats(user: string): Promise<BrowserStats | null> {
    const info = await inspect(user);
    if (!info?.running) return null;
    const { data } = await call<{
      memory_stats?: { usage?: number; limit?: number; stats?: { inactive_file?: number } };
      cpu_stats?: {
        cpu_usage?: { total_usage?: number };
        system_cpu_usage?: number;
        online_cpus?: number;
      };
      precpu_stats?: { cpu_usage?: { total_usage?: number }; system_cpu_usage?: number };
    }>("GET", `/containers/${info.id}/stats?stream=false`);
    if (!data) return null;
    const mem = (data.memory_stats?.usage ?? 0) - (data.memory_stats?.stats?.inactive_file ?? 0);
    const cpuDelta =
      (data.cpu_stats?.cpu_usage?.total_usage ?? 0) -
      (data.precpu_stats?.cpu_usage?.total_usage ?? 0);
    const sysDelta =
      (data.cpu_stats?.system_cpu_usage ?? 0) - (data.precpu_stats?.system_cpu_usage ?? 0);
    const cpus = data.cpu_stats?.online_cpus ?? 1;
    return {
      memoryBytes: Math.max(0, mem),
      memoryLimitBytes: data.memory_stats?.limit ?? 0,
      cpuPercent: sysDelta > 0 ? (cpuDelta / sysDelta) * cpus * 100 : 0,
    };
  }

  /**
   * Supprime le volume de profil Chrome de <user>. Refuse si le conteneur existe
   * encore (navigateur allumé ou non supprimé). Jamais appelé automatiquement.
   */
  async function removeProfileVolume(user: string): Promise<boolean> {
    assertSlug(user);
    if (await inspect(user)) throw new Error("Le navigateur doit être éteint");
    const { status } = await call("DELETE", `/volumes/${profileVolumeName(user)}`, {
      okStatuses: [404],
    });
    log.info("volume de profil supprimé", { user, existed: status !== 404 });
    return status !== 404;
  }

  /** Vérifie que docker-proxy répond (utilisé au démarrage du worker). */
  async function ping(): Promise<boolean> {
    try {
      await listBrowsers();
      return true;
    } catch (err) {
      log.error("docker-proxy injoignable", { error: errorMessage(err) });
      return false;
    }
  }

  return {
    inspect,
    createBrowser,
    startBrowser,
    stopBrowser,
    removeBrowser,
    listBrowsers,
    browserStats,
    removeProfileVolume,
    ping,
  };
}

export type DockerClient = ReturnType<typeof createDockerClient>;

let defaultClient: DockerClient | undefined;
function client(): DockerClient {
  defaultClient ??= createDockerClient();
  return defaultClient;
}

export const inspect = (user: string) => client().inspect(user);
export const createBrowser = (
  user: string,
  slot: number,
  quality: VideoQuality,
  credentials: NekoCredentials,
) => client().createBrowser(user, slot, quality, credentials);
export const startBrowser = (user: string) => client().startBrowser(user);
export const stopBrowser = (user: string, timeoutSeconds?: number) =>
  client().stopBrowser(user, timeoutSeconds);
export const removeBrowser = (user: string) => client().removeBrowser(user);
export const listBrowsers = () => client().listBrowsers();
export const browserStats = (user: string) => client().browserStats(user);
export const removeProfileVolume = (user: string) => client().removeProfileVolume(user);
export const pingDocker = () => client().ping();
