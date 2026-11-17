import WebSocket from "ws";
import { z } from "zod";
import { cdpBaseUrl } from "./browser-spec";
import { getConfig, type ServerConfig } from "./config";
import { logger } from "./log";
import { validateNavigationUrl } from "./platforms";

/**
 * Pilotage de Chrome par le protocole DevTools (CDP), via le relais socat du conteneur
 * (<IP interne fixe du slot>:9223). Ce port n'est ni publié ni routé par Traefik : seul
 * le hub/worker, sur le réseau interne, peut l'atteindre.
 *
 * Toute navigation passe par validateNavigationUrl (https + domaine en liste blanche).
 */

const log = logger("cdp");

const targetSchema = z.object({
  id: z.string(),
  type: z.string(),
  url: z.string().default(""),
  title: z.string().default(""),
  webSocketDebuggerUrl: z.string().optional(),
});
export type CdpTarget = z.infer<typeof targetSchema>;

export class CdpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CdpError";
  }
}

export interface CdpOptions {
  config?: ServerConfig;
  timeoutMs?: number;
  /** Tests uniquement : adresse du relais (sinon dérivée du slot). */
  baseUrl?: string;
}

function base(slot: number, opts: CdpOptions): string {
  return opts.baseUrl ?? cdpBaseUrl(slot, opts.config ?? getConfig());
}

async function http(slot: number, path: string, opts: CdpOptions, method = "GET") {
  const res = await fetch(`${base(slot, opts)}${path}`, {
    method,
    signal: AbortSignal.timeout(opts.timeoutMs ?? 5_000),
  });
  if (!res.ok) throw new CdpError(`CDP ${path} → HTTP ${res.status}`);
  return res;
}

export async function listTargets(slot: number, opts: CdpOptions = {}): Promise<CdpTarget[]> {
  const res = await http(slot, "/json/list", opts);
  return z.array(targetSchema).parse(await res.json());
}

/** Onglets « visibles » (on ignore les pages internes de Chrome et les service workers). */
function isTab(t: CdpTarget): boolean {
  return (
    t.type === "page" &&
    !t.url.startsWith("devtools://") &&
    !t.url.startsWith("chrome-extension://")
  );
}

/** Session CDP sur une cible (onglet ou iframe hors processus). */
export class CdpSession {
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();

  private constructor(
    private readonly ws: WebSocket,
    private readonly timeoutMs: number,
  ) {
    ws.on("message", (data) => {
      let msg: { id?: number; result?: unknown; error?: { message?: string } };
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }
      if (msg.id === undefined) return;
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new CdpError(msg.error.message ?? "erreur CDP"));
      else p.resolve(msg.result);
    });
    ws.on("close", () => {
      for (const p of this.pending.values()) p.reject(new CdpError("connexion CDP fermée"));
      this.pending.clear();
    });
  }

  static async open(slot: number, target: CdpTarget, opts: CdpOptions = {}): Promise<CdpSession> {
    // On reconstruit l'URL WebSocket sur l'adresse du relais (jamais celle annoncée).
    const b = new URL(base(slot, opts));
    const wsUrl = `ws://${b.host}/devtools/page/${encodeURIComponent(target.id)}`;
    const timeoutMs = opts.timeoutMs ?? 5_000;
    // Pas d'en-tête Origin : Chrome n'accepte que les clients sans origine (--remote-allow-origins non utilisé).
    // maxPayload : un conteneur compromis ne doit pas pouvoir saturer la mémoire du hub.
    const ws = new WebSocket(wsUrl, {
      handshakeTimeout: timeoutMs,
      perMessageDeflate: false,
      maxPayload: 8 * 1024 * 1024,
      followRedirects: false,
    });
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", (err) => reject(new CdpError(`ouverture CDP : ${err.message}`)));
    });
    return new CdpSession(ws, timeoutMs);
  }

  send<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new CdpError(`${method} : délai dépassé`));
      }, this.timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v as T);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close(): void {
    this.ws.close();
  }
}

async function withSession<T>(
  slot: number,
  target: CdpTarget,
  opts: CdpOptions,
  fn: (s: CdpSession) => Promise<T>,
): Promise<T> {
  const s = await CdpSession.open(slot, target, opts);
  try {
    return await fn(s);
  } finally {
    s.close();
  }
}

/** Onglet principal (le premier), créé s'il n'existe plus ; les autres onglets sont fermés. */
export async function mainTab(slot: number, opts: CdpOptions = {}): Promise<CdpTarget> {
  const tabs = (await listTargets(slot, opts)).filter(isTab);
  let main = tabs[0];
  if (!main) {
    const res = await http(slot, "/json/new?about:blank", opts, "PUT");
    main = targetSchema.parse(await res.json());
  }
  // Économie de RAM : un seul onglet.
  for (const extra of tabs.slice(1)) {
    await http(slot, `/json/close/${encodeURIComponent(extra.id)}`, opts).catch(() => {});
  }
  return main;
}

