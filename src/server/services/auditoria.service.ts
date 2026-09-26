import { AccionAuditoria, Prisma } from "@prisma/client";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { esDiaISO, limitesRango, ZONA_DEFAULT } from "@/lib/zona-horaria";

export const filtrosAuditoriaSchema = z.object({
  usuarioId: z.string().min(1).optional().catch(undefined),
  entidad: z.string().trim().max(60).optional().catch(undefined),
  accion: z.enum(AccionAuditoria).optional().catch(undefined),
  desde: z.string().refine(esDiaISO).optional().catch(undefined),
  hasta: z.string().refine(esDiaISO).optional().catch(undefined),
  page: z.coerce.number().int().min(1).catch(1),
});

export type FiltrosAuditoria = z.output<typeof filtrosAuditoriaSchema>;

export interface CambioCampo {
  campo: string;
  antes: unknown;
  despues: unknown;
}

/** Diferencias campo por campo entre datosAntes y datosDespues. */
export function diffAuditoria(antes: Prisma.JsonValue, despues: Prisma.JsonValue): CambioCampo[] {
  const a = (antes && typeof antes === "object" && !Array.isArray(antes) ? antes : {}) as Record<
    string,
    unknown
  >;
  const d = (
    despues && typeof despues === "object" && !Array.isArray(despues) ? despues : {}
  ) as Record<string, unknown>;
  return [...new Set([...Object.keys(a), ...Object.keys(d)])]
    .filter((k) => JSON.stringify(a[k]) !== JSON.stringify(d[k]))
    .map((campo) => ({ campo, antes: a[campo], despues: d[campo] }));
}

export async function listarAuditoria(f: FiltrosAuditoria, pageSize = 50) {
  const where: Prisma.AuditLogWhereInput = {};
  if (f.usuarioId) where.usuarioId = f.usuarioId;
  if (f.entidad) where.entidad = f.entidad;
  if (f.accion) where.accion = f.accion;
  if (f.desde || f.hasta) {
    const { inicio, fin } = limitesRango(
      f.desde ?? "2000-01-01",
      f.hasta ?? "2999-12-31",
      ZONA_DEFAULT,
    );
    where.createdAt = { gte: inicio, lt: fin };
  }
  const [total, filas, entidades] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (f.page - 1) * pageSize,
      take: pageSize,
      include: { usuario: { select: { nombre: true } } },
    }),
    prisma.auditLog.groupBy({ by: ["entidad"], orderBy: { entidad: "asc" } }),
  ]);
  return {
    total,
    page: f.page,
    pageSize,
    entidades: entidades.map((e) => e.entidad),
    filas: filas.map((r) => ({
      id: r.id,
      fecha: r.createdAt,
      usuario: r.usuario?.nombre ?? "—",
      accion: r.accion,
      entidad: r.entidad,
      entidadId: r.entidadId,
      ip: r.ip,
      cambios: diffAuditoria(r.datosAntes, r.datosDespues),
      soloDespues: r.datosAntes === null ? r.datosDespues : null,
    })),
  };
}
