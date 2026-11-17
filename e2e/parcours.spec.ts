import { expect, test, type Page } from "@playwright/test";
import { E2E_SESSION_TOKEN } from "./global-setup";

async function login(page: Page) {
  await page
    .context()
    .addCookies([
      { name: "authjs.session-token", value: E2E_SESSION_TOKEN, domain: "localhost", path: "/" },
    ]);
}

test("sans session → page de connexion", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("button", { name: "Se connecter" })).toBeVisible();
});

test("accueil : uniquement mes plateformes et « Continuer à regarder »", async ({ page }) => {
  await login(page);
  await page.goto("/");
  await expect(page.getByRole("link", { name: /Regarder Netflix/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Regarder Canal\+/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Regarder france\.tv/ })).toHaveCount(0);
  await expect(page.getByText("inclut HBO Max et Apple TV+").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Continuer à regarder" })).toBeVisible();
  await expect(page.getByText("S2 · É4").first()).toBeVisible();
  await page.getByRole("link", { name: "Voir toutes les plateformes" }).click();
  await expect(page.getByRole("link", { name: /Regarder france\.tv/ })).toBeVisible();
});

test("recherche, filtre « mes abonnements » puis lancement de lecture simulé", async ({ page }) => {
  await login(page);
  await page.goto("/");

  // Ouvre le champ sur mobile (icône), directement visible sur ordinateur.
  const field = page.getByRole("searchbox", { name: /Rechercher un film ou une série/ });
  if (!(await field.isVisible())) await page.getByRole("button", { name: "Rechercher" }).click();
  await field.fill("last");

  await expect(page.getByRole("button", { name: /^The Last of Us.*canalplus/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^The Last Kingdom.*netflix/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Last Night in Soho/ })).toHaveCount(0);

  await page.getByRole("switch", { name: "Mes abonnements uniquement" }).click();
  await expect(page.getByRole("button", { name: /^Last Night in Soho/ })).toBeVisible();
  await page.getByRole("switch", { name: "Mes abonnements uniquement" }).click();

  // Navigateur simulé : l'API Docker/Neko n'est pas sollicitée.
  let statusCalls = 0;
  await page.route("**/api/browser/open", (r) =>
    r.fulfill({ json: { state: "starting", watchUrl: "/watch/canalplus?opened=1" } }),
  );
  const ready = {
    state: "ready",
    slot: 0,
    slug: "alice",
    platform: "canalplus",
    stillWatchingPrompt: false,
    sleep: { at: null as string | null, afterEpisode: false },
    opened: {
      platform: "canalplus",
      url: "https://www.canalplus.com/",
      title: "The Last of Us",
      tmdbId: 100088,
      type: "tv",
      openedAt: "",
    },
    pendingUrl: null,
    error: null,
  };
  await page.route("**/api/browser/status", (r) =>
    r.fulfill({ json: ++statusCalls < 2 ? { ...ready, state: "starting" } : ready }),
  );
  await page.route("**/api/browser/heartbeat", (r) => r.fulfill({ json: ready }));
  await page.route("**/api/browser/still-watching", (r) => r.fulfill({ status: 204 }));
  await page.route("**/api/browser/leave", (r) => r.fulfill({ status: 204 }));
  await page.route("**/api/browser/quit", (r) => r.fulfill({ status: 204 }));
  let sleepBody: unknown = null;
  await page.route("**/api/browser/sleep", (r) => {
    sleepBody = r.request().postDataJSON();
    // Le serveur renvoie ensuite le minuteur dans le statut.
    ready.sleep = { at: new Date(Date.now() + 30 * 60_000).toISOString(), afterEpisode: false };
    return r.fulfill({ status: 204 });
  });
  await page.route("**/b/alice/**", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: "<html><body style='background:#000;color:#fff'>NEKO</body></html>",
    }),
  );

  await page.getByRole("button", { name: /^The Last of Us.*canalplus/ }).click();
  await expect(page).toHaveURL(/\/watch\/canalplus\?opened=1/);
  await expect(page.locator('iframe[title^="Navigateur Netflop"]')).toBeVisible({
    timeout: 10_000,
  });
  await expect(
    page.frameLocator('iframe[title^="Navigateur Netflop"]').getByText("NEKO"),
  ).toBeVisible();
  await expect(page.getByRole("toolbar", { name: "Commandes de lecture" })).toContainText(
    "The Last of Us",
  );

  // Écran « Tourne ton téléphone » éventuel (mobile en portrait)
  const keepPortrait = page.getByRole("button", { name: "Continuer en portrait" });
  if (await keepPortrait.isVisible()) await keepPortrait.click();
  const sound = page.getByRole("button", { name: "Appuie pour activer le son" });
  if (await sound.isVisible()) await sound.click();

  // Regarder ensemble : lien d'invitation (API simulée)
  await page.route("**/api/browser/invite", (r) =>
    r.request().method() === "POST"
      ? r.fulfill({
          status: 201,
          json: { id: "00000000-0000-4000-8000-000000000001", path: "/ensemble/lien-de-test" },
        })
      : r.fulfill({ json: { invites: [] } }),
  );
  await page.mouse.move(10, 10);
  await page.getByRole("button", { name: "Regarder ensemble" }).click();
  await page.getByRole("button", { name: "Créer un lien d'invitation" }).click();
  await expect(page.getByRole("textbox", { name: "Lien d'invitation" })).toHaveValue(
    /\/ensemble\/lien-de-test$/,
  );
  await page.getByRole("button", { name: "Fermer" }).click();

  // Minuteur de sommeil
  await page.mouse.move(10, 10);
  await page.getByRole("button", { name: "Minuteur de sommeil" }).click();
  await page.getByRole("menuitem", { name: "Dans 30 min" }).click();
  await page.mouse.move(20, 20);
  await expect(page.getByRole("button", { name: /^Arrêt dans (29|30|31) min$/ })).toBeVisible();
  expect(sleepBody).toEqual({ minutes: 30 });

  await page.mouse.move(10, 10);
  await page.getByRole("button", { name: "Quitter" }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("Pour toi : recommandations disponibles sur mes abonnements", async ({ page }) => {
  await login(page);
  await page.goto("/");
  const row = page.getByRole("region", { name: "Pour toi" });
  await expect(row.getByRole("button", { name: /^Game of Thrones.*canalplus/ })).toBeVisible();
  await expect(row.getByRole("button", { name: /^The Witcher.*netflix/ })).toBeVisible();
  // Disney+ n'est pas un abonnement d'Alice, et The Last Kingdom est déjà en cours.
  await expect(row.getByRole("button", { name: /^Last Night in Soho/ })).toHaveCount(0);
  await expect(row.getByRole("button", { name: /^The Last Kingdom/ })).toHaveCount(0);
});

test("Ma liste : ajout depuis la recherche, rangée sur l'accueil, retrait", async ({ page }) => {
  await login(page);
  await page.goto("/?q=last");
  const add = page.getByRole("button", { name: "Ajouter à ma liste : The Last of Us" });
  await add.click();
  await expect(
    page.getByRole("button", { name: "Retirer de ma liste : The Last of Us" }),
  ).toHaveAttribute("aria-pressed", "true");

  await page.goto("/");
  const row = page.getByRole("region", { name: "Ma liste" });
  await expect(row.getByRole("button", { name: /^The Last of Us/ })).toBeVisible();

  await row.getByRole("button", { name: "Retirer de ma liste : The Last of Us" }).click();
  await page.reload();
  await expect(page.getByRole("region", { name: "Ma liste" })).toHaveCount(0);
});

test("sondes d'exploitation fermées sans jeton", async ({ request }) => {
  expect((await request.get("/api/health")).status()).toBe(200);
  expect((await request.get("/api/health?deep=1")).status()).toBe(401);
  expect((await request.get("/api/metrics")).status()).toBe(404);
});

test("notifications : section du profil, endpoint de push contrôlé", async ({ page }) => {
  await login(page);
  await page.goto("/profil");
  await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();
  await expect(page.getByRole("switch", { name: /Nouveaux épisodes/ })).toBeChecked();
  // Un endpoint qui n'est pas un service de push connu est refusé (pas de requête serveur).
  const status = await page.evaluate(async () => {
    const res = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        endpoint: "https://docker-proxy:2375/containers/json",
        keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2", auth: "tBHItJI5svbpez7K" },
      }),
    });
    return res.status;
  });
  expect(status).toBe(400);
});

