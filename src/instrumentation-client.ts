/**
 * Sentry en el navegador: opcional. Sin NEXT_PUBLIC_SENTRY_DSN no se descarga
 * el SDK (import dinámico): la app no paga ese peso si no se usa.
 */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

type Sentry = typeof import("@sentry/nextjs");
let sentry: Sentry | null = null;

if (dsn) {
  void Promise.all([import("@sentry/nextjs"), import("@/lib/sentry-limpiar")]).then(
    ([s, { limpiarEventoSentry }]) => {
      s.init({
        dsn,
        release: process.env.NEXT_PUBLIC_APP_VERSION,
        tracesSampleRate: 0,
        beforeSend: limpiarEventoSentry,
      });
      sentry = s;
    },
  );
}

export function onRouterTransitionStart(
  ...args: Parameters<Sentry["captureRouterTransitionStart"]>
) {
  sentry?.captureRouterTransitionStart(...args);
}
