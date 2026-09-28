import "server-only";

import { AccionAuditoria, type Modulo } from "@prisma/client";
import { redirect } from "next/navigation";
import { cache } from "react";

import {
  ACCION_LABEL,
  MODULO_LABEL,
  accedeAPanel,
  esOwner,
  puede,
  type Accion,
} from "@/lib/permisos";
import { prisma } from "@/lib/db";
import type { Ctx } from "@/server/db/panel-scoped";
import { ForbiddenError, NotFoundError, UnauthorizedError } from "@/server/errors";
import { logger } from "@/server/log";

import { panelPorSlug, type PanelBasico } from "./paneles-acceso";

import { getCurrentUser, type UsuarioConPermisos } from "./current-user";
import { metaDesdeHeaders } from "./request-meta";

/**
 * AUTORIZACIÓN EN SERVIDOR — la única que cuenta.
 *
 * Todo lo de negocio ocurre DENTRO de un panel (/p/{slug}): los permisos son
 * por panel y cada operación recibe un `ctx` con el panel resuelto.
 *
 * Capa 1 (Server Actions / Route Handlers): requireCtx(modulo, accion) →
 *   ctx { panelId, usuarioId, meta } para los servicios; requireOwner para lo
 *   global. Lanzan ForbiddenError / UnauthorizedError; actionHandler() los
 *   convierte en { ok: false, error }.
 * Capa 2 (páginas): requirePaginaPanel / requirePaginaOwner / requirePaginaUsuario.
 *   Redirigen a /login, /cuenta, /paneles o /sin-acceso.
 * Capa 3 (UI): <Puede> y usePuede() usan la misma función `puede` con el
 *   usuario y el panel que manda el servidor por contexto. Solo decide qué se muestra.
 */

export { puede, type Accion };
export type { UsuarioConPermisos, PanelBasico };

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

/**
 * Deja constancia en AuditLog de cada acceso denegado (ruta, usuario, IP y
 * qué se intentó). Nunca frena la respuesta: si falla, solo se loguea.
 */
async function registrarDenegado(
  usuario: UsuarioConPermisos | null,
  detalle: string,
  panelId: string | null,
): Promise<void> {
  try {
    const { headers } = await import("next/headers");
    const h = await headers();
    await prisma.auditLog.create({
      data: {
        panelId,
        usuarioId: usuario?.id ?? null,
        accion: AccionAuditoria.ACCESO_DENEGADO,
        entidad: "Acceso",
        entidadId: null,
        datosDespues: {
          ruta: h.get("x-pathname") ?? null,
          accion: h.get("next-action") ? "server-action" : "pagina/api",
          detalle,
        },
        ip: metaDesdeHeaders(h).ip,
        userAgent: metaDesdeHeaders(h).userAgent,
      },
    });
  } catch (e) {
    logger().warn({ err: e }, "no se pudo auditar un acceso denegado");
  }
}

export async function requirePermiso(
  panelId: string,
  modulo: Modulo,
  accion: Accion,
): Promise<UsuarioConPermisos> {
  const usuario = await requireUsuario();
  if (!puede(usuario, panelId, modulo, accion)) {
    const mensaje = `No tenés permiso para ${ACCION_LABEL[accion].toLowerCase()} en ${MODULO_LABEL[modulo]}.`;
    await registrarDenegado(usuario, `${panelId}:${modulo}:${accion}`, panelId);
    throw new ForbiddenError(mensaje);
  }
  return usuario;
}

/** Alcanza con poder `accion` en alguno de los módulos (ej: buscador de variantes). */
export async function requirePermisoAlguno(
  panelId: string,
  modulos: readonly Modulo[],
  accion: Accion,
): Promise<UsuarioConPermisos> {
  const usuario = await requireUsuario();
  if (!modulos.some((m) => puede(usuario, panelId, m, accion))) {
    await registrarDenegado(usuario, `${panelId}:${modulos.join("|")}:${accion}`, panelId);
    throw new ForbiddenError(
      `No tenés permiso para ${ACCION_LABEL[accion].toLowerCase()} en ${modulos.map((m) => MODULO_LABEL[m]).join(" ni ")}.`,
    );
  }
  return usuario;
}

export async function requireOwner(): Promise<UsuarioConPermisos> {
  const usuario = await requireUsuario();
  if (!esOwner(usuario)) {
    await registrarDenegado(usuario, "solo-owner", null);
    throw new ForbiddenError("Solo los dueños pueden realizar esta acción.");
  }
  return usuario;
}

