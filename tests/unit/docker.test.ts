import { describe, expect, it, vi } from "vitest";
import { parseConfig, type ServerConfig } from "@/lib/config";
import {
  InvalidSlugError,
  PROFILE_MOUNT,
  SLUG_REGEX,
  buildBrowserSpec,
  internalIpForSlot,
} from "@/lib/browser-spec";
import { createDockerClient, type Fetcher } from "@/lib/docker";

const creds = { adminPassword: "admin-secret", userPassword: "user-secret" };

const cfg: ServerConfig = parseConfig({
  HUB_DOMAIN: "netflop.example.com",
  TRAEFIK_NETWORK: "traefik_proxy",
  PUBLIC_IP: "203.0.113.10",
  SLOT_PORTS: "52000,52001,52002",
  MAX_ACTIVE_BROWSERS: "3",
});

describe("config", () => {
  it("exige HUB_DOMAIN (aucun domaine par défaut)", () => {
    expect(() =>
      parseConfig({ PUBLIC_IP: "203.0.113.10", SLOT_PORTS: "52000", MAX_ACTIVE_BROWSERS: "1" }),
    ).toThrow(/HUB_DOMAIN/);
    expect(() =>
      parseConfig({
        HUB_DOMAIN: "<HUB_DOMAIN>",
        PUBLIC_IP: "203.0.113.10",
        SLOT_PORTS: "52000",
        MAX_ACTIVE_BROWSERS: "1",
      }),
    ).toThrow(/HUB_DOMAIN/);
  });

  it("applique les valeurs par défaut", () => {
    expect(cfg.SLOT_PORTS).toEqual([52000, 52001, 52002]);
    expect(cfg.BROWSER_SUBNET_PREFIX).toBe("172.30.250");
    expect(cfg.BROWSER_NETWORK).toBe("netflop-browsers");
  });

  it("refuse moins de ports que de navigateurs", () => {
    expect(() =>
      parseConfig({
        HUB_DOMAIN: "netflop.example.com",
        PUBLIC_IP: "203.0.113.10",
        SLOT_PORTS: "52000",
        MAX_ACTIVE_BROWSERS: "3",
      }),
    ).toThrow(/SLOT_PORTS/);
  });

  it("refuse une IP publique non remplie", () => {
    expect(() =>
      parseConfig({ TRAEFIK_NETWORK: "t", PUBLIC_IP: "<PUBLIC_IP>", SLOT_PORTS: "52000" }),
    ).toThrow(/PUBLIC_IP/);
  });
});

describe("validation du slug", () => {
  it.each(["alice", "bob-2", "a_b", "x".repeat(32)])("accepte %s", (s) => {
    expect(SLUG_REGEX.test(s)).toBe(true);
  });

  it.each(["", "Alice", "x".repeat(33), "../etc", "a/b", "a b", "neko;rm", "élodie", "alice\n"])(
    "refuse %j",
    (s) => {
      expect(SLUG_REGEX.test(s)).toBe(false);
      expect(() => buildBrowserSpec(s, 0, cfg, "normal", creds)).toThrow(InvalidSlugError);
    },
  );
});

describe("spécification figée du conteneur", () => {
  const spec = buildBrowserSpec("alice", 1, cfg, "normal", creds);
  const host = spec.createBody.HostConfig as Record<string, unknown>;
  const env = spec.createBody.Env as string[];

  it("nomme conteneur et volume d'après le slug", () => {
    expect(spec.name).toBe("neko-alice");
    expect(spec.volumeName).toBe("netflop-profile-alice");
  });

  it("pose les labels de gestion", () => {
    expect(spec.labels["netflop.managed"]).toBe("true");
    expect(spec.labels["netflop.user"]).toBe("alice");
    expect(spec.labels["netflop.slot"]).toBe("1");
  });

  it("route /b/alice/ avec slash final (pas de capture de /b/alice2/)", () => {
    expect(spec.labels["traefik.http.routers.netflop-b-alice.rule"]).toBe(
      "Host(`netflop.example.com`) && PathPrefix(`/b/alice/`)",
    );
    expect(spec.labels["traefik.http.routers.netflop-b-alice.middlewares"]).toBe(
      "netflop-browser-auth@docker,netflop-browser-headers@docker",
    );
    expect(spec.labels["traefik.docker.network"]).toBe("netflop-browsers");
  });

  it("applique limites et isolation", () => {
    expect(host.Memory).toBe(1.5 * 1024 ** 3);
    expect(host.NanoCpus).toBe(1.5e9);
    expect(host.ShmSize).toBe(2 * 1024 ** 3);
    expect(host.Privileged).toBe(false);
    expect(host.RestartPolicy).toEqual({ Name: "no" });
    expect(host.Binds).toBeUndefined();
    expect(host.Mounts).toEqual([
      { Type: "volume", Source: "netflop-profile-alice", Target: PROFILE_MOUNT, ReadOnly: false },
    ]);
  });

  it("ne publie que le port du slot (UDP + TCP de secours)", () => {
    expect(Object.keys(host.PortBindings as object).sort()).toEqual(["52001/tcp", "52001/udp"]);
    expect(env).toContain("NEKO_WEBRTC_UDPMUX=52001");
    expect(env).toContain("NEKO_WEBRTC_NAT1TO1=203.0.113.10");
    expect(env.some((e) => e.includes("9222") || e.includes("9223="))).toBe(false);
  });

  it("sert Neko sous /b/<user> et lie le CDP à l'IP interne", () => {
    expect(env).toContain("NEKO_SERVER_PATH_PREFIX=/b/alice");
    expect(env).toContain("NEKO_MEMBER_PROVIDER=multiuser");
    expect(env).toContain("NEKO_MEMBER_MULTIUSER_ADMIN_PASSWORD=admin-secret");
    expect(env).toContain("NETFLOP_CDP_ALLOW=172.30.250.2/31");
    expect(env).toContain(`NETFLOP_CDP_BIND=${internalIpForSlot(1, cfg)}`);
    expect(internalIpForSlot(1, cfg)).toBe("172.30.250.11");
  });

  it("isolation : un seul réseau, aucun montage hôte, capacités réduites", () => {
    const net = spec.createBody.NetworkingConfig as { EndpointsConfig: Record<string, unknown> };
    expect(Object.keys(net.EndpointsConfig)).toEqual(["netflop-browsers"]);
    expect(JSON.stringify(spec.createBody)).not.toContain("docker.sock");
    expect(JSON.stringify(spec.createBody)).not.toContain("netflop-internal");
    expect(host.CapDrop).toEqual(expect.arrayContaining(["NET_RAW", "MKNOD"]));
    expect(host.SecurityOpt).toEqual(["no-new-privileges:true"]);
  });

  it("refuse un slot hors limites", () => {
    expect(() => buildBrowserSpec("alice", 3, cfg, "normal", creds)).toThrow(/Slot/);
    expect(() => buildBrowserSpec("alice", -1, cfg, "normal", creds)).toThrow(/Slot/);
    expect(() => buildBrowserSpec("alice", 0.5, cfg, "normal", creds)).toThrow(/Slot/);
  });
});

