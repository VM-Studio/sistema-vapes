import ExcelJS from "exceljs";
import { Prisma } from "@prisma/client";
import { z } from "zod";

import { normalizarCodigoBarras } from "@/lib/barcode";
import { aCSV } from "@/lib/csv";
import { ESTADO_STOCK_UI } from "@/lib/movimientos-ui";
import { dbPara, type Ctx } from "@/server/db/panel-scoped";
import { estadoStock, nombreCompleto, type EstadoStock } from "@/server/services/producto.service";

/**
 * STOCK DEL PANEL: lectura del stock por depósito y consolidado ("Global",
 * vista vw_stock_consolidado filtrada por panel_id).
 * Solo lectura: toda escritura de stock pasa por el motor (stock.service).
 * Sin costos: el stock se muestra en unidades.
 */

// =============================================================================
// Depósitos
// =============================================================================

export interface DepositoStock {
  id: string;
  nombre: string;
  esPrincipal: boolean;
}

/** Depósitos activos del panel, principal primero (columnas y selector Global/depósito). */
export async function depositosActivosPanel(ctx: Ctx): Promise<DepositoStock[]> {
  return dbPara(ctx.panelId).deposito.findMany({
    where: { activo: true },
    select: { id: true, nombre: true, esPrincipal: true },
    orderBy: [{ esPrincipal: "desc" }, { nombre: "asc" }],
  });
}

// =============================================================================
// Filtros y tipos
// =============================================================================

const bandera = z.preprocess((v) => v === true || v === "1", z.boolean()).catch(false);

export const filtrosStockSchema = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  categoriaId: z.string().min(1).optional().catch(undefined),
  marcaId: z.string().min(1).optional().catch(undefined),
  /** Depósito a ver. Sin depósito = "Global" (todos los depósitos del panel). */
  depositoId: z.string().min(1).max(64).optional().catch(undefined),
  soloConStock: bandera,
  soloBajoMinimo: bandera,
  soloSinStock: bandera,
  /** "campo" o "-campo" (desc). Campo: producto, variante, sku, cantidad, minimo, estado o "dep:<depositoId>". */
  orden: z.string().max(60).catch("producto"),
  agruparPorProducto: z.preprocess((v) => v === true || v === "producto", z.boolean()).catch(false),
  page: z.coerce.number().int().min(1).catch(1),
  pageSize: z.coerce.number().int().min(10).max(200).catch(50),
});

export type FiltrosStock = z.output<typeof filtrosStockSchema>;

export interface FilaStock {
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
  /** Cantidad por depositoId (depósitos activos del panel; 0 si no hay stock). */
  porDeposito: Record<string, number>;
  /** Total del panel (todos los depósitos). */
  total: number;
  /** Lo que muestra la vista: el total en Global, la cantidad del depósito si se eligió uno. */
  cantidad: number;
  estado: EstadoStock;
}

export interface ResultadoStock {
  depositos: DepositoStock[];
  /** Depósito elegido (null = Global). */
  deposito: DepositoStock | null;
  filas: FilaStock[];
  /** Filas (o productos, si se agrupa) que cumplen el filtro, para paginar. */
  total: number;
  page: number;
  pageSize: number;
}

// Lo que devuelve la query (validado con Zod: $queryRaw no tipa nada).
const filaSqlSchema = z.object({
  variante_id: z.string(),
  producto_id: z.string(),
  producto: z.string(),
  variante: z.string(),
  sku: z.string(),
  codigo_barras: z.string().nullable(),
  stock_minimo: z.number().int(),
  total: z.number().int(),
  cantidad: z.number().int(),
  por_deposito: z.record(z.string(), z.number().int()),
  tiene_variantes: z.boolean(),
  marca: z.string().nullable(),
  categoria: z.string(),
  total_resultados: z.union([z.bigint(), z.number()]).transform(Number),
});
const filasSqlSchema = z.array(filaSqlSchema);
type FilaSql = z.output<typeof filaSqlSchema>;

// =============================================================================
// Query (SQL cruda: SIEMPRE filtrada por el panel del ctx)
// =============================================================================

function pareceCodigo(q: string): boolean {
  return /^[0-9A-Za-z-]{4,64}$/.test(q) && /\d/.test(q);
}

