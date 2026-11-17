import { test, type Page } from "@playwright/test";
import { E2E_SESSION_TOKEN } from "./global-setup";

/** Captures d'écran de chaque page (CAPTURES=1 bunx playwright test captures). */
test.skip(!process.env.CAPTURES, "captures sur demande uniquement");

async function shot(page: Page, name: string) {
  await page.waitForTimeout(400);
  await page.screenshot({
    path: `e2e/captures/${test.info().project.name}-${name}.png`,
    fullPage: true,
  });
}

test("captures", async ({ page }) => {
  await page.goto("/login");
  await shot(page, "connexion");
  await page
    .context()
    .addCookies([
      { name: "authjs.session-token", value: E2E_SESSION_TOKEN, domain: "localhost", path: "/" },
    ]);
  await page.goto("/");
  await shot(page, "accueil");
  await page.goto("/?q=last");
  await page.getByRole("button", { name: /The Last of Us/ }).waitFor();
  await shot(page, "recherche");
  await page.goto("/historique");
  await shot(page, "historique");
  await page.goto("/profil");
  await shot(page, "profil");
  await page.goto("/admin");
  await shot(page, "admin");
  await page.goto("/page-inconnue");
  await shot(page, "404");

  const base = {
    slot: 0,
    slug: "alice",
    platform: "netflix",
    stillWatchingPrompt: false,
    opened: null,
    pendingUrl: null,
    error: null,
  };
  await page.route("**/api/browser/start", (r) =>
    r.fulfill({ json: { state: "queued", position: 2, platform: "netflix" } }),
  );
  await page.route("**/api/browser/heartbeat", (r) =>
    r.fulfill({ json: { state: "queued", position: 2, platform: "netflix" } }),
  );
  await page.route("**/api/browser/status", (r) =>
    r.fulfill({ json: { state: "queued", position: 2, platform: "netflix" } }),
  );
  await page.route("**/api/browser/leave", (r) => r.fulfill({ status: 204 }));
  await page.goto("/watch/netflix");
  await shot(page, "lecture-file-attente");
  await page.unrouteAll();
  const ready = { ...base, state: "ready", stillWatchingPrompt: true };
  await page.route("**/api/browser/start", (r) => r.fulfill({ json: ready }));
  await page.route("**/api/browser/status", (r) => r.fulfill({ json: ready }));
  await page.route("**/api/browser/heartbeat", (r) => r.fulfill({ json: ready }));
  await page.route("**/api/browser/leave", (r) => r.fulfill({ status: 204 }));
  await page.route("**/api/browser/still-watching", (r) => r.fulfill({ status: 204 }));
  await page.route("**/b/alice/**", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: "<body style='margin:0;background:#222;color:#888;display:grid;place-items:center;height:100vh;font:24px sans-serif'>Flux Neko</body>",
    }),
  );
  await page.goto("/watch/netflix");
  await page.locator("iframe").waitFor();
  await shot(page, "lecture-tu-regardes-toujours");
});