// --- Panel actual --------------------------------------------------------------

/**
 * Panel del request: el middleware lo resolvió desde /p/{slug} (o /api/p/{slug})
 * y verificó el acceso; acá se vuelve a verificar contra el usuario del
 * request (defensa en profundidad). Cacheado por request.
 */
export const getPanelActual = cache(async (): Promise<PanelBasico> => {
  const { headers } = await import("next/headers");
  const slug = (await headers()).get("x-panel-slug");
  if (!slug) throw new ForbiddenError("Esta acción solo se puede usar dentro de un panel.");
  const panel = await panelPorSlug(slug);
  if (!panel) throw new NotFoundError("Ese panel no existe o está desactivado.");
  const usuario = await requireUsuario();
  if (!accedeAPanel(usuario, panel.id)) {
    await registrarDenegado(usuario, `panel:${panel.slug}`, panel.id);
    throw new ForbiddenError("No tenés acceso a ese panel.");
  }
  return panel;
});

/** Contexto de una operación de negocio: panel + usuario + metadatos del request. */
export interface CtxPanel extends Ctx {
  panel: PanelBasico;
  usuario: UsuarioConPermisos;
}

async function armarCtx(panel: PanelBasico, usuario: UsuarioConPermisos): Promise<CtxPanel> {
  const { headers } = await import("next/headers");
  return {
    panelId: panel.id,
    usuarioId: usuario.id,
    meta: metaDesdeHeaders(await headers()),
    panel,
    usuario,
  };
}

/** Server Actions / Route Handlers de un panel: permiso en el panel actual → ctx. */
export async function requireCtx(modulo: Modulo, accion: Accion): Promise<CtxPanel> {
  const panel = await getPanelActual();
  return armarCtx(panel, await requirePermiso(panel.id, modulo, accion));
}

/** Como requireCtx, pero alcanza con uno de los módulos. */
export async function requireCtxAlguno(
  modulos: readonly Modulo[],
  accion: Accion,
): Promise<CtxPanel> {
  const panel = await getPanelActual();
  return armarCtx(panel, await requirePermisoAlguno(panel.id, modulos, accion));
}

/** Solo dueños, dentro de un panel (configuración del panel). */
export async function requireCtxOwner(): Promise<CtxPanel> {
  const panel = await getPanelActual();
  return armarCtx(panel, await requireOwner());
}

// --- Páginas: mismas reglas, pero redirigiendo en vez de lanzar ---------------

async function paraPagina<T>(fn: () => Promise<T>): Promise<T> {
  let destino: string;
  try {
    return await fn();
  } catch (error) {
    if (error instanceof UnauthorizedError) destino = "/login";
    else if (error instanceof NotFoundError) destino = "/paneles?aviso=sin-acceso";
    else if (error instanceof ForbiddenError) {
      const usuario = await getCurrentUser();
      const { headers } = await import("next/headers");
      const slug = (await headers()).get("x-panel-slug");
      destino = usuario?.debeCambiarPassword
        ? "/cuenta"
        : slug
          ? `/p/${slug}/sin-acceso`
          : "/sin-acceso";
    } else throw error;
  }
  redirect(destino); // fuera del try: redirect() funciona lanzando
}

/** Página de un módulo del panel actual. */
export function requirePaginaPanel(modulo: Modulo, accion: Accion = "ver") {
  return paraPagina(() => requireCtx(modulo, accion));
}

/** Página accesible si puede `accion` en al menos uno de los módulos (ej: Escanear). */
export function requirePaginaPanelAlguno(modulos: readonly Modulo[], accion: Accion = "ver") {
  return paraPagina(() => requireCtxAlguno(modulos, accion));
}

/** Página del panel solo para dueños (configuración del panel). */
export function requirePaginaPanelOwner() {
  return paraPagina(requireCtxOwner);
}

/** Cualquier usuario con acceso al panel actual (ej: inicio del panel). */
export function requirePaginaPanelUsuario() {
  return paraPagina(async () => armarCtx(await getPanelActual(), await requireUsuario()));
}

export function requirePaginaOwner() {
  return paraPagina(requireOwner);
}

export function requirePaginaUsuario(opciones?: { permitirCambioPendiente?: boolean }) {
  return paraPagina(() => requireUsuario(opciones));
}