/** Cantidad que muestra la vista (total o la del depósito elegido). */
function expresionCantidad(depositoId: string | undefined): Prisma.Sql {
  return depositoId
    ? Prisma.sql`COALESCE((s.por_deposito ->> ${depositoId})::int, 0)`
    : Prisma.sql`s.total`;
}

function construirWhere(ctx: Ctx, f: FiltrosStock): Prisma.Sql {
  const cantidad = expresionCantidad(f.depositoId);
  const condiciones: Prisma.Sql[] = [
    Prisma.sql`s.panel_id = ${ctx.panelId}`,
    // Variantes vivas activas, más las inactivas que todavía tienen stock (no se "pierde" mercadería de vista).
    Prisma.sql`((v."activo" AND p."activo") OR ${cantidad} > 0)`,
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
          OR EXISTS (SELECT 1 FROM "CodigoBarrasAlternativo" a
                     WHERE a."panelId" = ${ctx.panelId} AND a."varianteId" = v."id" AND a."codigo" = ${c})
          OR (${porTexto}))`,
      );
    } else {
      condiciones.push(Prisma.sql`(${porTexto})`);
    }
  }
  if (f.categoriaId) condiciones.push(Prisma.sql`p."categoriaId" = ${f.categoriaId}`);
  if (f.marcaId) condiciones.push(Prisma.sql`p."marcaId" = ${f.marcaId}`);
  if (f.soloConStock) condiciones.push(Prisma.sql`${cantidad} > 0`);
  if (f.soloSinStock) condiciones.push(Prisma.sql`${cantidad} <= 0`);
  if (f.soloBajoMinimo) condiciones.push(Prisma.sql`${cantidad} < s.stock_minimo`);
  return Prisma.join(condiciones, " AND ");
}

function construirOrden(f: FiltrosStock, depositos: DepositoStock[]): Prisma.Sql {
  const desc = f.orden.startsWith("-");
  const campo = desc ? f.orden.slice(1) : f.orden;
  const dir = Prisma.raw(desc ? "DESC" : "ASC");
  const cantidad = expresionCantidad(f.depositoId);
  let expr: Prisma.Sql;
  if (campo.startsWith("dep:") && depositos.some((d) => d.id === campo.slice(4))) {
    expr = expresionCantidad(campo.slice(4));
  } else if (campo === "cantidad" || campo === "total") {
    expr = cantidad;
  } else if (campo === "estado") {
    // SIN_STOCK (0) < BAJO (1) < OK (2)
    expr = Prisma.sql`CASE WHEN ${cantidad} <= 0 THEN 0 WHEN ${cantidad} < s.stock_minimo THEN 1 ELSE 2 END`;
  } else {
    const columnas: Record<string, string> = {
      producto: `lower(s.producto)`,
      variante: `lower(s.variante)`,
      sku: `s.sku`,
      minimo: `s.stock_minimo`,
    };
    expr = Prisma.raw(columnas[campo] ?? columnas.producto!);
  }
  return Prisma.sql`${expr} ${dir}, lower(s.producto) ASC, lower(s.variante) ASC`;
}

function selectFilas(f: FiltrosStock): Prisma.Sql {
  return Prisma.sql`
  s.variante_id, s.producto_id, s.producto, s.variante, s.sku, s.codigo_barras,
  s.stock_minimo, s.total, ${expresionCantidad(f.depositoId)} AS cantidad, s.por_deposito,
  p."tieneVariantes" AS tiene_variantes,
  m."nombre" AS marca, c."nombre" AS categoria`;
}

const FROM_FILAS = Prisma.sql`
  FROM vw_stock_consolidado s
  JOIN "Variante" v ON v."id" = s.variante_id
  JOIN "Producto" p ON p."id" = s.producto_id
  JOIN "Categoria" c ON c."id" = p."categoriaId"
  LEFT JOIN "Marca" m ON m."id" = p."marcaId"`;

async function consultar(
  ctx: Ctx,
  f: FiltrosStock,
  depositos: DepositoStock[],
  paginar: boolean,
): Promise<FilaSql[]> {
  const db = dbPara(ctx.panelId);
  const where = construirWhere(ctx, f);
  const orden = construirOrden(f, depositos);
  const offset = (f.page - 1) * f.pageSize;

  let crudo: unknown;
  if (f.agruparPorProducto) {
    // Pagina por PRODUCTO (con todas sus variantes), no por fila.
    crudo = await db.$queryRaw`
      WITH filas AS (SELECT ${selectFilas(f)} ${FROM_FILAS} WHERE ${where}),
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
    crudo = await db.$queryRaw`
      SELECT ${selectFilas(f)}, COUNT(*) OVER () AS total_resultados
      ${FROM_FILAS}
      WHERE ${where}
      ORDER BY ${orden}
      ${paginar ? Prisma.sql`LIMIT ${f.pageSize} OFFSET ${offset}` : Prisma.empty}`;
  }
  return filasSqlSchema.parse(crudo);
}

