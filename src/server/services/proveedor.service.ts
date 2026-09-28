import { AccionAuditoria, Prisma, type Proveedor } from "@prisma/client";

import type { ActualizarProveedor, CrearProveedor } from "@/lib/validations/proveedor";
import { dbPara, transaccion, type Ctx } from "@/server/db/panel-scoped";
import { ConflictError, NotFoundError } from "@/server/errors";
import { registrarAuditoria } from "@/server/services/audit.service";
import type { CompraListada } from "@/server/services/compra.service";

/**
 * Proveedores del panel. CUIT: 11 dígitos con verificador (Zod) y único por
 * panel entre los no dados de baja (índice parcial). Los montos comprados
 * solo se calculan si quien llama puede ver COMPRAS (`conCompras`).
 */

export interface ProveedorListado {
  id: string;
  nombre: string;
  cuit: string | null;
  telefono: string | null;
  email: string | null;
  activo: boolean;
  /** null = sin permiso de COMPRAS. */
  compras: number | null;
  totalComprado: string | null;
  ultimaCompra: Date | null;
}

export async function listarProveedores(
  ctx: Ctx,
  opciones: { q?: string; conCompras: boolean },
): Promise<ProveedorListado[]> {
  const { q, conCompras } = opciones;
  const db = dbPara(ctx.panelId);
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
    db.proveedor.findMany({ where, orderBy: [{ activo: "desc" }, { nombre: "asc" }] }),
    conCompras
      ? db.compra.groupBy({
          by: ["proveedorId"],
          where: { estado: "RECIBIDA", proveedorId: { not: null } },
          _count: true,
          _sum: { total: true },
          _max: { fecha: true },
        })
      : Promise.resolve([]),
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
      compras: conCompras ? (a?._count ?? 0) : null,
      totalComprado: conCompras ? new Prisma.Decimal(a?._sum.total ?? 0).toFixed(2) : null,
      ultimaCompra: a?._max.fecha ?? null,
    };
  });
}

export async function listarProveedoresActivos(
  ctx: Ctx,
): Promise<{ id: string; nombre: string }[]> {
  return dbPara(ctx.panelId).proveedor.findMany({
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
  /** null = sin permiso de COMPRAS. */
  compras: CompraListada[] | null;
}

export async function obtenerProveedor(
  ctx: Ctx,
  id: string,
  opciones: { conCompras: boolean },
): Promise<ProveedorDetalle> {
  const db = dbPara(ctx.panelId);
  const p = await db.proveedor.findFirst({ where: { id, deletedAt: null } });
  if (!p) throw new NotFoundError("El proveedor no existe o fue dado de baja");
  if (!opciones.conCompras) return { proveedor: detalle(p), compras: null };
  const compras = await db.compra.findMany({
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
    proveedor: detalle(p),
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

function detalle(p: Proveedor): ProveedorDetalle["proveedor"] {
  return {
    id: p.id,
    nombre: p.nombre,
    cuit: p.cuit,
    telefono: p.telefono,
    email: p.email,
    direccion: p.direccion,
    notas: p.notas,
    activo: p.activo,
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
    throw new ConflictError("Ya hay un proveedor con ese CUIT en este panel", {
      cuit: ["Ya hay un proveedor con ese CUIT en este panel"],
    });
  }
}

export async function crearProveedor(
  ctx: Ctx,
  input: CrearProveedor,
): Promise<{ id: string; nombre: string }> {
  try {
    return await transaccion(ctx, async (tx) => {
      const p = await tx.proveedor.create({ data: datos(input) });
      await registrarAuditoria(tx, {
        usuarioId: ctx.usuarioId,
        accion: AccionAuditoria.CREATE,
        entidad: "Proveedor",
        entidadId: p.id,
        datosDespues: datos(input),
        meta: ctx.meta,
      });
      return { id: p.id, nombre: p.nombre };
    });
  } catch (e) {
    conflictoCuit(e);
    throw e;
  }
}

export async function actualizarProveedor(
  ctx: Ctx,
  input: ActualizarProveedor,
): Promise<{ id: string }> {
  try {
    return await transaccion(ctx, async (tx) => {
      const antes = await tx.proveedor.findFirst({ where: { id: input.id, deletedAt: null } });
      if (!antes) throw new NotFoundError("El proveedor no existe o fue dado de baja");
      await tx.proveedor.update({ where: { id: input.id }, data: datos(input) });
      await registrarAuditoria(tx, {
        usuarioId: ctx.usuarioId,
        accion: AccionAuditoria.UPDATE,
        entidad: "Proveedor",
        entidadId: input.id,
        datosAntes: { nombre: antes.nombre, cuit: antes.cuit, activo: antes.activo },
        datosDespues: datos(input),
        meta: ctx.meta,
      });
      return { id: input.id };
    });
  } catch (e) {
    conflictoCuit(e);
    throw e;
  }
}

/** Soft delete: deja de aparecer, sus compras quedan (y libera el CUIT). */
export async function darDeBajaProveedor(ctx: Ctx, id: string): Promise<void> {
  await transaccion(ctx, async (tx) => {
    const p = await tx.proveedor.findFirst({ where: { id, deletedAt: null } });
    if (!p) throw new NotFoundError("El proveedor no existe o ya fue dado de baja");
    await tx.proveedor.update({ where: { id }, data: { deletedAt: new Date(), activo: false } });
    await registrarAuditoria(tx, {
      usuarioId: ctx.usuarioId,
      accion: AccionAuditoria.DELETE,
      entidad: "Proveedor",
      entidadId: id,
      datosAntes: { nombre: p.nombre, cuit: p.cuit },
      meta: ctx.meta,
    });
  });
}
