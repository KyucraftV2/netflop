import { afterEach, describe, expect, it, vi } from "vitest";
import { hasOpsToken, opsTokenConfigured } from "@/lib/ops-token";

vi.mock("server-only", () => ({}));

const TOKEN = "t".repeat(40);
const req = (auth?: string) =>
  new Request("http://localhost/api/metrics", auth ? { headers: { authorization: auth } } : {});

describe("jeton des sondes d'exploitation", () => {
  afterEach(() => {
    delete process.env.METRICS_TOKEN;
  });

  it("désactivé sans jeton ou avec un jeton trop court", () => {
    expect(opsTokenConfigured()).toBe(false);
    process.env.METRICS_TOKEN = "court";
    expect(opsTokenConfigured()).toBe(false);
    expect(hasOpsToken(req("Bearer court"))).toBe(false);
  });

  it("n'accepte que le bon jeton en Bearer", () => {
    process.env.METRICS_TOKEN = TOKEN;
    expect(hasOpsToken(req(`Bearer ${TOKEN}`))).toBe(true);
    expect(hasOpsToken(req(`Bearer ${TOKEN}x`))).toBe(false);
    expect(hasOpsToken(req(TOKEN))).toBe(false);
    expect(hasOpsToken(req())).toBe(false);
  });

  it("échappement des labels Prometheus", async () => {
    const { escapeLabel } = await import("@/lib/metrics");
    expect(escapeLabel('a"b\\c\nd')).toBe('a\\"b\\\\c\\nd');
  });
});
