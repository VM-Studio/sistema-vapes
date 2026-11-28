import { OrigenCostoVariante, Prisma } from "@prisma/client";

import { esOwner, type SujetoPermisos } from "@/lib/permisos";
import { saborVisible } from "@/lib/ventas-ui";
import { dbPara, type Ctx } from "@/server/db/panel-scoped";
import { ForbiddenError } from "@/server/errors";
import { obtenerCotizacion } from "@/server/services/cambio.service";

/**
 * COSTOS — «¿a cuánto compramos cada cosa?» (solo dueños, por panel).
 *
 * Todos los productos del panel juntos, con el costo por unidad de cada sabor:
 * `Variante.ultimoCostoUsdt`, el costo FINAL de la última compra recibida
 * (precio del proveedor + comisión del pasista + gastos prorrateados) o el que
 * se tipeó al cargar stock. Es el mismo que toma cada venta como snapshot.
 *
 * Los costos son en USDT (moneda principal). Los pesos y dólares que se
 * muestran abajo son una REFERENCIA a la cotización de HOY (no de la compra):
 * sirven para comparar con el precio de venta, que está en pesos.
 */

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const dec = (v: Prisma.Decimal) => v.toFixed(2);

export interface CostoSabor {
  varianteId: string;
  /** null = producto sin sabores ("Único"). */
  sabor: string | null;
  sku: string;
  /** USDT por unidad; null = todavía sin costo cargado. */
  costoUsdt: string | null;
  /** Precio de venta efectivo del sabor (pesos). */
  precioVenta: string;
  /** Cuándo cambió el costo por última vez y por qué. */
  actualizadoAt: Date | null;
  origen: OrigenCostoVariante | null;
  /** Número de la compra de la que salió el costo (si salió de una compra). */
  compraNumero: number | null;
  stock: number;
}

export interface CostoProducto {
  productoId: string;
  titulo: string;
  marca: string;
  modelo: string;
  especificacion: string;
  categoria: string | null;
  /** Min y max del costo de sus sabores con costo (USDT); null si ninguno tiene. */
  costoMin: string | null;
  costoMax: string | null;
  /** Precio de venta del producto (pesos; algún sabor puede tener uno propio). */
  precioVenta: string;
  sabores: CostoSabor[];
  saboresSinCosto: number;
  actualizadoAt: Date | null;
  stock: number;
}

export interface ListadoCostos {
  productos: CostoProducto[];
  /** Cotizaciones de HOY para mostrar la referencia en pesos y dólares (null si no hay). */
  cotizacion: { usdt: string; usd: string } | null;
}

/** Listado completo de costos del panel (solo dueños). */
export async function listarCostos(
  ctx: Ctx & { usuario: Pick<SujetoPermisos, "rol"> },
): Promise<ListadoCostos> {
  if (!esOwner(ctx.usuario)) throw new ForbiddenError("Los costos los ven solo los dueños.");
  const db = dbPara(ctx.panelId);
  const [productos, usdt, usd] = await Promise.all([
    db.producto.findMany({
      where: { deletedAt: null, activo: true },
      orderBy: [{ nombreCompleto: "asc" }],
      select: {
        id: true,
        nombre: true,
        especificacion: true,
        nombreCompleto: true,
        precioVenta: true,
        marca: { select: { nombre: true } },
        categoria: { select: { nombre: true } },
        variantes: {
          where: { deletedAt: null, activo: true },
          orderBy: { nombre: "asc" },
          select: {
            id: true,
            nombre: true,
            sku: true,
            precioVenta: true,
            ultimoCostoUsdt: true,
            stocks: { select: { cantidad: true } },
          },
        },
      },
    }),
    obtenerCotizacion("USDT").catch(() => null),
    obtenerCotizacion("USD_BLUE").catch(() => null),
  ]);

  const ids = productos.flatMap((p) => p.variantes.map((v) => v.id));
  // Último cambio de costo de cada sabor (historial inmutable).
  const ultimos = ids.length
    ? await db.$queryRaw<
        {
          varianteId: string;
          createdAt: Date;
          origen: OrigenCostoVariante;
          compraNumero: number | null;
        }[]
      >`
        SELECT DISTINCT ON (h."varianteId") h."varianteId", h."createdAt", h."origen",
               c."numero" AS "compraNumero"
        FROM "CostoVarianteHistorial" h
        LEFT JOIN "Compra" c ON c."id" = h."compraId"
        WHERE h."panelId" = ${ctx.panelId} AND h."varianteId" IN (${Prisma.join(ids)})
        ORDER BY h."varianteId", h."createdAt" DESC`
    : [];
  const porVariante = new Map(ultimos.map((u) => [u.varianteId, u]));

  const lista: CostoProducto[] = productos
    .filter((p) => p.variantes.length > 0)
    .map((p) => {
      const sabores: CostoSabor[] = p.variantes.map((v) => {
        const u = porVariante.get(v.id);
        return {
          varianteId: v.id,
          sabor: saborVisible(v.nombre),
          sku: v.sku,
          costoUsdt: v.ultimoCostoUsdt === null ? null : dec(v.ultimoCostoUsdt),
          precioVenta: dec(v.precioVenta ?? p.precioVenta),
          actualizadoAt: u?.createdAt ?? null,
          origen: u?.origen ?? null,
          compraNumero: u?.compraNumero ?? null,
          stock: v.stocks.reduce((a, s) => a + s.cantidad, 0),
        };
      });
      const costos = sabores.flatMap((s) => (s.costoUsdt === null ? [] : [D(s.costoUsdt)]));
      const fechas = sabores.flatMap((s) => (s.actualizadoAt ? [s.actualizadoAt.getTime()] : []));
      return {
        productoId: p.id,
        titulo: p.nombreCompleto,
        marca: p.marca.nombre,
        modelo: p.nombre,
        especificacion: p.especificacion,
        categoria: p.categoria?.nombre ?? null,
        costoMin: costos.length ? dec(Prisma.Decimal.min(...costos)) : null,
        costoMax: costos.length ? dec(Prisma.Decimal.max(...costos)) : null,
        precioVenta: dec(p.precioVenta),
        sabores,
        saboresSinCosto: sabores.length - costos.length,
        actualizadoAt: fechas.length ? new Date(Math.max(...fechas)) : null,
        stock: sabores.reduce((a, s) => a + s.stock, 0),
      };
    });

  return {
    productos: lista,
    cotizacion: usdt && usd ? { usdt: usdt.valor.toFixed(2), usd: usd.valor.toFixed(2) } : null,
  };
}
