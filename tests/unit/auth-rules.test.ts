import { describe, expect, it } from "vitest";
import {
  authentikEndSessionUrl,
  authentikIssuer,
  hasAccess,
  roleFromGroups,
} from "@/lib/auth-rules";

describe("règles d'accès Authentik", () => {
  it("exige le groupe netflop", () => {
    expect(hasAccess({ groups: ["netflop"] })).toBe(true);
    expect(hasAccess({ groups: ["netflop-admins"] })).toBe(false);
    expect(hasAccess({ groups: [] })).toBe(false);
    expect(hasAccess({ groups: null })).toBe(false);
    expect(hasAccess(null)).toBe(false);
  });

  it("admin si groupe netflop-admins", () => {
    expect(roleFromGroups(["netflop", "netflop-admins"])).toBe("admin");
    expect(roleFromGroups(["netflop"])).toBe("user");
    expect(roleFromGroups(undefined)).toBe("user");
  });

  it("issuer et end-session dérivés d'AUTHENTIK_URL", () => {
    process.env.AUTHENTIK_URL = "https://auth.example.org/";
    delete process.env.AUTH_AUTHENTIK_ISSUER;
    process.env.AUTH_URL = "https://netflop.example.org";
    expect(authentikIssuer()).toBe("https://auth.example.org/application/o/netflop/");
    const url = new URL(authentikEndSessionUrl("idtok"));
    expect(url.pathname).toBe("/application/o/netflop/end-session/");
    expect(url.searchParams.get("id_token_hint")).toBe("idtok");
    expect(url.searchParams.get("post_logout_redirect_uri")).toBe(
      "https://netflop.example.org/login?logout=1",
    );
  });
});
