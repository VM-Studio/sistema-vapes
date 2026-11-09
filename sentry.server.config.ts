import * as Sentry from "@sentry/nextjs";

import {
  ERRORES_IGNORADOS,
  RECOLECCION_DATOS,
  SENTRY_ACTIVO,
  SENTRY_DSN,
  SENTRY_ENTORNO,
  SENTRY_RELEASE,
} from "@/lib/sentry-config";

/** Sentry en el servidor (Server Components, Route Handlers, Server Actions, middleware). */
Sentry.init({
  dsn: process.env.SENTRY_DSN ?? SENTRY_DSN,
  enabled: SENTRY_ACTIVO && process.env.VERCEL === "1",
  release: SENTRY_RELEASE,
  environment: SENTRY_ENTORNO,
  // 10 % de las requests con traza de performance (alcanza para ver lentitudes sin gastar cuota).
  tracesSampleRate: 0.1,
  dataCollection: RECOLECCION_DATOS,
  ignoreErrors: ERRORES_IGNORADOS,
});
