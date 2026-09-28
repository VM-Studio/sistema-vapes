/**
 * Se ejecuta UNA vez al arrancar el servidor: valida el entorno (src/env.ts);
 * con variables inválidas la app no arranca.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { obtenerEnv, versionApp } = await import("./env");
    const env = obtenerEnv();
    const { log } = await import("./server/log");
    log.info({ storage: env.STORAGE_PROVIDER, version: versionApp() }, "servidor iniciado");
  }
}

/** Errores de Server Components / Route Handlers / Server Actions: al log estructurado. */
export async function onRequestError(
  error: unknown,
  request: { path: string; method: string },
  contexto: { routerKind: string; routePath: string; routeType: string },
) {
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
