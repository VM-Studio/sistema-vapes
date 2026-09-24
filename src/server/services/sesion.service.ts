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
      modulo: true,
      puedeVer: true,
      puedeCrear: true,
      puedeEditar: true,
      puedeEliminar: true,
    },
  },
} satisfies Prisma.UsuarioSelect;

/** Usuario + permisos, solo si puede operar (activo y no dado de baja). */
export async function obtenerUsuarioSesion(id: string): Promise<UsuarioConPermisos | null> {
  return prisma.usuario.findFirst({
    where: { id, activo: true, deletedAt: null },
    select: selectUsuarioSesion,
  });
}

/** Lo mínimo que necesita el middleware en cada request. null = la sesión no vale. */
export async function estadoSesion(
  id: string,
): Promise<{ rol: RolUsuario; debeCambiarPassword: boolean } | null> {
  return prisma.usuario.findFirst({
    where: { id, activo: true, deletedAt: null },
    select: { rol: true, debeCambiarPassword: true },
  });
}
