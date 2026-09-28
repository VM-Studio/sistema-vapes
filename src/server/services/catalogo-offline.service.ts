import { Prisma } from "@prisma/client";
import { z } from "zod";

import type { VarianteEncontrada } from "@/features/scanner/tipos";
import { normalizarCodigoBarras } from "@/lib/barcode";
import { precioVentaEfectivo } from "@/lib/precios";
import { nombreConSabor, saborVisible } from "@/lib/validations/producto";
import { dbPara, type Ctx } from "@/server/db/panel-scoped";

/**
 * Snapshot liviano del catálogo DE UN PANEL para el escáner sin conexión: sabores
 * activos con sus códigos (principal + alternativos + SKU), precio de venta
 * efectivo y stock por depósito. SIN costos. La versión es el último cambio de catálogo o
 * stock del panel: si no cambió, el cliente no vuelve a bajarlo (ETag / 304).
 * Toda la SQL cruda filtra por panelId a mano (no pasa por dbPara).
 */

export type VarianteOffline = Omit<
  VarianteEncontrada,
  "ultimoCosto" | "porCodigoAlternativo" | "stockEnDeposito"
> & {
  /** Normalizados: principal, alternativos y SKU. */
  codigos: string[];
  /** Códigos que son alternativos (para marcar "leído por código alternativo"). */
  alternativos: string[];
};

export interface CatalogoOffline {
  panelId: string;
  version: string;
  generadoEn: string;
  depositos: { id: string; nombre: string; esPrincipal: boolean }[];
  variantes: VarianteOffline[];
}

export async function versionCatalogo(ctx: Pick<Ctx, "panelId">): Promise<string> {
  const p = ctx.panelId;
  const [r] = await dbPara(p).$queryRaw<{ v: Date | null; n: bigint }[]>`
    SELECT GREATEST(
      (SELECT MAX("updatedAt") FROM "Variante" WHERE "panelId" = ${p}),
      (SELECT MAX("updatedAt") FROM "Producto" WHERE "panelId" = ${p}),
      (SELECT MAX("updatedAt") FROM "Stock" WHERE "panelId" = ${p}),
      (SELECT MAX("updatedAt") FROM "Deposito" WHERE "panelId" = ${p}),
      (SELECT MAX("createdAt") FROM "CodigoBarrasAlternativo" WHERE "panelId" = ${p})
    ) AS v,
    (SELECT COUNT(*) FROM "CodigoBarrasAlternativo" WHERE "panelId" = ${p})
      + (SELECT COUNT(*) FROM "Variante" WHERE "panelId" = ${p} AND "deletedAt" IS NULL) AS n`;
  return `${r?.v?.getTime() ?? 0}-${r?.n ?? 0}`;
}

const decimal = z.custom<Prisma.Decimal>(
  (v) => Prisma.Decimal.isDecimal(v) || typeof v === "string",
);

const filaSchema = z.object({
  id: z.string(),
  producto_id: z.string(),
  nombre_completo: z.string(),
  variante: z.string(),
  marca: z.string(),
  marca_id: z.string(),
  modelo: z.string(),
  especificacion: z.string(),
  sku: z.string(),
  codigo_barras: z.string().nullable(),
  alternativos: z.array(z.string()),
  categoria: z.string().nullable(),
  imagen_url: z.string().nullable(),
  precio_producto: decimal,
  precio_variante: decimal.nullable(),
  stock_minimo: z.number(),
  stock: z.record(z.string(), z.number()),
});

export async function generarCatalogoOffline(ctx: Pick<Ctx, "panelId">): Promise<CatalogoOffline> {
  const db = dbPara(ctx.panelId);
  const [version, depositos, crudo] = await Promise.all([
    versionCatalogo(ctx),
    db.deposito.findMany({
      where: { activo: true },
      orderBy: [{ esPrincipal: "desc" }, { nombre: "asc" }],
      select: { id: true, nombre: true, esPrincipal: true },
    }),
    db.$queryRaw`
      SELECT va."id", p."id" AS producto_id, p."nombreCompleto" AS nombre_completo,
             va."nombre" AS variante, m."nombre" AS marca, m."id" AS marca_id,
             p."nombre" AS modelo, p."especificacion", va."sku", va."codigoBarras" AS codigo_barras,
             COALESCE((SELECT array_agg(a."codigo") FROM "CodigoBarrasAlternativo" a WHERE a."varianteId" = va."id"), '{}') AS alternativos,
             c."nombre" AS categoria, p."imagenUrl" AS imagen_url,
             p."precioVenta" AS precio_producto, va."precioVenta" AS precio_variante,
             va."stockMinimo" AS stock_minimo,
             COALESCE((SELECT jsonb_object_agg(s."depositoId", s."cantidad") FROM "Stock" s WHERE s."varianteId" = va."id"), '{}') AS stock
      FROM "Variante" va
      JOIN "Producto" p ON p."id" = va."productoId"
      JOIN "Marca" m ON m."id" = p."marcaId"
      LEFT JOIN "Categoria" c ON c."id" = p."categoriaId"
      WHERE va."panelId" = ${ctx.panelId}
        AND va."deletedAt" IS NULL AND va."activo" AND p."deletedAt" IS NULL AND p."activo"
      ORDER BY p."nombreCompleto", va."nombre"`,
  ]);
  const filas = z.array(filaSchema).parse(crudo);
  return {
    panelId: ctx.panelId,
    version,
    generadoEn: new Date().toISOString(),
    depositos,
    variantes: filas.map((f) => {
      const stockPorDeposito = depositos.map((d) => ({
        depositoId: d.id,
        nombre: d.nombre,
        esPrincipal: d.esPrincipal,
        cantidad: f.stock[d.id] ?? 0,
      }));
      const alternativos = f.alternativos.map(normalizarCodigoBarras);
      const codigos = [
        ...new Set([
          ...(f.codigo_barras ? [normalizarCodigoBarras(f.codigo_barras)] : []),
          ...alternativos,
          normalizarCodigoBarras(f.sku),
        ]),
      ];
      const precio = (d: Prisma.Decimal | string | null) =>
        d === null ? null : new Prisma.Decimal(d).toFixed(2);
      return {
        varianteId: f.id,
        productoId: f.producto_id,
        nombreCompleto: f.nombre_completo,
        sabor: saborVisible(f.variante),
        titulo: nombreConSabor(f.nombre_completo, f.variante),
        marca: f.marca,
        marcaId: f.marca_id,
        modelo: f.modelo,
        especificacion: f.especificacion,
        categoria: f.categoria,
        imagenUrl: f.imagen_url,
        sku: f.sku,
        codigoBarras: f.codigo_barras,
        codigos,
        alternativos,
        precioVenta: precioVentaEfectivo(
          { precioVenta: precio(f.precio_variante) },
          { precioVenta: precio(f.precio_producto) },
        ),
        precioVentaProducto: precio(f.precio_producto) ?? "0.00",
        tienePrecioPropio: f.precio_variante !== null,
        stockMinimo: f.stock_minimo,
        stockPorDeposito,
        stockTotal: stockPorDeposito.reduce((a, s) => a + s.cantidad, 0),
        activo: true,
      };
    }),
  };
}