function aFila(r: FilaSql, depositos: DepositoStock[]): FilaStock {
  const porDeposito: Record<string, number> = {};
  for (const d of depositos) porDeposito[d.id] = r.por_deposito[d.id] ?? 0;
  return {
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
    cantidad: r.cantidad,
    estado: estadoStock(r.cantidad, r.stock_minimo),
  };
}

/** Un depositoId que no es un depósito activo del panel se ignora (vista Global). */
function normalizarFiltros(f: FiltrosStock, depositos: DepositoStock[]): FiltrosStock {
  return f.depositoId && !depositos.some((d) => d.id === f.depositoId)
    ? { ...f, depositoId: undefined }
    : f;
}

/**
 * Stock paginado del panel: una fila por variante. En Global trae la cantidad
 * de cada depósito y el total; con `depositoId`, la cantidad de ese depósito.
 */
export async function obtenerStock(ctx: Ctx, filtros: FiltrosStock): Promise<ResultadoStock> {
  const depositos = await depositosActivosPanel(ctx);
  const f = normalizarFiltros(filtros, depositos);
  const filas = await consultar(ctx, f, depositos, true);
  return {
    depositos,
    deposito: depositos.find((d) => d.id === f.depositoId) ?? null,
    filas: filas.map((r) => aFila(r, depositos)),
    total: filas[0]?.total_resultados ?? 0,
    page: f.page,
    pageSize: f.pageSize,
  };
}

// =============================================================================
// Resumen, alertas, matriz por producto
// =============================================================================

export interface ResumenStock {
  /** Unidades de la vista (todo el panel o el depósito elegido). */
  unidades: number;
  porDeposito: { id: string; nombre: string; esPrincipal: boolean; unidades: number }[];
  variantesBajoMinimo: number;
  variantesSinStock: number;
}

const conteosSchema = z.array(
  z.object({
    bajo: z.union([z.bigint(), z.number()]).transform(Number),
    sin_stock: z.union([z.bigint(), z.number()]).transform(Number),
  }),
);

export async function obtenerResumenStock(ctx: Ctx, depositoId?: string): Promise<ResumenStock> {
  const db = dbPara(ctx.panelId);
  const depositos = await depositosActivosPanel(ctx);
  const dep = depositos.some((d) => d.id === depositoId) ? depositoId : undefined;
  const cantidad = expresionCantidad(dep);
  const [porDeposito, conteos] = await Promise.all([
    db.stock.groupBy({
      by: ["depositoId"],
      where: { deposito: { activo: true }, variante: { deletedAt: null } },
      _sum: { cantidad: true },
    }),
    db.$queryRaw`
      SELECT COUNT(*) FILTER (WHERE ${cantidad} < s.stock_minimo) AS bajo,
             COUNT(*) FILTER (WHERE ${cantidad} <= 0) AS sin_stock
      FROM vw_stock_consolidado s
      JOIN "Variante" v ON v."id" = s.variante_id
      JOIN "Producto" p ON p."id" = s.producto_id
      WHERE s.panel_id = ${ctx.panelId} AND v."activo" AND p."activo"`,
  ]);
  const unidades = new Map(porDeposito.map((p) => [p.depositoId, p._sum.cantidad ?? 0]));
  const [c] = conteosSchema.parse(conteos);
  const lista = depositos.map((d) => ({ ...d, unidades: unidades.get(d.id) ?? 0 }));
  return {
    unidades: dep ? (unidades.get(dep) ?? 0) : lista.reduce((a, d) => a + d.unidades, 0),
    porDeposito: lista,
    variantesBajoMinimo: c?.bajo ?? 0,
    variantesSinStock: c?.sin_stock ?? 0,
  };
}

