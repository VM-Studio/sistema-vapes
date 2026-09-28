import type { Prisma, RolUsuario } from "@prisma/client";

import { prisma } from "@/lib/db";
import type { UsuarioSesion } from "@/lib/permisos";

/**
 * Consultas de sesión. Separado de auth.service para que el middleware (que
 * corre en cada request) no cargue bcrypt ni la lógica de login.
 */

export type UsuarioConPermisos = UsuarioSesion;

const selectUsuarioSesion = {
  id: true,
  nombre: true,
  email: true,
  rol: true,
  debeCambiarPassword: true,
  permisos: {
    select: {
      panelId: true,
      modulo: true,
      puedeVer: true,
      puedeCrear: true,
      puedeEditar: true,
      puedeEliminar: true,
    },
  },
  paneles: { select: { panelId: true } },
} satisfies Prisma.UsuarioSelect;

/** Usuario + permisos + paneles habilitados, solo si puede operar (activo y no dado de baja). */
export async function obtenerUsuarioSesion(id: string): Promise<UsuarioConPermisos | null> {
  const u = await prisma.usuario.findFirst({
    where: { id, activo: true, deletedAt: null },
    select: selectUsuarioSesion,
  });
  return u ? { ...u, paneles: u.paneles.map((p) => p.panelId) } : null;
}

/** Lo mínimo que necesita el middleware en cada request. null = la sesión no vale. */
export async function estadoSesion(
  id: string,
): Promise<{ rol: RolUsuario; debeCambiarPassword: boolean; paneles: string[] } | null> {
  const u = await prisma.usuario.findFirst({
    where: { id, activo: true, deletedAt: null },
    select: { rol: true, debeCambiarPassword: true, paneles: { select: { panelId: true } } },
  });
  return u ? { ...u, paneles: u.paneles.map((p) => p.panelId) } : null;
}