/**
 * Navigue l'onglet principal vers une URL de plateforme validée.
 * Lève une CdpError si l'URL n'est pas dans la liste blanche.
 */
export async function navigate(slot: number, rawUrl: string, opts: CdpOptions = {}): Promise<void> {
  const valid = validateNavigationUrl(rawUrl);
  if (!valid) throw new CdpError("URL refusée (hors liste blanche)");
  const tab = await mainTab(slot, opts);
  await withSession(slot, tab, opts, async (s) => {
    await s.send("Page.bringToFront");
    const r = await s.send<{ errorText?: string }>("Page.navigate", { url: valid.url.toString() });
    if (r?.errorText) throw new CdpError(`navigation : ${r.errorText}`);
  });
  log.info("navigation", { slot, platform: valid.platform, host: valid.url.hostname });
}

/* ------------------------------------------------------------------ */
/* Clavier distant (étape 6)                                           */
/* ------------------------------------------------------------------ */

export const REMOTE_KEYS = {
  Enter: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" },
  Backspace: { key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 },
  Escape: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
  Tab: { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 },
} as const;
export type RemoteKey = keyof typeof REMOTE_KEYS;

export async function insertText(slot: number, text: string, opts: CdpOptions = {}): Promise<void> {
  const tab = await mainTab(slot, opts);
  await withSession(slot, tab, opts, (s) => s.send("Input.insertText", { text }));
}

export async function pressKey(slot: number, key: RemoteKey, opts: CdpOptions = {}): Promise<void> {
  const k = REMOTE_KEYS[key];
  const tab = await mainTab(slot, opts);
  await withSession(slot, tab, opts, async (s) => {
    await s.send("Input.dispatchKeyEvent", { type: "keyDown", ...k });
    await s.send("Input.dispatchKeyEvent", { type: "keyUp", ...k, text: undefined });
  });
}

/* ------------------------------------------------------------------ */
/* Lecture seule dans toutes les frames (étape 5)                      */
/* ------------------------------------------------------------------ */

interface FrameTree {
  frame: { id: string; url: string };
  childFrames?: FrameTree[];
}

function flattenFrames(tree: FrameTree, out: { id: string; url: string }[] = []) {
  out.push({ id: tree.frame.id, url: tree.frame.url });
  for (const c of tree.childFrames ?? []) flattenFrames(c, out);
  return out;
}

export interface FrameEvaluation<T> {
  frameUrl: string;
  topUrl: string;
  value: T;
}

async function evaluateInTarget<T>(
  s: CdpSession,
  expression: string,
): Promise<{ frameUrl: string; value: T }[]> {
  const { frameTree } = await s.send<{ frameTree: FrameTree }>("Page.getFrameTree");
  const out: { frameUrl: string; value: T }[] = [];
  for (const frame of flattenFrames(frameTree)) {
    try {
      // Monde isolé : le script de la page ne peut ni l'observer ni l'altérer.
      const { executionContextId } = await s.send<{ executionContextId: number }>(
        "Page.createIsolatedWorld",
        { frameId: frame.id, worldName: "netflop-readonly", grantUniveralAccess: false },
      );
      const r = await s.send<{ result?: { value?: T }; exceptionDetails?: unknown }>(
        "Runtime.evaluate",
        { expression, contextId: executionContextId, returnByValue: true, silent: true },
      );
      if (!r.exceptionDetails && r.result?.value !== undefined) {
        out.push({ frameUrl: frame.url, value: r.result.value });
      }
    } catch {
      /* frame détachée pendant la lecture : ignorée */
    }
  }
  return out;
}

/**
 * Évalue une expression EN LECTURE SEULE dans l'onglet principal, ses frames et les
 * iframes hors processus (lecteurs Canal+/france.tv). Ne touche ni aux cookies ni au stockage.
 */
export async function evaluateEverywhere<T>(
  slot: number,
  expression: string,
  opts: CdpOptions = {},
): Promise<FrameEvaluation<T>[]> {
  const targets = await listTargets(slot, opts);
  const top = targets.filter(isTab)[0];
  if (!top) return [];
  const results: FrameEvaluation<T>[] = [];
  const runOn = async (t: CdpTarget) => {
    const values = await withSession(slot, t, opts, (s) => evaluateInTarget<T>(s, expression));
    for (const v of values) results.push({ ...v, topUrl: top.url });
  };
  await runOn(top);
  for (const t of targets.filter((x) => x.type === "iframe")) {
    await runOn(t).catch(() => {});
  }
  return results;
}
