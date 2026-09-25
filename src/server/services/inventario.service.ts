import { Prisma } from "@prisma/client";
import { z } from "zod";

import { normalizarCodigoBarras } from "@/lib/barcode";
import { aCSV, formatearDecimalAR } from "@/lib/csv";
import { prisma } from "@/lib/db";
import { listarDepositosActivos, type DepositoBasico } from "@/server/services/deposito.service";
import { estadoStock, nombreCompleto, type EstadoStock } from "@/server/services/producto.service";

/**
 * INVENTARIO: lectura del stock consolidado (vista vw_stock_consolidado).
 * Solo lectura: toda escritura de stock pasa por el motor (stock.service).
 */

// =============================================================================
// Filtros y tipos
// =============================================================================

export const ORDENES_INVENTARIO = [
  "producto",
  "variante",
  "sku",
  "total",
  "minimo",
  "estado",
] as const;

export const filtrosInventarioSchema = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  categoriaId: z.string().min(1).optional().catch(undefined),
  marcaId: z.string().min(1).optional().catch(undefined),
  depositoId: z.string().min(1).optional().catch(undefined),
  soloConStock: z.preprocess((v) => v === true || v === "1", z.boolean()).catch(false),
  soloBajoMinimo: z.preprocess((v) => v === true || v === "1", z.boolean()).catch(false),
  soloSinStock: z.preprocess((v) => v === true || v === "1", z.boolean()).catch(false),
  /** "campo" o "-campo" (desc). Campo: ORDENES_INVENTARIO o "dep:<depositoId>". */
  orden: z.string().max(60).catch("producto"),
  agruparPorProducto: z.preprocess((v) => v === true || v === "producto", z.boolean()).catch(false),
  page: z.coerce.number().int().min(1).catch(1),
  pageSize: z.coerce.number().int().min(10).max(200).catch(50),
});

export type FiltrosInventario = z.output<typeof filtrosInventarioSchema>;

export interface FilaInventario {
  varianteId: string;
  productoId: string;
  producto: string;
  variante: string;
  nombreCompleto: string;
  tieneVariantes: boolean;
  sku: string;
  codigoBarras: string | null;
  marca: string | null;
  categoria: string;
  stockMinimo: number;
  /** Cantidad por depositoId (solo depósitos activos; 0 si no hay stock). */
  porDeposito: Record<string, number>;
  total: number;
  estado: EstadoStock;
  /** Solo si se pidió valorización (OWNER). */
  valorizacion?: {
    precioCosto: string;
    precioVenta: string;
    valorCosto: string;
    valorVenta: string;
  };
}

export interface ResultadoInventario {
  depositos: DepositoBasico[];
  filas: FilaInventario[];
  /** Filas (o productos, si se agrupa) que cumplen el filtro, para paginar. */
  total: number;
  page: number;
  pageSize: number;
}

// Lo que devuelve la query (validado con Zod: $queryRaw no tipa nada).
const decimalSchema = z.custom<Prisma.Decimal>(
  (v) => Prisma.Decimal.isDecimal(v) || typeof v === "string" || typeof v === "number",
);
const filaSqlSchema = z.object({
  variante_id: z.string(),
  producto_id: z.string(),
  producto: z.string(),
  variante: z.string(),
  sku: z.string(),
  codigo_barras: z.string().nullable(),
  stock_minimo: z.number().int(),
  total: z.number().int(),
  por_deposito: z.record(z.string(), z.number().int()),
  precio_costo: decimalSchema,
  precio_venta: decimalSchema,
  tiene_variantes: z.boolean(),
  marca: z.string().nullable(),
  categoria: z.string(),
  total_resultados: z.union([z.bigint(), z.number()]).transform(Number),
});
const filasSqlSchema = z.array(filaSqlSchema);
type FilaSql = z.output<typeof filaSqlSchema>;

// =============================================================================
// Query
// =============================================================================

