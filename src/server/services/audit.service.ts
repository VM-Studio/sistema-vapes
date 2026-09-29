import { AccionAuditoria, Prisma, type Usuario } from "@prisma/client";

import { ahora } from "@/lib/reloj";
import type { Tx } from "@/server/db/panel-scoped";
import type { RequestMeta } from "@/server/auth/request-meta";

export interface DatosAuditoria {
  usuarioId: string | null;
  accion: AccionAuditoria;
  entidad: string;
  entidadId?: string | null;
  datosAntes?: Prisma.InputJsonValue | null;
  datosDespues?: Prisma.InputJsonValue | null;
  meta?: RequestMeta;
}

/** Inserta una fila en AuditLog (inmutable). Siempre dentro de la tx del cambio auditado. */
export async function registrarAuditoria(tx: Tx, datos: DatosAuditoria): Promise<void> {
  await tx.auditLog.create({
    data: {
      usuarioId: datos.usuarioId,
      accion: datos.accion,
      entidad: datos.entidad,
      entidadId: datos.entidadId ?? null,
      datosAntes: datos.datosAntes ?? Prisma.JsonNull,
      datosDespues: datos.datosDespues ?? Prisma.JsonNull,
      ip: datos.meta?.ip ?? null,
      userAgent: datos.meta?.userAgent ?? null,
      // Hora de negocio (en la app, ahora; el seed demo la simula).
      createdAt: ahora(),
    },
  });
}

/** Snapshot de un usuario para auditoría: NUNCA incluye passwordHash. */
export function snapshotUsuario(u: Usuario): Prisma.InputJsonObject {
  return {
    nombre: u.nombre,
    email: u.email,
    rol: u.rol,
    activo: u.activo,
    debeCambiarPassword: u.debeCambiarPassword,
    deletedAt: u.deletedAt?.toISOString() ?? null,
  };
}
