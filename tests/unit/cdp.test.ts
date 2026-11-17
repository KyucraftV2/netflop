import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { parseConfig } from "@/lib/config";
import { CdpError, evaluateEverywhere, insertText, navigate, pressKey } from "@/lib/cdp";

/** Faux Chrome : /json/list, /json/close et un WebSocket CDP minimal. */
describe("CDP (faux Chrome local)", () => {
  let server: Server;
  let port: number;
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  const closed: string[] = [];
  const targets = [
    { id: "main", type: "page", url: "https://www.netflix.com/watch/1", title: "Netflix" },
    { id: "extra", type: "page", url: "https://www.netflix.com/browse", title: "x" },
    { id: "sw", type: "service_worker", url: "https://www.netflix.com/sw.js", title: "" },
  ];

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === "/json/list") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(targets));
      } else if (req.url?.startsWith("/json/close/")) {
        closed.push(req.url.slice("/json/close/".length));
        res.end("Target is closing");
      } else {
        res.statusCode = 404;
        res.end();
      }
    });
    const wss = new WebSocketServer({ server });
    wss.on("connection", (ws, req) => {
      expect(req.headers.origin).toBeUndefined();
      ws.on("message", (raw) => {
        const msg = JSON.parse(String(raw)) as {
          id: number;
          method: string;
          params: Record<string, unknown>;
        };
        calls.push({ method: msg.method, params: msg.params });
        let result: unknown = {};
        if (msg.method === "Page.getFrameTree") {
          result = {
            frameTree: {
              frame: { id: "f1", url: "https://www.netflix.com/watch/1" },
              childFrames: [{ frame: { id: "f2", url: "https://player.example/" } }],
            },
          };
        } else if (msg.method === "Page.createIsolatedWorld") {
          result = { executionContextId: msg.params.frameId === "f1" ? 11 : 12 };
        } else if (msg.method === "Runtime.evaluate") {
          result = { result: { value: { ctx: msg.params.contextId } } };
        }
        ws.send(JSON.stringify({ id: msg.id, result }));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  const slot = 0;
  const opts = () => ({
    config: parseConfig({
      HUB_DOMAIN: "netflop.example.com",
      TRAEFIK_NETWORK: "t",
      PUBLIC_IP: "203.0.113.1",
      SLOT_PORTS: "52000",
      MAX_ACTIVE_BROWSERS: "1",
    }),
    baseUrl: `http://127.0.0.1:${port}`,
  });

  it("refuse une URL hors liste blanche sans contacter Chrome", async () => {
    await expect(navigate(slot, "https://evil.example/", opts())).rejects.toBeInstanceOf(CdpError);
    await expect(navigate(slot, "javascript:alert(1)", opts())).rejects.toBeInstanceOf(CdpError);
  });

  it("navigue et ferme les onglets en trop", async () => {
    await navigate(slot, "https://www.netflix.com/title/80057281", opts());
    expect(closed).toContain("extra");
    expect(calls.find((c) => c.method === "Page.navigate")?.params.url).toBe(
      "https://www.netflix.com/title/80057281",
    );
    await insertText(slot, "secret", opts());
    await pressKey(slot, "Enter", opts());
    const evals = await evaluateEverywhere<{ ctx: number }>(slot, "1", opts());
    expect(evals.map((e) => e.value.ctx)).toEqual([11, 12]);
  });
});
