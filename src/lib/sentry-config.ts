import type { init } from "@sentry/nextjs";

type DataCollection = NonNullable<NonNullable<Parameters<typeof init>[0]>["dataCollection"]>;

/**
 * Configuración común de Sentry (servidor y navegador). El DSN es una clave
 * PÚBLICA (solo permite enviar eventos, no leer nada): va en el código para
 * que funcione sin configurar variables; SENTRY_DSN / NEXT_PUBLIC_SENTRY_DSN la pisan.
 * Solo se envía desde producción/preview en Vercel: en dev, en los tests y en
 * builds locales (e2e) queda apagado.
 */
export const SENTRY_DSN =
  process.env.NEXT_PUBLIC_SENTRY_DSN ??
  "https://574c4631e1b10277700b4cc67530dafc@o4512226075017216.ingest.us.sentry.io/4512402913492992";

export const SENTRY_ACTIVO =
  process.env.NODE_ENV === "production" && process.env.SENTRY_DISABLED !== "1";

export const SENTRY_RELEASE = process.env.NEXT_PUBLIC_APP_VERSION;

/** Producción en Vercel, o lo que diga VERCEL_ENV (preview) / local. */
export const SENTRY_ENTORNO =
  process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.VERCEL_ENV ?? "production";

/**
 * Privacidad: la app maneja datos del negocio y la cookie de sesión. No se
 * mandan cookies, cuerpos de requests/respuestas, valores de las queries SQL
 * ni datos de usuario; de los headers solo los que sirven para diagnosticar.
 */
export const RECOLECCION_DATOS: DataCollection = {
  userInfo: false,
  cookies: false,
  httpHeaders: { allow: ["user-agent", "referer", "content-type", "x-request-id"] },
  httpBodies: [],
  urlQueryParams: false,
  databaseQueryData: false,
};

/** Errores de red / del navegador que no son bugs de la app. */
export const ERRORES_IGNORADOS = [
  "ResizeObserver loop limit exceeded",
  "ResizeObserver loop completed with undelivered notifications",
  "NEXT_REDIRECT",
  "NEXT_NOT_FOUND",
  "AbortError",
  "Failed to fetch",
  "NetworkError when attempting to fetch resource",
  "Load failed",
];
