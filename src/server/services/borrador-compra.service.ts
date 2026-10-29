import { datosBorradorSchema, type DatosBorradorCompra } from "@/lib/validations/compra";
import { dbPara, transaccion, type Ctx } from "@/server/db/panel-scoped";
import { NotFoundError } from "@/server/errors";

/**
 * BORRADORES DE «NUEVA COMPRA» (por panel). Mientras se arma una compra, el
 * formulario guarda solo lo tipeado (proveedor, galpón, ítems, notas,
 * comisión) para retomarla después aunque se salga de la pantalla. No valida
 * la compra (puede estar a medias) ni mueve stock ni costos: eso pasa al
 * confirmarla, y ahí el borrador se borra. Los ve todo el que puede crear
 * compras en el panel (cada uno con quién lo empezó).
 */

export interface BorradorCompraListado {
  id: string;
  proveedor: string | null;
  items: number;
  unidades: number;
  usuario: string;
  createdAt: Date;
  updatedAt: Date;
}

const unidadesDe = (d: DatosBorradorCompra) =>
  d.items.reduce((a, i) => a + (Number.parseInt(i.cantidad, 10) || 0), 0);

/**
 * Crea (sin `id`) o pisa el borrador. Un proveedor que no es del panel (o
 * ya no existe) se descarta. Si el `id` ya no existe (lo descartaron desde
 * otra pantalla), crea uno nuevo: lo tipeado no se pierde.
 */
export async function guardarBorradorCompra(
  ctx: Ctx,
  input: { id?: string; datos: DatosBorradorCompra },
): Promise<{ id: string; updatedAt: Date }> {
  const datos = datosBorradorSchema.parse(input.datos);
  return transaccion(ctx, async (tx) => {
    const proveedor = datos.proveedorId
      ? await tx.proveedor.findFirst({
          where: { id: datos.proveedorId, deletedAt: null },
          select: { id: true },
        })
      : null;
    const valores = {
      proveedorId: proveedor?.id ?? null,
      datos: { ...datos, proveedorId: proveedor?.id ?? "" },
      items: datos.items.length,
      unidades: unidadesDe(datos),
    };
    const existente = input.id
      ? await tx.borradorCompra.findUnique({ where: { id: input.id }, select: { id: true } })
      : null;
    const b = existente
      ? await tx.borradorCompra.update({
          where: { id: existente.id },
          data: valores,
          select: { id: true, updatedAt: true },
        })
      : await tx.borradorCompra.create({
          data: { ...valores, usuarioId: ctx.usuarioId },
          select: { id: true, updatedAt: true },
        });
    return b;
  });
}

export async function obtenerBorradorCompra(
  ctx: Ctx,
  id: string,
): Promise<{ id: string; datos: DatosBorradorCompra; updatedAt: Date }> {
  const b = await dbPara(ctx.panelId).borradorCompra.findUnique({
    where: { id },
    select: { id: true, datos: true, updatedAt: true },
  });
  if (!b) throw new NotFoundError("El borrador ya no existe (se confirmó o se descartó).");
  const r = datosBorradorSchema.safeParse(b.datos);
  return {
    id: b.id,
    datos: r.success ? r.data : datosBorradorSchema.parse({}),
    updatedAt: b.updatedAt,
  };
}

/** Los del panel, el último tocado primero. */
export async function listarBorradoresCompra(ctx: Ctx): Promise<BorradorCompraListado[]> {
  const filas = await dbPara(ctx.panelId).borradorCompra.findMany({
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: {
      id: true,
      items: true,
      unidades: true,
      createdAt: true,
      updatedAt: true,
      proveedor: { select: { nombre: true, nombreTienda: true } },
      usuario: { select: { nombre: true } },
    },
  });
  return filas.map((b) => ({
    id: b.id,
    proveedor: b.proveedor ? `${b.proveedor.nombre} (${b.proveedor.nombreTienda})` : null,
    items: b.items,
    unidades: b.unidades,
    usuario: b.usuario.nombre,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  }));
}

/** Descartar (o borrar al confirmar la compra). Si ya no existe, no hace nada. */
export async function descartarBorradorCompra(ctx: Ctx, id: string): Promise<void> {
  await dbPara(ctx.panelId).borradorCompra.deleteMany({ where: { id } });
}
