import { defineConfig, devices } from "@playwright/test";

/**
 * E2E de flujos críticos contra el BUILD de producción y una base AISLADA
 * (DATABASE_URL_TEST): el setup global la recrea (migraciones + seed) antes
 * de la suite. Dos proyectos: escritorio 1440×900 y celular (Pixel 7, táctil).
 * Serial: los flujos comparten la base y el stock.
 */
const PUERTO = Number(process.env.E2E_PORT ?? 3100);
export const URL_TEST =
  process.env.DATABASE_URL_TEST ?? "postgresql://app:app@localhost:5433/gestion_e2e?schema=public";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: `http://localhost:${PUERTO}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "es-AR",
    timezoneId: "America/Argentina/Buenos_Aires",
    // Local: el Chrome instalado. CI: el Chromium de Playwright.
    ...(process.env.CI ? {} : { channel: "chrome" }),
  },
  projects: [
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    // Primero la base de test (DROP/CREATE + migrate deploy + seed), después el build.
    command: `npx tsx e2e/global-setup.ts && pnpm start -p ${PUERTO}`,
    url: `http://localhost:${PUERTO}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: URL_TEST,
      DIRECT_URL: URL_TEST,
      NEXT_PUBLIC_APP_URL: `http://localhost:${PUERTO}`,
      STORAGE_DIR: ".storage-e2e",
      RATE_LIMIT_POR_MINUTO: "5000",
      LOG_LEVEL: "warn",
    },
  },
});
