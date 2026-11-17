import { defineConfig, devices } from "@playwright/test";

const PORT = 3200;
const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? "postgresql://netflop@127.0.0.1:55432/netflop_e2e";
process.env.E2E_DATABASE_URL = E2E_DATABASE_URL;

/**
 * Parcours de bout en bout minimal : connexion simulée (session en base), recherche
 * (faux TMDB), lancement de lecture simulé (API navigateur interceptée).
 * Prérequis : `bun run build` et une base Postgres jetable (E2E_DATABASE_URL).
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "ordinateur", use: { ...devices["Desktop Chrome"] } },
    { name: "telephone", use: { ...devices["Pixel 7"] } },
  ],
  webServer: [
    {
      command: "bun e2e/mock-tmdb.ts",
      url: "http://127.0.0.1:3999/health",
      reuseExistingServer: true,
    },
    {
      command: `bunx next start -p ${PORT}`,
      url: `http://localhost:${PORT}/api/health`,
      reuseExistingServer: true,
      timeout: 60_000,
      env: {
        DATABASE_URL: E2E_DATABASE_URL,
        AUTH_SECRET: "e2e-secret-e2e-secret-e2e-secret-123",
        AUTH_URL: `http://localhost:${PORT}`,
        AUTH_TRUST_HOST: "true",
        AUTHENTIK_URL: "https://auth.example.org",
        AUTH_AUTHENTIK_ID: "e2e",
        AUTH_AUTHENTIK_SECRET: "e2e",
        HUB_DOMAIN: "localhost",
        PUBLIC_IP: "203.0.113.10",
        SLOT_PORTS: "52000,52001,52002",
        DOCKER_PROXY_URL: "http://127.0.0.1:2399",
        TMDB_API_KEY: "e2e-key",
        TMDB_API_BASE_URL: "http://127.0.0.1:3999",
        JUSTWATCH_ENABLED: "false",
      },
    },
  ],
});
