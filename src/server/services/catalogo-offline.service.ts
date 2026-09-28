import { Prisma } from "@prisma/client";
import { z } from "zod";

import { normalizarCodigoBarras } from "@/lib/barcode";
import { dbPara, type Ctx } from "@/server/db/panel-scoped";
import { nombreCompleto } from "@/server/services/producto.service";

/**
 * Snapshot liviano del catálogo DE UN PANEL para el escáner sin conexión: variantes
 * activas con sus códigos (principal + alternativos + SKU), precio de venta y
 * stock por depósito. SIN costos. La versión es el último cambio de catálogo o
 * stock del panel: si no cambió, el cliente no vuelve a bajarlo (ETag / 304).
 * Toda la SQL cruda filtra por panelId a mano (no pasa por dbPara).
 */

export interface VarianteOffline {
  varianteId: string;
  productoId: string;
  producto: string;
  variante: string;
  nombreCompleto: string;
  sku: string;
  codigoBarras: string | null;
  /** Normalizados: principal, alternativos y SKU. */
  codigos: string[];
  /** Códigos que son alternativos (para marcar "leído por código alternativo"). */
  alternativos: string[];
  marca: string | null;
  categoria: string;
  imagenUrl: string | null;
  precioVenta: string;
  stockMinimo: number;
  stock: { depositoId: string; deposito: string; esPrincipal: boolean; cantidad: number }[];
  stockTotal: number;
}

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

const filaSchema = z.object({
  id: z.string(),
  producto_id: z.string(),
  producto: z.string(),
  variante: z.string(),
  tiene_variantes: z.boolean(),
  sku: z.string(),
  codigo_barras: z.string().nullable(),
  alternativos: z.array(z.string()),
  marca: z.string().nullable(),
  categoria: z.string(),
  imagen_url: z.string().nullable(),
  precio_venta: z.custom<Prisma.Decimal>(
    (v) => Prisma.Decimal.isDecimal(v) || typeof v === "string",
  ),
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
      SELECT va."id", p."id" AS producto_id, p."nombre" AS producto, va."nombre" AS variante,
             p."tieneVariantes" AS tiene_variantes, va."sku", va."codigoBarras" AS codigo_barras,
             COALESCE((SELECT array_agg(a."codigo") FROM "CodigoBarrasAlternativo" a WHERE a."varianteId" = va."id"), '{}') AS alternativos,
             m."nombre" AS marca, c."nombre" AS categoria, p."imagenUrl" AS imagen_url,
             va."precioVenta" AS precio_venta, va."stockMinimo" AS stock_minimo,
             COALESCE((SELECT jsonb_object_agg(s."depositoId", s."cantidad") FROM "Stock" s WHERE s."varianteId" = va."id"), '{}') AS stock
      FROM "Variante" va
      JOIN "Producto" p ON p."id" = va."productoId"
      JOIN "Categoria" c ON c."id" = p."categoriaId"
      LEFT JOIN "Marca" m ON m."id" = p."marcaId"
      WHERE va."panelId" = ${ctx.panelId}
        AND va."deletedAt" IS NULL AND va."activo" AND p."deletedAt" IS NULL AND p."activo"
      ORDER BY p."nombre", va."nombre"`,
  ]);
  const filas = z.array(filaSchema).parse(crudo);
  return {
    panelId: ctx.panelId,
    version,
    generadoEn: new Date().toISOString(),
    depositos,
    variantes: filas.map((f) => {
      const stock = depositos.map((d) => ({
        depositoId: d.id,
        deposito: d.nombre,
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
      return {
        varianteId: f.id,
        productoId: f.producto_id,
        producto: f.producto,
        variante: f.variante,
        nombreCompleto: nombreCompleto(f.producto, f.variante, f.tiene_variantes),
        sku: f.sku,
        codigoBarras: f.codigo_barras,
        codigos,
        alternativos,
        marca: f.marca,
        categoria: f.categoria,
        imagenUrl: f.imagen_url,
        precioVenta: new Prisma.Decimal(f.precio_venta).toFixed(2),
        stockMinimo: f.stock_minimo,
        stock,
        stockTotal: stock.reduce((a, s) => a + s.cantidad, 0),
      };
    }),
  };
}
