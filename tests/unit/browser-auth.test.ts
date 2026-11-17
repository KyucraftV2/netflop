import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CACHE_TTL_MS,
  checkBrowserAccess,
  invalidateBrowserAuthCache,
  sessionTokenFromCookie,
  slugFromForwardedUri,
} from "@/lib/browser-auth";

const future = new Date(Date.now() + 86_400_000);
const COOKIE = "__Secure-authjs.session-token=tok-alice; other=1";

describe("slugFromForwardedUri", () => {
  it.each([
    ["/b/alice/", "alice"],
    ["/b/alice", "alice"],
    ["/b/alice/api/ws?token=x", "alice"],
    ["/b/a_b-2/x", "a_b-2"],
  ])("%s → %s", (uri, slug) => expect(slugFromForwardedUri(uri)).toBe(slug));

  it.each([
    null,
    "",
    "/",
    "/b/",
    "/b/Alice/",
    "/b/../x/",
    "/api/b/alice",
    "/b/a%2Fb/",
    // Divergences de normalisation (routage vers bob, autorisation pour alice)
    "/b/bob/../alice/",
    "/b/bob/%2e%2e/alice/",
    "/b/bob/..%2Falice/",
    "/b/alice/./x",
    "/b//alice/",
    "/b/alice\\..\\bob/",
    "/b/alice%00/",
  ])("%j → null", (uri) => expect(slugFromForwardedUri(uri)).toBeNull());
});

describe("sessionTokenFromCookie", () => {
  it("en production, seul le cookie __Secure- est accepté", () => {
    const prod = ["__Secure-authjs.session-token"];
    expect(sessionTokenFromCookie("authjs.session-token=abc", prod)).toBeNull();
    expect(sessionTokenFromCookie("__Secure-authjs.session-token=abc", prod)).toBe("abc");
    expect(sessionTokenFromCookie("__Secure-authjs.session-token=%E0%A4%A", prod)).toBeNull();
  });

  it("lit le cookie sécurisé ou non", () => {
    expect(sessionTokenFromCookie(COOKIE)).toBe("tok-alice");
    expect(sessionTokenFromCookie("authjs.session-token=abc")).toBe("abc");
    expect(sessionTokenFromCookie("foo=bar")).toBeNull();
    expect(sessionTokenFromCookie(null)).toBeNull();
  });
});

describe("checkBrowserAccess", () => {
  beforeEach(() => invalidateBrowserAuthCache());

  const lookup = vi.fn(async (token: string) =>
    token === "tok-alice" ? { slug: "alice", expires: future } : null,
  );

  it("401 sans cookie", async () => {
    const r = await checkBrowserAccess({ uri: "/b/alice/", cookie: null }, lookup);
    expect(r.status).toBe(401);
  });

  it("401 avec une session inconnue", async () => {
    const r = await checkBrowserAccess(
      { uri: "/b/alice/", cookie: "__Secure-authjs.session-token=bad" },
      lookup,
    );
    expect(r.status).toBe(401);
  });

  it("401 avec une session expirée", async () => {
    const r = await checkBrowserAccess({ uri: "/b/alice/", cookie: COOKIE }, async () => ({
      slug: "alice",
      expires: new Date(Date.now() - 1000),
    }));
    expect(r.status).toBe(401);
  });

  it("403 sur le navigateur d'un autre", async () => {
    const r = await checkBrowserAccess({ uri: "/b/bob/", cookie: COOKIE }, lookup);
    expect(r).toMatchObject({ status: 403, requested: "bob", slug: "alice" });
  });

  it("403 sur un préfixe trompeur (/b/alice2/)", async () => {
    const r = await checkBrowserAccess({ uri: "/b/alice2/", cookie: COOKIE }, lookup);
    expect(r.status).toBe(403);
  });

  it("200 pour son propre navigateur", async () => {
    const r = await checkBrowserAccess({ uri: "/b/alice/api/ws", cookie: COOKIE }, lookup);
    expect(r).toEqual({ status: 200, slug: "alice" });
  });

  it("met en cache 30 s par jeton", async () => {
    const spy = vi.fn(async () => ({ slug: "alice", expires: future }));
    const now = 1_000_000;
    await checkBrowserAccess({ uri: "/b/alice/", cookie: COOKIE, now }, spy);
    await checkBrowserAccess({ uri: "/b/alice/x", cookie: COOKIE, now: now + 10_000 }, spy);
    expect(spy).toHaveBeenCalledTimes(1);
    await checkBrowserAccess(
      { uri: "/b/alice/", cookie: COOKIE, now: now + CACHE_TTL_MS + 1 },
      spy,
    );
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("l'invalidation coupe l'accès immédiatement (déconnexion)", async () => {
    let valid = true;
    const dyn = async () => (valid ? { slug: "alice", expires: future } : null);
    expect((await checkBrowserAccess({ uri: "/b/alice/", cookie: COOKIE }, dyn)).status).toBe(200);
    valid = false;
    invalidateBrowserAuthCache("tok-alice");
    expect((await checkBrowserAccess({ uri: "/b/alice/", cookie: COOKIE }, dyn)).status).toBe(401);
  });
});
