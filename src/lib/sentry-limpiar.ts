import type { ErrorEvent } from "@sentry/nextjs";

/**
 * beforeSend de Sentry: nada sensible sale de la app. Se borran cookies,
 * headers de autenticación, bodies, query strings y datos del usuario
 * (queda solo el id interno).
 */
const CLAVES_SENSIBLES =
  /pass|token|secret|cookie|authorization|tok\b|cuit|documento|email|telefono/i;

function limpiarObjeto(o: unknown, profundidad = 0): unknown {
  if (profundidad > 5 || o === null || typeof o !== "object") return o;
  if (Array.isArray(o)) return o.map((x) => limpiarObjeto(x, profundidad + 1));
  return Object.fromEntries(
    Object.entries(o as Record<string, unknown>).map(([k, v]) => [
      k,
      CLAVES_SENSIBLES.test(k) ? "[redactado]" : limpiarObjeto(v, profundidad + 1),
    ]),
  );
}

export function limpiarEventoSentry(evento: ErrorEvent): ErrorEvent {
  if (evento.request) {
    delete evento.request.cookies;
    delete evento.request.data;
    if (evento.request.headers) {
      for (const h of Object.keys(evento.request.headers))
        if (CLAVES_SENSIBLES.test(h)) evento.request.headers[h] = "[redactado]";
    }
    if (evento.request.query_string) evento.request.query_string = "[redactado]";
  }
  if (evento.user) evento.user = { id: evento.user.id };
  if (evento.extra) evento.extra = limpiarObjeto(evento.extra) as typeof evento.extra;
  if (evento.contexts) evento.contexts = limpiarObjeto(evento.contexts) as typeof evento.contexts;
  return evento;
}