test("regarder ensemble : sans session, retour au lien après connexion", async ({ page }) => {
  await page.goto("/ensemble/abcdefghijklmnopqrstuvwxyz012345");
  await expect(page).toHaveURL(/\/login\?next=%2Fensemble%2Fabcdefghijklmnopqrstuvwxyz012345$/);
  await expect(page.locator('input[name="next"]')).toHaveValue(
    "/ensemble/abcdefghijklmnopqrstuvwxyz012345",
  );
});

test("regarder ensemble : lien invalide", async ({ page }) => {
  await login(page);
  await page.goto(`/ensemble/${"x".repeat(32)}`);
  await expect(page.getByText("Cette invitation n'est plus valable.")).toBeVisible();
});

test("pages protégées : historique, profil, admin, 404", async ({ page }) => {
  await login(page);
  await page.goto("/historique");
  await expect(page.getByRole("heading", { name: "Historique" })).toBeVisible();
  await expect(page.getByText("The Last Kingdom")).toBeVisible();
  await page.goto("/profil");
  await expect(page.getByRole("heading", { name: "Mes abonnements" })).toBeVisible();
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Administration" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Visionnage/ })).toBeVisible();
  await expect(page.getByText("1 h au total sur 14 jours")).toBeVisible();
  await expect(page.getByRole("cell", { name: "onglet fermé" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Vider la file" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Supprimer le profil Chrome de alice" }),
  ).toBeVisible();
  const res = await page.goto("/nimporte-quoi");
  expect(res?.status()).toBe(404);
  await expect(page.getByText("404")).toBeVisible();
});
