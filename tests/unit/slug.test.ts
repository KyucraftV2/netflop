import { describe, expect, it } from "vitest";
import { isValidSlug, slugWithSuffix, slugify, uniqueSlug } from "@/lib/slug";

describe("slugify", () => {
  it.each([
    ["Alice", "alice"],
    ["Élodie Dupré", "elodie-dupre"],
    ["jean.pierre@x", "jean-pierre-x"],
    ["  --Bob--  ", "bob"],
    ["under_score", "under_score"],
    ["ÇA va ?", "ca-va"],
    ["日本", "user"],
    ["", "user"],
    [null, "user"],
  ])("%j → %s", (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it("tronque à 32 caractères et reste valide", () => {
    const s = slugify("a".repeat(31) + "-bcdef");
    expect(s.length).toBeLessThanOrEqual(32);
    expect(isValidSlug(s)).toBe(true);
    expect(s.endsWith("-")).toBe(false);
  });

  it("produit toujours un slug valide", () => {
    for (const input of ["x!y", "ÀÉÎÕÜ", "a b c", "--", "Z".repeat(100), "a/b\\c"]) {
      expect(isValidSlug(slugify(input))).toBe(true);
    }
  });
});

describe("collision", () => {
  it("suffixe numérique", async () => {
    const taken = new Set(["alice", "alice-2"]);
    expect(await uniqueSlug("Alice", async (s) => taken.has(s))).toBe("alice-3");
  });

  it("le suffixe garde 32 caractères max", () => {
    const s = slugWithSuffix("a".repeat(32), 12);
    expect(s).toHaveLength(32);
    expect(s.endsWith("-12")).toBe(true);
  });
});
