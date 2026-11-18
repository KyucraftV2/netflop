import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { allowlistJson, buildAllowlist } from "@/lib/allowlist";
import { PLATFORM_LIST } from "@/lib/platforms";

describe("liste blanche d'URL de Chrome", () => {
  it("browser/policies-allowlist.json est à jour (sinon : bun run allowlist)", () => {
    expect(readFileSync("browser/policies-allowlist.json", "utf8")).toBe(allowlistJson());
  });

  it("bloque tout sauf les domaines des plateformes, sans doublon", () => {
    const { URLBlocklist, URLAllowlist } = buildAllowlist();
    expect(URLBlocklist).toEqual(["*"]);
    for (const p of PLATFORM_LIST) {
      for (const d of p.allowedDomains) expect(URLAllowlist).toContain(d);
    }
    expect(new Set(URLAllowlist).size).toBe(URLAllowlist.length);
    expect(URLAllowlist[0]).toBe("file:///opt/netflop/home/");
  });
});