export interface MatrizStockProducto {
  depositos: DepositoStock[];
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

/** Matriz variantes × depósitos del panel para la ficha de producto. */
export async function obtenerStockPorProducto(
  ctx: Ctx,
  productoId: string,
): Promise<MatrizStockProducto> {
  const [depositos, variantes] = await Promise.all([
    depositosActivosPanel(ctx),
    dbPara(ctx.panelId).variante.findMany({
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

/** Variantes activas del panel con stock total < mínimo (vw_alertas_stock), las más urgentes primero. */
export async function obtenerAlertasStock(ctx: Ctx, limite = 200): Promise<AlertaStock[]> {
  const filas = alertasSchema.parse(
    await dbPara(ctx.panelId).$queryRaw`
      SELECT variante_id, producto_id, producto, variante, sku, stock_minimo, stock_total, faltante
      FROM vw_alertas_stock
      WHERE panel_id = ${ctx.panelId}
      ORDER BY stock_total ASC, faltante DESC, producto, variante
      LIMIT ${limite}`,
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

// =============================================================================
// Exportación (lo que se está viendo: mismos filtros, sin paginar)
// =============================================================================

interface Planilla {
  titulo: string;
  encabezado: string[];
  filas: (string | number)[][];
}

async function planillaStock(ctx: Ctx, filtros: FiltrosStock): Promise<Planilla> {
  const depositos = await depositosActivosPanel(ctx);
  const f = normalizarFiltros(filtros, depositos);
  const deposito = depositos.find((d) => d.id === f.depositoId) ?? null;
  const filas = (await consultar(ctx, f, depositos, false)).map((r) => aFila(r, depositos));
  const columnasStock = deposito
    ? [`Stock en ${deposito.nombre}`]
    : [...depositos.map((d) => d.nombre), "Total"];
  return {
    titulo: deposito ? `Stock ${deposito.nombre}` : "Stock global",
    encabezado: [
      "Producto",
      "Variante",
      "SKU",
      "Código de barras",
      "Marca",
      "Categoría",
      ...columnasStock,
      "Stock mínimo",
      "Estado",
    ],
    filas: filas.map((fila) => [
      fila.producto,
      fila.tieneVariantes ? fila.variante : "",
      fila.sku,
      fila.codigoBarras ?? "",
      fila.marca ?? "",
      fila.categoria,
      ...(deposito
        ? [fila.cantidad]
        : [...depositos.map((d) => fila.porDeposito[d.id] ?? 0), fila.total]),
      fila.stockMinimo,
      ESTADO_STOCK_UI[fila.estado].label,
    ]),
  };
}

/** CSV (UTF-8 con BOM y ";", lo que abre bien Excel es-AR). */
export async function exportarStockCSV(ctx: Ctx, filtros: FiltrosStock): Promise<string> {
  const p = await planillaStock(ctx, filtros);
  return aCSV([p.encabezado, ...p.filas]);
}

/** Excel (.xlsx) con encabezado fijo y autofiltro. */
export async function exportarStockExcel(ctx: Ctx, filtros: FiltrosStock): Promise<Buffer> {
  const p = await planillaStock(ctx, filtros);
  const libro = new ExcelJS.Workbook();
  libro.created = new Date();
  const hoja = libro.addWorksheet(p.titulo.slice(0, 31), {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  hoja.addRow(p.encabezado).font = { bold: true };
  hoja.addRows(p.filas);
  hoja.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: p.encabezado.length } };
  hoja.columns.forEach((col, i) => {
    const largo = Math.max(
      p.encabezado[i]!.length,
      ...p.filas.slice(0, 500).map((f) => String(f[i] ?? "").length),
    );
    col.width = Math.min(Math.max(largo + 2, 8), 50);
  });
  return Buffer.from(await libro.xlsx.writeBuffer());
}
