import { AccionAuditoria, Prisma, RolUsuario } from "@prisma/client";

import { dbPara, transaccion, type Ctx, type Tx } from "@/server/db/panel-scoped";
import { ConflictError, DomainError, ForbiddenError, NotFoundError } from "@/server/errors";
import { registrarAuditoria } from "@/server/services/audit.service";

/**
 * UBICACIONES DE PRODUCTOS (por panel).
 *
 * - Los dueños arman a mano los lugares del galpón (Ubicacion: «Estante A ·
 *   fila 2», con una aclaración opcional y un orden) y asignan cada MODELO
 *   (Producto: marca + modelo + pitadas, con todos sus sabores) a uno.
 * - Lo ven los dueños y el perfil de escaneo (Charly, Modulo.ESCANEO "ver"):
 *   en la pantalla de escaneo cada vape muestra dónde buscarlo.
 * - Borrar un lugar deja sus modelos «sin ubicación» (FK ON DELETE SET NULL).
 */

export interface UbicacionListada {
  id: string;
  nombre: string;
  descripcion: string | null;
  orden: number;
  productos: number;
}

export interface ProductoUbicable {
  id: string;
  /** "Elf Bar BC 5000". */
  nombre: string;
  marca: string;
  ubicacionId: string | null;
}

export interface DatosUbicaciones {
  ubicaciones: UbicacionListada[];
  productos: ProductoUbicable[];
}

async function exigirOwner(tx: Tx, ctx: Ctx): Promise<void> {
  const u = await tx.usuario.findUnique({ where: { id: ctx.usuarioId }, select: { rol: true } });
  if (u?.rol !== RolUsuario.OWNER)
    throw new ForbiddenError("Solo los dueños arman las ubicaciones de los productos.");
}

const limpiar = (s: string | undefined | null) => s?.trim().replace(/\s+/g, " ") || null;

function conflictoNombre(e: unknown): never | void {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
    throw new ConflictError("Ya hay una ubicación con ese nombre", {
      nombre: ["Ya hay una ubicación con ese nombre"],
    });
}

/** Lugares (en su orden) y los modelos activos del panel con su ubicación. */
export async function datosUbicaciones(ctx: Pick<Ctx, "panelId">): Promise<DatosUbicaciones> {
  const db = dbPara(ctx.panelId);
  const [ubicaciones, productos] = await Promise.all([
    db.ubicacion.findMany({
      orderBy: [{ orden: "asc" }, { nombre: "asc" }],
      select: {
        id: true,
        nombre: true,
        descripcion: true,
        orden: true,
        _count: { select: { productos: { where: { deletedAt: null } } } },
      },
    }),
    db.producto.findMany({
      where: { deletedAt: null, activo: true },
      orderBy: [{ marca: { nombre: "asc" } }, { nombreCompleto: "asc" }],
      select: {
        id: true,
        nombreCompleto: true,
        ubicacionId: true,
        marca: { select: { nombre: true } },
      },
    }),
  ]);
  return {
    ubicaciones: ubicaciones.map((u) => ({
      id: u.id,
      nombre: u.nombre,
      descripcion: u.descripcion,
      orden: u.orden,
      productos: u._count.productos,
    })),
    productos: productos.map((p) => ({
      id: p.id,
      nombre: p.nombreCompleto,
      marca: p.marca.nombre,
      ubicacionId: p.ubicacionId,
    })),
  };
}

export interface UbicacionInput {
  nombre: string;
  descripcion?: string | null;
}

export async function crearUbicacion(ctx: Ctx, input: UbicacionInput): Promise<{ id: string }> {
  const nombre = limpiar(input.nombre);
  if (!nombre) throw new DomainError("Poné un nombre (ej.: Estante A · fila 2).");
  try {
    return await transaccion(ctx, async (tx) => {
      await exigirOwner(tx, ctx);
      const ultimo = await tx.ubicacion.aggregate({ _max: { orden: true } });
      const u = await tx.ubicacion.create({
        data: {
          nombre,
          descripcion: limpiar(input.descripcion),
          orden: (ultimo._max.orden ?? 0) + 1,
        },
      });
      await registrarAuditoria(tx, {
        usuarioId: ctx.usuarioId,
        accion: AccionAuditoria.CREATE,
        entidad: "Ubicacion",
        entidadId: u.id,
        datosDespues: { nombre: u.nombre, descripcion: u.descripcion },
        meta: ctx.meta,
      });
      return { id: u.id };
    });
  } catch (e) {
    conflictoNombre(e);
    throw e;
  }
}

