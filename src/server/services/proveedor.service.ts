import { AccionAuditoria, Prisma, type Proveedor } from "@prisma/client";

import { prisma, withTransaction } from "@/lib/db";
import type { ActualizarProveedor, CrearProveedor } from "@/lib/validations/proveedor";
import { ConflictError, NotFoundError } from "@/server/errors";
import type { Actor } from "@/server/services/actor";
import { registrarAuditoria } from "@/server/services/audit.service";
import type { CompraListada } from "@/server/services/compra.service";

/** Proveedores. CUIT: 11 dígitos con verificador (Zod) y único entre los no dados de baja (índice parcial). */

export interface ProveedorListado {
  id: string;
  nombre: string;
  cuit: string | null;
  telefono: string | null;
  email: string | null;
  activo: boolean;
  compras: number;
  totalComprado: string;
  ultimaCompra: Date | null;
}

export async function listarProveedores(q?: string): Promise<ProveedorListado[]> {
  const where: Prisma.ProveedorWhereInput = {
    deletedAt: null,
    ...(q
      ? {
          OR: [
            { nombre: { contains: q, mode: "insensitive" } },
            { cuit: { contains: q.replace(/\D/g, "") || q } },
          ],
        }
      : {}),
  };
  const [proveedores, agregados] = await Promise.all([
    prisma.proveedor.findMany({ where, orderBy: [{ activo: "desc" }, { nombre: "asc" }] }),
    prisma.compra.groupBy({
      by: ["proveedorId"],
      where: { estado: "RECIBIDA", proveedorId: { not: null } },
      _count: true,
      _sum: { total: true },
      _max: { fecha: true },
    }),
  ]);
  const porId = new Map(agregados.map((a) => [a.proveedorId, a]));
  return proveedores.map((p) => {
    const a = porId.get(p.id);
    return {
      id: p.id,
      nombre: p.nombre,
      cuit: p.cuit,
      telefono: p.telefono,
      email: p.email,
      activo: p.activo,
      compras: a?._count ?? 0,
      totalComprado: new Prisma.Decimal(a?._sum.total ?? 0).toFixed(2),
      ultimaCompra: a?._max.fecha ?? null,
    };
  });
}

export async function listarProveedoresActivos(): Promise<{ id: string; nombre: string }[]> {
  return prisma.proveedor.findMany({
    where: { deletedAt: null, activo: true },
    select: { id: true, nombre: true },
    orderBy: { nombre: "asc" },
  });
}

export interface ProveedorDetalle {
  proveedor: Pick<
    Proveedor,
    "id" | "nombre" | "cuit" | "telefono" | "email" | "direccion" | "notas" | "activo"
  >;
  compras: CompraListada[];
}

export async function obtenerProveedor(id: string): Promise<ProveedorDetalle> {
  const p = await prisma.proveedor.findFirst({ where: { id, deletedAt: null } });
  if (!p) throw new NotFoundError("El proveedor no existe o fue dado de baja");
  const compras = await prisma.compra.findMany({
    where: { proveedorId: id },
    orderBy: { numero: "desc" },
    take: 50,
    include: {
      deposito: { select: { nombre: true } },
      usuario: { select: { nombre: true } },
      items: { select: { cantidad: true } },
    },
  });
  return {
    proveedor: {
      id: p.id,
      nombre: p.nombre,
      cuit: p.cuit,
      telefono: p.telefono,
      email: p.email,
      direccion: p.direccion,
      notas: p.notas,
      activo: p.activo,
    },
    compras: compras.map((c) => ({
      id: c.id,
      numero: c.numero,
      fecha: c.fecha,
      estado: c.estado,
      proveedor: p.nombre,
      deposito: c.deposito.nombre,
      items: c.items.length,
      unidades: c.items.reduce((a, i) => a + i.cantidad, 0),
      total: c.total.toFixed(2),
      usuario: c.usuario.nombre,
    })),
  };
}

function datos(input: CrearProveedor) {
  return {
    nombre: input.nombre,
    cuit: input.cuit ?? null,
    telefono: input.telefono ?? null,
    email: input.email ?? null,
    direccion: input.direccion ?? null,
    notas: input.notas ?? null,
    activo: input.activo,
  };
}

function conflictoCuit(error: unknown): void {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    throw new ConflictError("Ya hay un proveedor con ese CUIT", {
      cuit: ["Ya hay un proveedor con ese CUIT"],
    });
  }
}

export async function crearProveedor(
  input: CrearProveedor,
  actor: Actor,
): Promise<{ id: string; nombre: string }> {
  try {
    return await withTransaction(async (tx) => {
      const p = await tx.proveedor.create({ data: datos(input) });
      await registrarAuditoria(tx, {
        usuarioId: actor.id,
        accion: AccionAuditoria.CREATE,
        entidad: "Proveedor",
        entidadId: p.id,
        datosDespues: datos(input),
        meta: actor.meta,
      });
      return { id: p.id, nombre: p.nombre };
    });
  } catch (e) {
    conflictoCuit(e);
    throw e;
  }
}

export async function actualizarProveedor(
  input: ActualizarProveedor,
  actor: Actor,
): Promise<{ id: string }> {
  try {
    return await withTransaction(async (tx) => {
      const antes = await tx.proveedor.findFirst({ where: { id: input.id, deletedAt: null } });
      if (!antes) throw new NotFoundError("El proveedor no existe o fue dado de baja");
      await tx.proveedor.update({ where: { id: input.id }, data: datos(input) });
      await registrarAuditoria(tx, {
        usuarioId: actor.id,
        accion: AccionAuditoria.UPDATE,
        entidad: "Proveedor",
        entidadId: input.id,
        datosAntes: { nombre: antes.nombre, cuit: antes.cuit, activo: antes.activo },
        datosDespues: datos(input),
        meta: actor.meta,
      });
      return { id: input.id };
    });
  } catch (e) {
    conflictoCuit(e);
    throw e;
  }
}

/** Soft delete: deja de aparecer, sus compras quedan (y libera el CUIT). */
export async function darDeBajaProveedor(id: string, actor: Actor): Promise<void> {
  await withTransaction(async (tx) => {
    const p = await tx.proveedor.findFirst({ where: { id, deletedAt: null } });
    if (!p) throw new NotFoundError("El proveedor no existe o ya fue dado de baja");
    await tx.proveedor.update({ where: { id }, data: { deletedAt: new Date(), activo: false } });
    await registrarAuditoria(tx, {
      usuarioId: actor.id,
      accion: AccionAuditoria.DELETE,
      entidad: "Proveedor",
      entidadId: id,
      datosAntes: { nombre: p.nombre, cuit: p.cuit },
      meta: actor.meta,
    });
  });
}
