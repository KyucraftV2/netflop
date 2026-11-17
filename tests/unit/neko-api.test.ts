import { describe, expect, it } from "vitest";
import { createNekoApi, nekoApiBase } from "@/lib/neko-api";
import { testConfig } from "../integration/helpers";

function fakeNeko() {
  const calls: { method: string; path: string; auth: string | null; body: unknown }[] = [];
  const fetcher = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/b\/bob\/api/, "");
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    calls.push({
      method,
      path,
      auth: headers.get("authorization"),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    if (path === "/login") return json({ id: "netflop-hub", token: "tok" });
    if (path === "/sessions")
      return json([{ id: "bob" }, { id: "alice", profile: { name: "alice" } }]);
    if (path === "/room/settings" && method === "GET") return json({ implicit_hosting: true });
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  return { calls, fetcher };
}

const target = { slug: "bob", slot: 1, adminPassword: "secret" };

describe("API Neko (Regarder ensemble)", () => {
  it("adresse interne du navigateur", () => {
    expect(nekoApiBase(target, testConfig)).toBe("http://172.30.250.11:8080/b/bob/api");
  });

  it("verrouille le contrôle en conservant les autres réglages", async () => {
    const { calls, fetcher } = fakeNeko();
    await createNekoApi(target, testConfig, fetcher).lockControls();
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "POST /login",
      "GET /room/settings",
      "POST /room/settings",
      "POST /logout",
    ]);
    expect(calls[2]!.body).toEqual({ implicit_hosting: true, locked_controls: true });
    expect(calls[1]!.auth).toBe("Bearer tok");
  });

  it("passe le contrôle à l'invité connecté, sinon renvoie false", async () => {
    const { calls, fetcher } = fakeNeko();
    const neko = createNekoApi(target, testConfig, fetcher);
    expect(await neko.giveControl("alice")).toBe(true);
    expect(calls.some((c) => c.path === "/room/control/give/alice")).toBe(true);
    expect(await neko.giveControl("carol")).toBe(false);
  });
});