function pareceCodigo(q: string): boolean {
  return /^[0-9A-Za-z-]{4,64}$/.test(q) && /\d/.test(q);
}

function construirWhere(f: FiltrosInventario): Prisma.Sql {
  const condiciones: Prisma.Sql[] = [
    // Variantes vivas activas, más las inactivas que todavía tienen stock (no se "pierde" mercadería de vista).
    Prisma.sql`((v."activo" AND p."activo") OR s.total > 0)`,
  ];
  if (f.q) {
    const q = f.q.trim();
    const texto = q
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 5)
      .map((w) => {
        const patron = `%${w.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
        return Prisma.sql`(p."nombre" ILIKE ${patron} OR v."nombre" ILIKE ${patron} OR v."sku" ILIKE ${patron})`;
      });
    const porTexto = Prisma.join(texto, " AND ");
    if (pareceCodigo(q)) {
      const c = normalizarCodigoBarras(q);
      condiciones.push(
        Prisma.sql`(v."codigoBarras" = ${c}
          OR EXISTS (SELECT 1 FROM "CodigoBarrasAlternativo" a WHERE a."varianteId" = v."id" AND a."codigo" = ${c})
          OR (${porTexto}))`,
      );
    } else {
      condiciones.push(Prisma.sql`(${porTexto})`);
    }
  }
  if (f.categoriaId) condiciones.push(Prisma.sql`p."categoriaId" = ${f.categoriaId}`);
  if (f.marcaId) condiciones.push(Prisma.sql`p."marcaId" = ${f.marcaId}`);
  if (f.depositoId)
    condiciones.push(Prisma.sql`COALESCE((s.por_deposito ->> ${f.depositoId})::int, 0) > 0`);
  if (f.soloConStock) condiciones.push(Prisma.sql`s.total > 0`);
  if (f.soloSinStock) condiciones.push(Prisma.sql`s.total = 0`);
  if (f.soloBajoMinimo) condiciones.push(Prisma.sql`s.total < s.stock_minimo`);
  return Prisma.join(condiciones, " AND ");
}

function construirOrden(orden: string, depositos: DepositoBasico[]): Prisma.Sql {
  const desc = orden.startsWith("-");
  const campo = desc ? orden.slice(1) : orden;
  const dir = Prisma.raw(desc ? "DESC" : "ASC");
  let expr: Prisma.Sql;
  if (campo.startsWith("dep:") && depositos.some((d) => d.id === campo.slice(4))) {
    expr = Prisma.sql`COALESCE((s.por_deposito ->> ${campo.slice(4)})::int, 0)`;
  } else {
    const columnas: Record<string, string> = {
      producto: `lower(s.producto)`,
      variante: `lower(s.variante)`,
      sku: `s.sku`,
      total: `s.total`,
      minimo: `s.stock_minimo`,
      // SIN_STOCK (0) < BAJO (1) < OK (2)
      estado: `CASE WHEN s.total <= 0 THEN 0 WHEN s.total < s.stock_minimo THEN 1 ELSE 2 END`,
    };
    expr = Prisma.raw(columnas[campo] ?? columnas.producto!);
  }
  return Prisma.sql`${expr} ${dir}, lower(s.producto) ASC, lower(s.variante) ASC`;
}

const SELECT_FILAS = Prisma.sql`
  s.variante_id, s.producto_id, s.producto, s.variante, s.sku, s.codigo_barras,
  s.stock_minimo, s.total, s.por_deposito,
  v."precioCosto" AS precio_costo, v."precioVenta" AS precio_venta,
  p."tieneVariantes" AS tiene_variantes,
  m."nombre" AS marca, c."nombre" AS categoria`;

const FROM_FILAS = Prisma.sql`
  FROM vw_stock_consolidado s
  JOIN "Variante" v ON v."id" = s.variante_id
  JOIN "Producto" p ON p."id" = s.producto_id
  JOIN "Categoria" c ON c."id" = p."categoriaId"
  LEFT JOIN "Marca" m ON m."id" = p."marcaId"`;

async function consultar(
  f: FiltrosInventario,
  depositos: DepositoBasico[],
  paginar: boolean,
): Promise<FilaSql[]> {
  const where = construirWhere(f);
  const orden = construirOrden(f.orden, depositos);
  const offset = (f.page - 1) * f.pageSize;

  let crudo: unknown;
  if (f.agruparPorProducto) {
    // Pagina por PRODUCTO (con todos sus sabores), no por fila.
    crudo = await prisma.$queryRaw`
      WITH filas AS (SELECT ${SELECT_FILAS} ${FROM_FILAS} WHERE ${where}),
      productos AS (
        SELECT producto_id, MIN(lower(producto)) AS clave FROM filas GROUP BY producto_id
      ),
      pagina AS (
        SELECT producto_id, clave FROM productos ORDER BY clave, producto_id
        ${paginar ? Prisma.sql`LIMIT ${f.pageSize} OFFSET ${offset}` : Prisma.empty}
      )
      SELECT filas.*, (SELECT COUNT(*) FROM productos) AS total_resultados
      FROM filas JOIN pagina USING (producto_id)
      ORDER BY pagina.clave, filas.producto_id, lower(filas.variante)`;
  } else {
    crudo = await prisma.$queryRaw`
      SELECT ${SELECT_FILAS}, COUNT(*) OVER () AS total_resultados
      ${FROM_FILAS}
      WHERE ${where}
      ORDER BY ${orden}
      ${paginar ? Prisma.sql`LIMIT ${f.pageSize} OFFSET ${offset}` : Prisma.empty}`;
  }
  return filasSqlSchema.parse(crudo);
}

function aFila(
  r: FilaSql,
  depositos: DepositoBasico[],
  incluirValorizacion: boolean,
): FilaInventario {
  const porDeposito: Record<string, number> = {};
  for (const d of depositos) porDeposito[d.id] = r.por_deposito[d.id] ?? 0;
  const fila: FilaInventario = {
    varianteId: r.variante_id,
    productoId: r.producto_id,
    producto: r.producto,
    variante: r.variante,
    nombreCompleto: nombreCompleto(r.producto, r.variante, r.tiene_variantes),
    tieneVariantes: r.tiene_variantes,
    sku: r.sku,
    codigoBarras: r.codigo_barras,
    marca: r.marca,
    categoria: r.categoria,
    stockMinimo: r.stock_minimo,
    porDeposito,
    total: r.total,
    estado: estadoStock(r.total, r.stock_minimo),
  };
  if (incluirValorizacion) {
    const costo = new Prisma.Decimal(r.precio_costo);
    const venta = new Prisma.Decimal(r.precio_venta);
    fila.valorizacion = {
      precioCosto: costo.toFixed(2),
      precioVenta: venta.toFixed(2),
      valorCosto: costo.mul(r.total).toFixed(2),
      valorVenta: venta.mul(r.total).toFixed(2),
    };
  }
  return fila;
}

/**
 * Stock consolidado paginado: una fila por variante con cantidad por depósito
 * (columnas dinámicas según depósitos activos), total, mínimo, estado y
 * —solo si `incluirValorizacion`— valorización a costo y a venta.
 */
export async function obtenerStockConsolidado(
  filtros: FiltrosInventario,
  opciones: { incluirValorizacion: boolean },
): Promise<ResultadoInventario> {
  const depositos = await listarDepositosActivos();
  const filas = await consultar(filtros, depositos, true);
  return {
    depositos,
    filas: filas.map((r) => aFila(r, depositos, opciones.incluirValorizacion)),
    total: filas[0]?.total_resultados ?? 0,
    page: filtros.page,
    pageSize: filtros.pageSize,
  };
}

// =============================================================================
// Resumen, alertas, matriz por producto
// =============================================================================

export interface ResumenInventario {
  unidadesTotales: number;
  porDeposito: { id: string; nombre: string; esPrincipal: boolean; unidades: number }[];
  variantesBajoMinimo: number;
  variantesSinStock: number;
  valorizacion?: { valorCosto: string; valorVenta: string };
}

export async function obtenerResumenInventario(opciones: {
  incluirValorizacion: boolean;
}): Promise<ResumenInventario> {
  const depositos = await listarDepositosActivos();
  const [porDeposito, bajo, sinStock, valor] = await Promise.all([
    prisma.stock.groupBy({
      by: ["depositoId"],
      where: { deposito: { activo: true }, variante: { deletedAt: null } },
      _sum: { cantidad: true },
    }),
    prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n FROM vw_alertas_stock`,
    prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*) AS n FROM vw_stock_consolidado s
      JOIN "Variante" v ON v."id" = s.variante_id
      JOIN "Producto" p ON p."id" = s.producto_id
      WHERE v."activo" AND p."activo" AND s.total = 0`,
    opciones.incluirValorizacion
      ? prisma.$queryRaw<{ costo: Prisma.Decimal | null; venta: Prisma.Decimal | null }[]>`
          SELECT SUM(st."cantidad" * v."precioCosto") AS costo, SUM(st."cantidad" * v."precioVenta") AS venta
          FROM "Stock" st
          JOIN "Variante" v ON v."id" = st."varianteId"
          JOIN "Deposito" d ON d."id" = st."depositoId"
          WHERE d."activo" AND v."deletedAt" IS NULL`
      : Promise.resolve(null),
  ]);
  const unidades = new Map(porDeposito.map((p) => [p.depositoId, p._sum.cantidad ?? 0]));
  const resumen: ResumenInventario = {
    unidadesTotales: [...unidades.values()].reduce((a, b) => a + b, 0),
    porDeposito: depositos.map((d) => ({ ...d, unidades: unidades.get(d.id) ?? 0 })),
    variantesBajoMinimo: Number(bajo[0]?.n ?? 0),
    variantesSinStock: Number(sinStock[0]?.n ?? 0),
  };
  if (valor) {
    resumen.valorizacion = {
      valorCosto: new Prisma.Decimal(valor[0]?.costo ?? 0).toFixed(2),
      valorVenta: new Prisma.Decimal(valor[0]?.venta ?? 0).toFixed(2),
    };
  }
  return resumen;
}

export interface MatrizStockProducto {
  depositos: DepositoBasico[];
  filas: {
    varianteId: string;
    variante: string;
    porDeposito: Record<string, number>;
    total: number;
    stockMinimo: number;
    estado: EstadoStock;
  }[];
  totalesPorDeposito: Record<string, number>;
  total: number;
}

/** Matriz sabores × depósitos para la ficha de producto. */
export async function obtenerStockPorProducto(productoId: string): Promise<MatrizStockProducto> {
  const [depositos, variantes] = await Promise.all([
    listarDepositosActivos(),
    prisma.variante.findMany({
      where: { productoId, deletedAt: null },
      orderBy: { nombre: "asc" },
      select: {
        id: true,
        nombre: true,
        stockMinimo: true,
        stocks: { select: { depositoId: true, cantidad: true } },
      },
    }),
  ]);
  const totalesPorDeposito: Record<string, number> = Object.fromEntries(
    depositos.map((d) => [d.id, 0]),
  );
  const filas = variantes.map((v) => {
    const porDeposito: Record<string, number> = {};
    for (const d of depositos) {
      const n = v.stocks.find((s) => s.depositoId === d.id)?.cantidad ?? 0;
      porDeposito[d.id] = n;
      totalesPorDeposito[d.id] = (totalesPorDeposito[d.id] ?? 0) + n;
    }
    const total = Object.values(porDeposito).reduce((a, b) => a + b, 0);
    return {
      varianteId: v.id,
      variante: v.nombre,
      porDeposito,
      total,
      stockMinimo: v.stockMinimo,
      estado: estadoStock(total, v.stockMinimo),
    };
  });
  return { depositos, filas, totalesPorDeposito, total: filas.reduce((a, f) => a + f.total, 0) };
}

export interface AlertaStock {
  varianteId: string;
  productoId: string;
  producto: string;
  variante: string;
  sku: string;
  stockMinimo: number;
  stockTotal: number;
  faltante: number;
}

const alertasSchema = z.array(
  z.object({
    variante_id: z.string(),
    producto_id: z.string(),
    producto: z.string(),
    variante: z.string(),
    sku: z.string(),
    stock_minimo: z.number().int(),
    stock_total: z.number().int(),
    faltante: z.number().int(),
  }),
);

/** Variantes activas con stock total < mínimo (vista vw_alertas_stock), las más urgentes primero. */
export async function obtenerAlertasStock(): Promise<AlertaStock[]> {
  const filas = alertasSchema.parse(
    await prisma.$queryRaw`SELECT variante_id, producto_id, producto, variante, sku, stock_minimo, stock_total, faltante
      FROM vw_alertas_stock ORDER BY stock_total ASC, faltante DESC, producto, variante`,
  );
  return filas.map((f) => ({
    varianteId: f.variante_id,
    productoId: f.producto_id,
    producto: f.producto,
    variante: f.variante,
    sku: f.sku,
    stockMinimo: f.stock_minimo,
    stockTotal: f.stock_total,
    faltante: f.faltante,
  }));
}

/** CSV de lo que se está viendo (mismos filtros, sin paginar). */
export async function exportarInventarioCSV(
  filtros: FiltrosInventario,
  opciones: { incluirValorizacion: boolean },
): Promise<string> {
  const depositos = await listarDepositosActivos();
  const filas = (await consultar(filtros, depositos, false)).map((r) =>
    aFila(r, depositos, opciones.incluirValorizacion),
  );
  const encabezado = [
    "producto",
    "variante",
    "sku",
    "codigo_barras",
    "marca",
    "categoria",
    ...depositos.map((d) => d.nombre),
    "total",
    "stock_minimo",
    "estado",
    ...(opciones.incluirValorizacion
      ? ["precio_costo", "precio_venta", "valor_costo", "valor_venta"]
      : []),
  ];
  return aCSV([
    encabezado,
    ...filas.map((f) => [
      f.producto,
      f.tieneVariantes ? f.variante : "",
      f.sku,
      f.codigoBarras ?? "",
      f.marca ?? "",
      f.categoria,
      ...depositos.map((d) => f.porDeposito[d.id] ?? 0),
      f.total,
      f.stockMinimo,
      f.estado,
      ...(f.valorizacion
        ? [
            formatearDecimalAR(f.valorizacion.precioCosto),
            formatearDecimalAR(f.valorizacion.precioVenta),
            formatearDecimalAR(f.valorizacion.valorCosto),
            formatearDecimalAR(f.valorizacion.valorVenta),
          ]
        : []),
    ]),
  ]);
}

/**
 * Matriz completa producto × sabor × depósito (misma consulta que la
 * pantalla de inventario, sin paginar), para el reporte de stock.
 */
export async function obtenerMatrizStockCompleta(
  filtros: Pick<FiltrosInventario, "categoriaId" | "depositoId"> & { soloConStock?: boolean },
  opciones: { incluirValorizacion: boolean },
): Promise<{ depositos: DepositoBasico[]; filas: FilaInventario[] }> {
  const depositos = await listarDepositosActivos();
  const f = filtrosInventarioSchema.parse({
    categoriaId: filtros.categoriaId,
    depositoId: filtros.depositoId,
    soloConStock: filtros.soloConStock ?? false,
    agruparPorProducto: true,
  });
  const filas = await consultar(f, depositos, false);
  return {
    depositos,
    filas: filas.map((r) => aFila(r, depositos, opciones.incluirValorizacion)),
  };
}