export async function actualizarUbicacion(
  ctx: Ctx,
  id: string,
  input: UbicacionInput,
): Promise<{ id: string }> {
  const nombre = limpiar(input.nombre);
  if (!nombre) throw new DomainError("Poné un nombre (ej.: Estante A · fila 2).");
  try {
    return await transaccion(ctx, async (tx) => {
      await exigirOwner(tx, ctx);
      const antes = await tx.ubicacion.findUnique({ where: { id } });
      if (!antes) throw new NotFoundError("La ubicación no existe");
      const u = await tx.ubicacion.update({
        where: { id },
        data: { nombre, descripcion: limpiar(input.descripcion) },
      });
      await registrarAuditoria(tx, {
        usuarioId: ctx.usuarioId,
        accion: AccionAuditoria.UPDATE,
        entidad: "Ubicacion",
        entidadId: id,
        datosAntes: { nombre: antes.nombre, descripcion: antes.descripcion },
        datosDespues: { nombre: u.nombre, descripcion: u.descripcion },
        meta: ctx.meta,
      });
      return { id };
    });
  } catch (e) {
    conflictoNombre(e);
    throw e;
  }
}

/** Borra el lugar: sus modelos quedan sin ubicación. */
export async function eliminarUbicacion(ctx: Ctx, id: string): Promise<{ productos: number }> {
  return transaccion(ctx, async (tx) => {
    await exigirOwner(tx, ctx);
    const u = await tx.ubicacion.findUnique({
      where: { id },
      select: { nombre: true, _count: { select: { productos: true } } },
    });
    if (!u) throw new NotFoundError("La ubicación no existe");
    await tx.ubicacion.delete({ where: { id } });
    await registrarAuditoria(tx, {
      usuarioId: ctx.usuarioId,
      accion: AccionAuditoria.DELETE,
      entidad: "Ubicacion",
      entidadId: id,
      datosAntes: { nombre: u.nombre, productos: u._count.productos },
      meta: ctx.meta,
    });
    return { productos: u._count.productos };
  });
}

/** Mueve una ubicación un lugar para arriba o para abajo en la lista. */
export async function moverUbicacion(ctx: Ctx, id: string, direccion: -1 | 1): Promise<void> {
  await transaccion(ctx, async (tx) => {
    await exigirOwner(tx, ctx);
    const todas = await tx.ubicacion.findMany({
      orderBy: [{ orden: "asc" }, { nombre: "asc" }],
      select: { id: true },
    });
    const i = todas.findIndex((u) => u.id === id);
    if (i < 0) throw new NotFoundError("La ubicación no existe");
    const j = i + direccion;
    if (j < 0 || j >= todas.length) return;
    [todas[i], todas[j]] = [todas[j]!, todas[i]!];
    for (const [n, u] of todas.entries())
      await tx.ubicacion.update({ where: { id: u.id }, data: { orden: n + 1 } });
  });
}

/** Asigna modelos a un lugar (null = sin ubicación). */
export async function asignarUbicacion(
  ctx: Ctx,
  productoIds: string[],
  ubicacionId: string | null,
): Promise<{ productos: number }> {
  if (productoIds.length === 0) return { productos: 0 };
  return transaccion(ctx, async (tx) => {
    await exigirOwner(tx, ctx);
    if (ubicacionId) {
      const u = await tx.ubicacion.findUnique({ where: { id: ubicacionId }, select: { id: true } });
      if (!u) throw new NotFoundError("La ubicación no existe");
    }
    const r = await tx.producto.updateMany({
      where: { id: { in: productoIds }, deletedAt: null },
      data: { ubicacionId },
    });
    if (r.count !== new Set(productoIds).size)
      throw new NotFoundError("Alguno de los productos no existe o fue dado de baja");
    await registrarAuditoria(tx, {
      usuarioId: ctx.usuarioId,
      accion: AccionAuditoria.UPDATE,
      entidad: "Ubicacion",
      entidadId: ubicacionId ?? "sin-ubicacion",
      datosDespues: { ubicacionId, productoIds },
      meta: ctx.meta,
    });
    return { productos: r.count };
  });
}
