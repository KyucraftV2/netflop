import { describe, expect, it } from "vitest";
import { z } from "zod";
import { HttpError, assertSameOrigin, parseJson, route } from "@/lib/http";

const ORIGIN = "https://netflop.example.com";
const req = (headers: Record<string, string>, method = "POST", body?: string) =>
  new Request(`${ORIGIN}/api/browser/input`, { method, headers, body });

describe("anti-CSRF", () => {
  it("accepte la même origine", () => {
    expect(() =>
      assertSameOrigin(req({ origin: ORIGIN, "sec-fetch-site": "same-origin" }), ORIGIN),
    ).not.toThrow();
  });

  it.each([
    [{ origin: "https://autre.example.com", "sec-fetch-site": "same-site" }],
    [{ origin: "https://evil.example", "sec-fetch-site": "cross-site" }],
    [{ origin: "https://autre.example.com" }],
    [{ "sec-fetch-site": "same-site" }],
  ])("refuse %j", (headers) => {
    expect(() => assertSameOrigin(req(headers), ORIGIN)).toThrow(HttpError);
  });

  it("ignore les GET", () => {
    expect(() =>
      assertSameOrigin(req({ origin: "https://evil.example" }, "GET"), ORIGIN),
    ).not.toThrow();
  });

  it("route() renvoie 403 sur une requête cross-site", async () => {
    process.env.AUTH_URL = ORIGIN;
    const h = route(async (r: Request) => new Response(r.method));
    const res = await h(
      req({ origin: "https://autre.example.com", "sec-fetch-site": "same-site" }),
    );
    expect(res.status).toBe(403);
  });
});

describe("parseJson", () => {
  const schema = z.object({ text: z.string() });
  it("refuse un corps text/plain (requête simple forgée)", async () => {
    await expect(
      parseJson(req({ "content-type": "text/plain" }, "POST", '{"text":"x"}'), schema),
    ).rejects.toMatchObject({ status: 415 });
  });
  it("refuse un corps trop gros", async () => {
    await expect(
      parseJson(
        req(
          { "content-type": "application/json" },
          "POST",
          JSON.stringify({ text: "x".repeat(20_000) }),
        ),
        schema,
      ),
    ).rejects.toMatchObject({ status: 413 });
  });
  it("accepte du JSON valide", async () => {
    expect(
      await parseJson(req({ "content-type": "application/json" }, "POST", '{"text":"x"}'), schema),
    ).toEqual({ text: "x" });
  });
});