function mockDocker(routes: Record<string, (body: unknown) => [number, unknown]>) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const fetcher = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const path = url.pathname.replace(/^\/v1\.44/, "");
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path: path + url.search, body });
    const handler = routes[`${method} ${path}`];
    const [status, data] = handler ? handler(body) : [404, { message: "no such route" }];
    return new Response(data === undefined ? null : JSON.stringify(data), { status });
  }) as unknown as Fetcher;
  return { fetcher, calls };
}

describe("client Docker", () => {
  it("createBrowser : volume puis conteneur sur le SEUL réseau des navigateurs, IP fixe", async () => {
    const { fetcher, calls } = mockDocker({
      "POST /volumes/create": () => [201, { Name: "netflop-profile-bob" }],
      "POST /containers/create": () => [201, { Id: "abc123" }],
    });
    const docker = createDockerClient({ config: cfg, fetcher });
    const info = await docker.createBrowser("bob", 2, "normal", creds);

    expect(info).toMatchObject({ id: "abc123", user: "bob", slot: 2 });
    expect(calls.map((c) => `${c.method} ${c.path.split("?")[0]}`)).toEqual([
      "POST /volumes/create",
      "POST /containers/create",
    ]);
    expect(calls[1]?.path).toBe("/containers/create?name=neko-bob");
    const body = calls[1]?.body as {
      HostConfig: { NetworkMode: string };
      NetworkingConfig: { EndpointsConfig: Record<string, unknown> };
    };
    expect(body.HostConfig.NetworkMode).toBe("netflop-browsers");
    expect(body.NetworkingConfig.EndpointsConfig).toEqual({
      "netflop-browsers": { IPAMConfig: { IPv4Address: "172.30.250.12" } },
    });
  });

  it("refuse un slug invalide sans appeler Docker", async () => {
    const { fetcher } = mockDocker({});
    const docker = createDockerClient({ config: cfg, fetcher });
    await expect(docker.createBrowser("../../x", 0, "normal", creds)).rejects.toThrow(
      InvalidSlugError,
    );
    await expect(docker.removeBrowser("Bob")).rejects.toThrow(InvalidSlugError);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("inspect ignore un conteneur homonyme non géré", async () => {
    const { fetcher, calls } = mockDocker({
      "GET /containers/neko-eve/json": () => [
        200,
        {
          Id: "x",
          Created: new Date().toISOString(),
          State: { Status: "running", Running: true },
          Config: { Labels: {} },
        },
      ],
    });
    const docker = createDockerClient({ config: cfg, fetcher });
    expect(await docker.inspect("eve")).toBeNull();
    await docker.removeBrowser("eve");
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  });

  it("removeBrowser ne supprime jamais le volume de profil", async () => {
    const { fetcher, calls } = mockDocker({
      "GET /containers/neko-bob/json": () => [
        200,
        {
          Id: "abc",
          Created: new Date().toISOString(),
          State: { Status: "exited", Running: false },
          Config: { Labels: { "netflop.managed": "true", "netflop.user": "bob" } },
        },
      ],
      "DELETE /containers/abc": () => [204, undefined],
    });
    const docker = createDockerClient({ config: cfg, fetcher });
    await docker.removeBrowser("bob");
    expect(calls.some((c) => c.path.startsWith("/volumes"))).toBe(false);
    expect(calls.at(-1)?.path).toBe("/containers/abc?force=true&v=false");
  });

  it("listBrowsers filtre par label netflop.managed=true", async () => {
    const { fetcher, calls } = mockDocker({
      "GET /containers/json": () => [
        200,
        [
          {
            Id: "a",
            State: "running",
            Created: 1_700_000_000,
            Labels: { "netflop.managed": "true", "netflop.user": "alice", "netflop.slot": "0" },
          },
          { Id: "b", State: "running", Created: 1_700_000_000, Labels: {} },
        ],
      ],
    });
    const docker = createDockerClient({ config: cfg, fetcher });
    const list = await docker.listBrowsers();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: "a", user: "alice", slot: 0, running: true });
    const query = new URLSearchParams(calls[0]?.path.split("?")[1]);
    expect(JSON.parse(query.get("filters") ?? "{}")).toEqual({ label: ["netflop.managed=true"] });
  });
});
