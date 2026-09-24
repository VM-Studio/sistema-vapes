import "server-only";

import { cookies } from "next/headers";
import { cache } from "react";

import { obtenerUsuarioSesion, type UsuarioConPermisos } from "@/server/services/sesion.service";

import { COOKIE_SESION, verificarToken, type PayloadSesion } from "./session";

export type { UsuarioConPermisos };

/** Payload del JWT de la cookie, si es válido. Cacheado por request. */
export const getSesion = cache(async (): Promise<PayloadSesion | null> => {
  const jar = await cookies();
  return verificarToken(jar.get(COOKIE_SESION)?.value);
});

/**
 * Usuario logueado + permisos, leídos de la DB (una sola vez por request
 * gracias a React cache()). null si no hay sesión, el token no vale o el
 * usuario fue desactivado/dado de baja.
 */
export const getCurrentUser = cache(async (): Promise<UsuarioConPermisos | null> => {
  const sesion = await getSesion();
  return sesion ? obtenerUsuarioSesion(sesion.sub) : null;
});
