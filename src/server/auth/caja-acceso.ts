import "server-only";

import { Modulo } from "@prisma/client";

import { prisma } from "@/lib/db";
import { esOwner, puede } from "@/lib/permisos";
import { ForbiddenError, NotFoundError } from "@/server/errors";

import { requirePermiso, type UsuarioConPermisos } from "./permissions";

/**
 * Una caja se puede ver con CAJA "ver" si está abierta o si la abrió/cerró
 * uno mismo. El histórico ajeno (con sus diferencias) es solo para dueños.
 */
export async function requireAccesoCaja(cajaId: string): Promise<UsuarioConPermisos> {
  const usuario = await requirePermiso(Modulo.CAJA, "ver");
  if (esOwner(usuario)) return usuario;
  const caja = await prisma.caja.findUnique({
    where: { id: cajaId },
    select: { estado: true, abiertaPorId: true, cerradaPorId: true },
  });
  if (!caja) throw new NotFoundError("La caja no existe");
  const propia = caja.abiertaPorId === usuario.id || caja.cerradaPorId === usuario.id;
  if (caja.estado === "ABIERTA" || propia) return usuario;
  throw new ForbiddenError("El histórico de cajas es solo para los dueños.");
}

export const puedeVerHistoricoCajas = (u: UsuarioConPermisos) =>
  esOwner(u) && puede(u, Modulo.CAJA, "ver");
