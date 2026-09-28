import { AccionAuditoria, Prisma } from "@prisma/client";

import type {
  ActualizarCategoria,
  ActualizarMarca,
  CrearCategoria,
  CrearMarca,
} from "@/lib/validations/clasificacion";
import { ConflictError, DomainError, NotFoundError } from "@/server/errors";
import { dbPara, transaccion, type Ctx, type Tx } from "@/server/db/panel-scoped";
import { registrarAuditoria } from "@/server/services/audit.service";

/**
 * Categorías y marcas: mismo comportamiento (CRUD + activo), por eso comparten
 * implementación. `categoria.service` y `marca.service` exponen la API de cada una.
 * Son POR PANEL: el nombre es único dentro del panel.
 */

export type TipoClasificacion = "Categoria" | "Marca";

export interface ClasificacionListada {
  id: string;
  nombre: string;
  descripcion: string | null;
  activo: boolean;
  productosActivos: number;
}

export interface ClasificacionBasica {
  id: string;
  nombre: string;
}

const ETIQUETA: Record<TipoClasificacion, string> = { Categoria: "categoría", Marca: "marca" };

function delegado(tx: Tx, tipo: TipoClasificacion) {
  // Ambos modelos tienen la misma forma para lo que usamos acá (id, nombre, activo).
  return (tipo === "Categoria" ? tx.categoria : tx.marca) as unknown as Prisma.CategoriaDelegate;
}

function filtroProductos(tipo: TipoClasificacion, id: string): Prisma.ProductoWhereInput {
  return {
    ...(tipo === "Categoria" ? { categoriaId: id } : { marcaId: id }),
    activo: true,
    deletedAt: null,
  };
}

export async function listarClasificaciones(
  ctx: Pick<Ctx, "panelId">,
  tipo: TipoClasificacion,
): Promise<ClasificacionListada[]> {
  const db = dbPara(ctx.panelId);
  const filas = await delegado(db, tipo).findMany({
    orderBy: [{ activo: "desc" }, { nombre: "asc" }],
  });
  const conteos = await db.producto.groupBy({
    by: [tipo === "Categoria" ? "categoriaId" : "marcaId"],
    where: { activo: true, deletedAt: null },
    _count: true,
  });
  const porId = new Map(
    conteos.map((c) => [(tipo === "Categoria" ? c.categoriaId : c.marcaId) as string, c._count]),
  );
  return filas.map((f) => ({
    id: f.id,
    nombre: f.nombre,
    descripcion: "descripcion" in f ? (f.descripcion ?? null) : null,
    activo: f.activo,
    productosActivos: porId.get(f.id) ?? 0,
  }));
}

export async function listarClasificacionesActivas(
  ctx: Pick<Ctx, "panelId">,
  tipo: TipoClasificacion,
): Promise<ClasificacionBasica[]> {
  return delegado(dbPara(ctx.panelId), tipo).findMany({
    where: { activo: true },
    select: { id: true, nombre: true },
    orderBy: { nombre: "asc" },
  });
}

function conflicto(tipo: TipoClasificacion, error: unknown): void {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    const msg = `Ya existe una ${ETIQUETA[tipo]} con ese nombre`;
    throw new ConflictError(msg, { nombre: [msg] });
  }
}

async function assertPuedeDesactivar(tx: Tx, tipo: TipoClasificacion, id: string, nombre: string) {
  const activos = await tx.producto.count({ where: filtroProductos(tipo, id) });
  if (activos > 0) {
    throw new DomainError(
      `"${nombre}" tiene ${activos} producto${activos === 1 ? "" : "s"} activo${activos === 1 ? "" : "s"}: no se puede desactivar.`,
    );
  }
}

export async function crearClasificacion(
  ctx: Ctx,
  tipo: TipoClasificacion,
  input: CrearCategoria | CrearMarca,
): Promise<{ id: string }> {
  try {
    return await transaccion(ctx, async (tx) => {
      const data =
        tipo === "Categoria"
          ? {
              nombre: input.nombre,
              activo: input.activo,
              descripcion: (input as CrearCategoria).descripcion ?? null,
            }
          : { nombre: input.nombre, activo: input.activo };
      const fila = await delegado(tx, tipo).create({ data });
      await registrarAuditoria(tx, {
        usuarioId: ctx.usuarioId,
        accion: AccionAuditoria.CREATE,
        entidad: tipo,
        entidadId: fila.id,
        datosDespues: data,
        meta: ctx.meta,
      });
      return { id: fila.id };
    });
  } catch (error) {
    conflicto(tipo, error);
    throw error;
  }
}

export async function actualizarClasificacion(
  ctx: Ctx,
  tipo: TipoClasificacion,
  input: ActualizarCategoria | ActualizarMarca,
): Promise<{ id: string }> {
  try {
    return await transaccion(ctx, async (tx) => {
      const antes = await delegado(tx, tipo).findUnique({ where: { id: input.id } });
      if (!antes) throw new NotFoundError(`La ${ETIQUETA[tipo]} no existe`);
      if (antes.activo && !input.activo)
        await assertPuedeDesactivar(tx, tipo, antes.id, antes.nombre);
      const data =
        tipo === "Categoria"
          ? {
              nombre: input.nombre,
              activo: input.activo,
              descripcion: (input as ActualizarCategoria).descripcion ?? null,
            }
          : { nombre: input.nombre, activo: input.activo };
      await delegado(tx, tipo).update({ where: { id: input.id }, data });
      await registrarAuditoria(tx, {
        usuarioId: ctx.usuarioId,
        accion: AccionAuditoria.UPDATE,
        entidad: tipo,
        entidadId: input.id,
        datosAntes: { nombre: antes.nombre, activo: antes.activo },
        datosDespues: data,
        meta: ctx.meta,
      });
      return { id: input.id };
    });
  } catch (error) {
    conflicto(tipo, error);
    throw error;
  }
}

export async function cambiarActivoClasificacion(
  ctx: Ctx,
  tipo: TipoClasificacion,
  id: string,
  activo: boolean,
): Promise<void> {
  await transaccion(ctx, async (tx) => {
    const antes = await delegado(tx, tipo).findUnique({ where: { id } });
    if (!antes) throw new NotFoundError(`La ${ETIQUETA[tipo]} no existe`);
    if (antes.activo === activo) return;
    if (!activo) await assertPuedeDesactivar(tx, tipo, id, antes.nombre);
    await delegado(tx, tipo).update({ where: { id }, data: { activo } });
    await registrarAuditoria(tx, {
      usuarioId: ctx.usuarioId,
      accion: AccionAuditoria.UPDATE,
      entidad: tipo,
      entidadId: id,
      datosAntes: { activo: antes.activo },
      datosDespues: { activo },
      meta: ctx.meta,
    });
  });
}
