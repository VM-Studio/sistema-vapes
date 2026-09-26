/**
 * Lighthouse CI (mobile, el preset por defecto): /login y / (autenticado).
 * Presupuesto: Performance ≥ 80, Accessibility ≥ 90. La instalabilidad de la
 * PWA se verifica aparte con scripts/verificar-instalable.mjs (Lighthouse 12
 * eliminó la categoría PWA).
 * Uso: con el build hecho → pnpm lighthouse
 */
const PUERTO = process.env.E2E_PORT || 3100;
module.exports = {
  ci: {
    collect: {
      url: [`http://localhost:${PUERTO}/login`, `http://localhost:${PUERTO}/`],
      // 3 corridas y se evalúa la MEDIANA: una sola corrida varía mucho (servidor frío, CPU de la máquina).
      numberOfRuns: Number(process.env.LHCI_RUNS || 3),
      startServerCommand: `npx tsx e2e/global-setup.ts && pnpm start -p ${PUERTO}`,
      startServerReadyPattern: "Ready in",
      startServerReadyTimeout: 180000,
      puppeteerScript: "./lighthouse/login.cjs",
      puppeteerLaunchOptions: { args: ["--no-sandbox"] },
      chromePath:
        process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      settings: {
        // Mantener la sesión entre el login y la auditoría de "/".
        disableStorageReset: true,
        chromeFlags: "--no-sandbox",
      },
    },
    assert: {
      assertions: {
        "categories:performance": ["error", { minScore: 0.8, aggregationMethod: "median-run" }],
        "categories:accessibility": ["error", { minScore: 0.9, aggregationMethod: "median-run" }],
        "categories:best-practices": ["warn", { minScore: 0.9, aggregationMethod: "median-run" }],
      },
    },
    upload: { target: "filesystem", outputDir: "./lighthouse/reportes" },
  },
};
