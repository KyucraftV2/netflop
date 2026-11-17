import { beforeEach, describe, expect, it } from "vitest";
import { checkAccount, resetDiscoveryCache } from "@/lib/access-revalidation";

const issuer = "https://auth.example.org/application/o/netflop/";

function authentik(opts: {
  tokenStatus?: number;
  tokenError?: string;
  groups?: string[];
  down?: boolean;
}) {
  return (async (input: URL | RequestInfo) => {
    const url = String(input);
    if (opts.down) throw new Error("ECONNREFUSED");
    if (url.endsWith("/.well-known/openid-configuration")) {
      return Response.json({
        token_endpoint: "https://auth.example.org/application/o/token/",
        userinfo_endpoint: "https://auth.example.org/application/o/userinfo/",
      });
    }
    if (url.endsWith("/token/")) {
      if (opts.tokenStatus && opts.tokenStatus !== 200) {
        return Response.json(
          { error: opts.tokenError ?? "server_error" },
          { status: opts.tokenStatus },
        );
      }
      return Response.json({ access_token: "at", refresh_token: "rt2", expires_in: 300 });
    }
    if (url.endsWith("/userinfo/")) return Response.json({ groups: opts.groups ?? [] });
    return new Response(null, { status: 404 });
  }) as typeof fetch;
}

describe("revérification des droits Authentik", () => {
  beforeEach(() => resetDiscoveryCache());
  const deps = (o: Parameters<typeof authentik>[0]) => ({
    fetcher: authentik(o),
    issuer,
    clientId: "c",
    clientSecret: "s",
  });

  it("garde l'accès et met à jour le rôle", async () => {
    const r = await checkAccount("rt", deps({ groups: ["netflop", "netflop-admins"] }));
    expect(r.decision).toEqual({ action: "keep", role: "admin" });
    expect(r.tokens?.refresh_token).toBe("rt2");
  });

  it("révoque si retiré du groupe netflop", async () => {
    const r = await checkAccount("rt", deps({ groups: ["autre"] }));
    expect(r.decision.action).toBe("revoke");
  });

  it("révoque si Authentik refuse le refresh token (compte désactivé)", async () => {
    const r = await checkAccount("rt", deps({ tokenStatus: 400, tokenError: "invalid_grant" }));
    expect(r.decision.action).toBe("revoke");
  });

  it("ne révoque PAS si Authentik est injoignable ou en erreur", async () => {
    expect((await checkAccount("rt", deps({ down: true }))).decision.action).toBe("skip");
    resetDiscoveryCache();
    expect((await checkAccount("rt", deps({ tokenStatus: 500 }))).decision.action).toBe("skip");
  });

  it("sans refresh token : reporté", async () => {
    expect((await checkAccount(null, deps({}))).decision.action).toBe("skip");
  });
});
