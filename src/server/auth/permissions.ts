import "server-only";

import type { Modulo } from "@prisma/client";
import { redirect } from "next/navigation";

import { ACCION_LABEL, MODULO_LABEL, esOwner, puede, type Accion } from "@/lib/permisos";
import { ForbiddenError, UnauthorizedError } from "@/server/errors";

import { getCurrentUser, type UsuarioConPermisos } from "./current-user";

/**
 * AUTORIZACIÓN EN SERVIDOR — la única que cuenta.
 *
 * Capa 1 (Server Actions / Route Handlers): requirePermiso / requireOwner.
 *   Lanzan ForbiddenError / UnauthorizedError; actionHandler() los convierte
 *   en { ok: false, error }.
 * Capa 2 (páginas): requirePaginaPermiso / requirePaginaOwner / requirePaginaUsuario.
 *   Redirigen a /login, /cuenta o /sin-acceso.
 * Capa 3 (UI): <Puede> y usePuede() usan la misma función `puede` con el
 *   usuario que manda el servidor por contexto. Solo decide qué se muestra.
 */

export { puede, type Accion };
export type { UsuarioConPermisos };

/**
 * Usuario logueado. Por defecto exige que no tenga el cambio de contraseña
 * pendiente: hasta que lo haga, solo puede usar /cuenta.
 */
export async function requireUsuario(
  opciones: { permitirCambioPendiente?: boolean } = {},
): Promise<UsuarioConPermisos> {
  const usuario = await getCurrentUser();
  if (!usuario) throw new UnauthorizedError();
  if (usuario.debeCambiarPassword && !opciones.permitirCambioPendiente) {
    throw new ForbiddenError("Tenés que cambiar tu contraseña antes de continuar.");
  }
  return usuario;
}

export async function requirePermiso(modulo: Modulo, accion: Accion): Promise<UsuarioConPermisos> {
  const usuario = await requireUsuario();
  if (!puede(usuario, modulo, accion)) {
    throw new ForbiddenError(
      `No tenés permiso para ${ACCION_LABEL[accion].toLowerCase()} en ${MODULO_LABEL[modulo]}.`,
    );
  }
  return usuario;
}

export async function requireOwner(): Promise<UsuarioConPermisos> {
  const usuario = await requireUsuario();
  if (!esOwner(usuario)) throw new ForbiddenError("Solo los dueños pueden realizar esta acción.");
  return usuario;
}

// --- Páginas: mismas reglas, pero redirigiendo en vez de lanzar ---------------

async function paraPagina(fn: () => Promise<UsuarioConPermisos>): Promise<UsuarioConPermisos> {
  let destino: string;
  try {
    return await fn();
  } catch (error) {
    if (error instanceof UnauthorizedError) destino = "/login";
    else if (error instanceof ForbiddenError) {
      const usuario = await getCurrentUser();
      destino = usuario?.debeCambiarPassword ? "/cuenta" : "/sin-acceso";
    } else throw error;
  }
  redirect(destino); // fuera del try: redirect() funciona lanzando
}

export function requirePaginaPermiso(modulo: Modulo, accion: Accion = "ver") {
  return paraPagina(() => requirePermiso(modulo, accion));
}

/** Página accesible si puede `accion` en al menos uno de los módulos (ej: Escanear). */
export function requirePaginaPermisoAlguno(modulos: readonly Modulo[], accion: Accion = "ver") {
  return paraPagina(async () => {
    const usuario = await requireUsuario();
    if (!modulos.some((m) => puede(usuario, m, accion))) throw new ForbiddenError();
    return usuario;
  });
}

export function requirePaginaOwner() {
  return paraPagina(requireOwner);
}

export function requirePaginaUsuario(opciones?: { permitirCambioPendiente?: boolean }) {
  return paraPagina(() => requireUsuario(opciones));
}
