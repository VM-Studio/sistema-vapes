import { AccionAuditoria, Prisma } from "@prisma/client";

import { prisma, withTransaction, type Tx } from "@/lib/db";
import type {
  ActualizarCategoria,
  ActualizarMarca,
  CrearCategoria,
  CrearMarca,
} from "@/lib/validations/clasificacion";
import { ConflictError, DomainError, NotFoundError } from "@/server/errors";
import type { Actor } from "@/server/services/actor";
import { registrarAuditoria } from "@/server/services/audit.service";

/**
 * Categorías y marcas: mismo comportamiento (CRUD + activo), por eso comparten
 * implementación. `categoria.service` y `marca.service` exponen la API de cada una.
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
  tipo: TipoClasificacion,
): Promise<ClasificacionListada[]> {
  const filas = await delegado(prisma, tipo).findMany({
    orderBy: [{ activo: "desc" }, { nombre: "asc" }],
  });
  const conteos = await prisma.producto.groupBy({
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
  tipo: TipoClasificacion,
): Promise<ClasificacionBasica[]> {
  return delegado(prisma, tipo).findMany({
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
  tipo: TipoClasificacion,
  input: CrearCategoria | CrearMarca,
  actor: Actor,
): Promise<{ id: string }> {
  try {
    return await withTransaction(async (tx) => {
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
        usuarioId: actor.id,
        accion: AccionAuditoria.CREATE,
        entidad: tipo,
        entidadId: fila.id,
        datosDespues: data,
        meta: actor.meta,
      });
      return { id: fila.id };
    });
  } catch (error) {
    conflicto(tipo, error);
    throw error;
  }
}

export async function actualizarClasificacion(
  tipo: TipoClasificacion,
  input: ActualizarCategoria | ActualizarMarca,
  actor: Actor,
): Promise<{ id: string }> {
  try {
    return await withTransaction(async (tx) => {
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
        usuarioId: actor.id,
        accion: AccionAuditoria.UPDATE,
        entidad: tipo,
        entidadId: input.id,
        datosAntes: { nombre: antes.nombre, activo: antes.activo },
        datosDespues: data,
        meta: actor.meta,
      });
      return { id: input.id };
    });
  } catch (error) {
    conflicto(tipo, error);
    throw error;
  }
}

export async function cambiarActivoClasificacion(
  tipo: TipoClasificacion,
  id: string,
  activo: boolean,
  actor: Actor,
): Promise<void> {
  await withTransaction(async (tx) => {
    const antes = await delegado(tx, tipo).findUnique({ where: { id } });
    if (!antes) throw new NotFoundError(`La ${ETIQUETA[tipo]} no existe`);
    if (antes.activo === activo) return;
    if (!activo) await assertPuedeDesactivar(tx, tipo, id, antes.nombre);
    await delegado(tx, tipo).update({ where: { id }, data: { activo } });
    await registrarAuditoria(tx, {
      usuarioId: actor.id,
      accion: AccionAuditoria.UPDATE,
      entidad: tipo,
      entidadId: id,
      datosAntes: { activo: antes.activo },
      datosDespues: { activo },
      meta: actor.meta,
    });
  });
}

/** Busca por nombre sin distinguir mayúsculas; si no existe, la crea (importación CSV). */
export async function obtenerOCrearClasificacion(
  tx: Tx,
  tipo: TipoClasificacion,
  nombre: string,
): Promise<string> {
  const existente = await delegado(tx, tipo).findFirst({
    where: { nombre: { equals: nombre, mode: "insensitive" } },
    select: { id: true },
  });
  if (existente) return existente.id;
  const creada = await delegado(tx, tipo).create({ data: { nombre, activo: true } });
  return creada.id;
}
