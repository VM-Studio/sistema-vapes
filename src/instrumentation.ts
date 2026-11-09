/**
 * Se ejecuta UNA vez al arrancar el servidor: valida el entorno (src/env.ts);
 * con variables inválidas la app no arranca.
 */
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") await import("../sentry.edge.config");
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
    const { obtenerEnv, versionApp } = await import("./env");
    const env = obtenerEnv();
    const { log } = await import("./server/log");
    log.info({ storage: env.STORAGE_PROVIDER, version: versionApp() }, "servidor iniciado");
  }
}

/** Errores de Server Components / Route Handlers / Server Actions: a Sentry y al log estructurado. */
export async function onRequestError(...args: Parameters<typeof Sentry.captureRequestError>) {
  Sentry.captureRequestError(...args);
  const [error, request, contexto] = args;
  const { log } = await import("./server/log");
  log.error(
    {
      err: error,
      path: request.path,
      method: request.method,
      ruta: contexto.routePath,
      tipo: contexto.routeType,
    },
    "error no controlado en request",
  );
}
