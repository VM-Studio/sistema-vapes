import * as Sentry from "@sentry/nextjs";

import {
  ERRORES_IGNORADOS,
  RECOLECCION_DATOS,
  SENTRY_ACTIVO,
  SENTRY_DSN,
  SENTRY_ENTORNO,
  SENTRY_RELEASE,
} from "@/lib/sentry-config";

/**
 * Sentry en el navegador. Los eventos salen por /monitoring (túnel en el
 * propio dominio: cumple la CSP y no lo bloquean los ad-blockers). Sin
 * Session Replay: las pantallas muestran datos privados del negocio.
 */
Sentry.init({
  dsn: SENTRY_DSN,
  enabled: SENTRY_ACTIVO && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname),
  release: SENTRY_RELEASE,
  environment: SENTRY_ENTORNO,
  tracesSampleRate: 0.1,
  dataCollection: RECOLECCION_DATOS,
  ignoreErrors: ERRORES_IGNORADOS,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
