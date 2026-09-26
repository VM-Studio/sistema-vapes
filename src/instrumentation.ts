import * as Sentry from "@sentry/nextjs";

/**
 * Se ejecuta UNA vez al arrancar el servidor.
 * 1. Valida el entorno (src/env.ts): con variables inválidas la app no arranca.
 * 2. Sentry (opcional): solo si hay SENTRY_DSN.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { obtenerEnv, versionApp } = await import("./env");
    const env = obtenerEnv();
    const { log } = await import("./server/log");
    log.info(
      { storage: env.STORAGE_PROVIDER, sentry: Boolean(env.SENTRY_DSN) },
      "servidor iniciado",
    );
    if (env.SENTRY_DSN) {
      const { limpiarEventoSentry } = await import("./lib/sentry-limpiar");
      Sentry.init({
        dsn: env.SENTRY_DSN,
        release: versionApp(),
        environment: process.env.VERCEL_ENV ?? env.NODE_ENV,
        tracesSampleRate: 0.05,
        beforeSend: limpiarEventoSentry,
      });
    }
  }
}

/** Errores de Server Components / Route Handlers / Server Actions → Sentry (no-op sin DSN). */
export const onRequestError = Sentry.captureRequestError;
