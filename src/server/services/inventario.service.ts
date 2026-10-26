import ExcelJS from "exceljs";
import { Prisma } from "@prisma/client";
import { z } from "zod";

import { normalizarCodigoBarras } from "@/lib/barcode";
import { aCSV } from "@/lib/csv";
import { ESTADO_STOCK_UI, estadoDeStock, type EstadoStockUI } from "@/lib/movimientos-ui";
import { nombreConSabor, SABOR_UNICO, saborVisible } from "@/lib/ventas-ui";
import { dbPara, type Ctx } from "@/server/db/panel-scoped";

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
  /** Modelo (Producto.nombre normalizado: minúsculas, sin espacios de más). */
  modelo: z.string().trim().min(1).max(120).optional().catch(undefined),
  /** Gusto/sabor normalizado (ver normalizarGusto): todas las marcas y modelos de ese gusto. */
  gusto: z.string().trim().min(1).max(120).optional().catch(undefined),
  /** Pitadas (Producto.especificacionNorm). */
  pitadas: z.string().trim().min(1).max(60).optional().catch(undefined),
  /** Tarjeta elegida: sabores con esa cantidad > 0. */
  ver: z.enum(["disponible", "escaneado", "retirado"]).optional().catch(undefined),
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
  /** Nombre completo del producto ("Elf Bar BC 5000"). */
  producto: string;
  /** Nombre de la variante tal cual ("Único" en productos sin sabor). */
  variante: string;
  /** El sabor para mostrar (null si el producto no tiene sabores). */
  sabor: string | null;
  /** Producto + sabor. */
  nombreCompleto: string;
  sku: string;
  codigoBarras: string | null;
  marca: string;
  categoria: string | null;
  stockMinimo: number;
  /** Cantidad por depositoId (depósitos activos del panel; 0 si no hay stock). */
  porDeposito: Record<string, number>;
  /** Total del panel (todos los depósitos). */
  total: number;
  /** Lo que muestra la vista: el total en Global, la cantidad del depósito si se eligió uno. */
  cantidad: number;
  /**
   * DISPONIBLE = `cantidad` (lo vendible: la venta ya descontó lo vendido).
   * ESCANEADO (reservado) = vendido, escaneado por Charly y sin retirar: sigue
   * en el galpón pero no se puede vender.
   */
  escaneado: number;
  /** Vendido sin retirar y sin escanear (también sigue en el galpón). */
  sinEscanear: number;
  /** Vendido y retirado: salió del galpón definitivamente. */
  retirado: number;
  /** Físico en el galpón = disponible + vendido sin retirar (escaneado o no). */
  fisico: number;
  estado: EstadoStockUI;
}

/** Totales de las tarjetas Disponible / Escaneado / Retirado (mismos filtros, sin la tarjeta). */
export interface TotalesStock {
  disponible: number;
  escaneado: number;
  sinEscanear: number;
  retirado: number;
  fisico: number;
}

export interface ResultadoStock {
  depositos: DepositoStock[];
  /** Depósito elegido (null = Global). */
  deposito: DepositoStock | null;
  filas: FilaStock[];
  totales: TotalesStock;
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
  marca: z.string(),
  categoria: z.string().nullable(),
  escaneado: z.number().int(),
  sin_escanear: z.number().int(),
  retirado: z.number().int(),
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

/** Gusto normalizado (SQL): minúsculas, sin tildes ni espacios de más. Espejo de normalizarGusto(). */
const GUSTO_SQL = Prisma.sql`translate(lower(btrim(regexp_replace(v."nombre", '\\s+', ' ', 'g'))), 'áéíóúüñ', 'aeiouun')`;
/** Modelo normalizado (SQL). */
const MODELO_SQL = Prisma.sql`lower(btrim(regexp_replace(p."nombre", '\\s+', ' ', 'g')))`;

/** Mismo criterio que GUSTO_SQL / MODELO_SQL (para armar valores en el cliente o tests). */
export function normalizarGusto(texto: string): string {
  return texto
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/[áéíóúüñ]/g, (c) => ({ á: "a", é: "e", í: "i", ó: "o", ú: "u", ü: "u", ñ: "n" })[c]!);
}

/** Cantidad que muestra la vista (total o la del depósito elegido), sobre la vista consolidada. */
function expresionCantidad(depositoId: string | undefined): Prisma.Sql {
  return depositoId
    ? Prisma.sql`COALESCE((s.por_deposito ->> ${depositoId})::int, 0)`
    : Prisma.sql`s.total`;
}

/**
 * Unidades vendidas (ventas CONFIRMADAS) por sabor, en el galpón elegido (o
 * en todos): escaneadas sin retirar, sin escanear ni retirar, y retiradas.
 * En vivo, sin caché: sale de Venta/VentaItem.
 */
function cteVentas(ctx: Ctx, depositoId: string | undefined): Prisma.Sql {
  return Prisma.sql`
  ventas_ag AS (
    SELECT vi."varianteId" AS variante_id,
      COALESCE(SUM(vi."cantidad") FILTER (
        WHERE ve."retiradaAt" IS NULL AND ve."escaneoRemoto" = 'ESCANEADA'), 0)::int AS escaneado,
      COALESCE(SUM(vi."cantidad") FILTER (
        WHERE ve."retiradaAt" IS NULL AND ve."escaneoRemoto" IS DISTINCT FROM 'ESCANEADA'), 0)::int AS sin_escanear,
      COALESCE(SUM(vi."cantidad") FILTER (WHERE ve."retiradaAt" IS NOT NULL), 0)::int AS retirado
    FROM "VentaItem" vi
    JOIN "Venta" ve ON ve."id" = vi."ventaId"
    WHERE ve."panelId" = ${ctx.panelId} AND vi."panelId" = ${ctx.panelId}
      AND ve."estado" = 'CONFIRMADA'
      ${depositoId ? Prisma.sql`AND ve."depositoId" = ${depositoId}` : Prisma.empty}
    GROUP BY vi."varianteId"
  )`;
}

/** Condiciones sobre producto/sabor (buscador, marca, modelo, gusto, pitadas, categoría). */
function construirWhereBase(ctx: Ctx, f: FiltrosStock): Prisma.Sql {
  const cantidad = expresionCantidad(f.depositoId);
  const condiciones: Prisma.Sql[] = [
    Prisma.sql`s.panel_id = ${ctx.panelId}`,
    // Variantes vivas activas, más las inactivas que todavía tienen stock o
    // vendido sin retirar (no se "pierde" mercadería de vista).
    Prisma.sql`((v."activo" AND p."activo") OR ${cantidad} > 0
      OR COALESCE(va.escaneado, 0) + COALESCE(va.sin_escanear, 0) > 0)`,
  ];
  if (f.q) {
    const q = f.q.trim();
    const texto = q
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 5)
      .map((w) => {
        const patron = `%${w.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
        return Prisma.sql`(p."nombreCompleto" ILIKE ${patron} OR v."nombre" ILIKE ${patron} OR v."sku" ILIKE ${patron})`;
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
  if (f.modelo) condiciones.push(Prisma.sql`${MODELO_SQL} = ${f.modelo}`);
  if (f.gusto) condiciones.push(Prisma.sql`${GUSTO_SQL} = ${f.gusto}`);
  if (f.pitadas) condiciones.push(Prisma.sql`p."especificacionNorm" = ${f.pitadas}`);
  return Prisma.join(condiciones, " AND ");
}

/** Condiciones sobre las cantidades ya calculadas (columnas de `base`). Sin la tarjeta. */
function construirWhereCantidades(f: FiltrosStock): Prisma.Sql {
  const condiciones: Prisma.Sql[] = [Prisma.sql`TRUE`];
  if (f.soloConStock) condiciones.push(Prisma.sql`cantidad > 0`);
  if (f.soloSinStock) condiciones.push(Prisma.sql`cantidad <= 0`);
  if (f.soloBajoMinimo) condiciones.push(Prisma.sql`cantidad < stock_minimo`);
  return Prisma.join(condiciones, " AND ");
}

/** La tarjeta elegida (Disponible / Escaneado / Retirado): esa cantidad > 0. */
function condicionTarjeta(f: FiltrosStock): Prisma.Sql {
  if (f.ver === "disponible") return Prisma.sql`cantidad > 0`;
  if (f.ver === "escaneado") return Prisma.sql`escaneado > 0`;
  if (f.ver === "retirado") return Prisma.sql`retirado > 0`;
  return Prisma.sql`TRUE`;
}

function construirOrden(f: FiltrosStock, depositos: DepositoStock[]): Prisma.Sql {
  const desc = f.orden.startsWith("-");
  const campo = desc ? f.orden.slice(1) : f.orden;
  const dir = Prisma.raw(desc ? "DESC" : "ASC");
  let expr: Prisma.Sql;
  if (campo.startsWith("dep:") && depositos.some((d) => d.id === campo.slice(4))) {
    expr = Prisma.sql`COALESCE((por_deposito ->> ${campo.slice(4)})::int, 0)`;
  } else if (campo === "cantidad" || campo === "total") {
    expr = Prisma.sql`cantidad`;
  } else if (campo === "estado") {
    // SIN_STOCK (0) < BAJO (1) < OK (2)
    expr = Prisma.sql`CASE WHEN cantidad <= 0 THEN 0 WHEN cantidad < stock_minimo THEN 1 ELSE 2 END`;
  } else {
    const columnas: Record<string, string> = {
      producto: `lower(producto)`,
      variante: `lower(variante)`,
      sku: `sku`,
      minimo: `stock_minimo`,
      escaneado: `escaneado`,
      retirado: `retirado`,
    };
    expr = Prisma.raw(columnas[campo] ?? columnas.producto!);
  }
  return Prisma.sql`${expr} ${dir}, lower(producto) ASC, lower(variante) ASC`;
}

/** CTEs `ventas_ag`, `base` (por sabor, con todas las cantidades) y `filas` (con los filtros, sin la tarjeta). */
function ctes(ctx: Ctx, f: FiltrosStock): Prisma.Sql {
  return Prisma.sql`
  WITH ${cteVentas(ctx, f.depositoId)},
  base AS (
    SELECT s.variante_id, s.producto_id, s.producto, s.variante, s.sku, s.codigo_barras,
      s.stock_minimo, s.total, ${expresionCantidad(f.depositoId)} AS cantidad, s.por_deposito,
      m."nombre" AS marca, c."nombre" AS categoria,
      COALESCE(va.escaneado, 0) AS escaneado,
      COALESCE(va.sin_escanear, 0) AS sin_escanear,
      COALESCE(va.retirado, 0) AS retirado
    FROM vw_stock_consolidado s
    JOIN "Variante" v ON v."id" = s.variante_id
    JOIN "Producto" p ON p."id" = s.producto_id
    JOIN "Marca" m ON m."id" = p."marcaId"
    LEFT JOIN "Categoria" c ON c."id" = p."categoriaId"
    LEFT JOIN ventas_ag va ON va.variante_id = s.variante_id
    WHERE ${construirWhereBase(ctx, f)}
  ),
  filas AS (SELECT * FROM base WHERE ${construirWhereCantidades(f)})`;
}

const COLUMNAS = Prisma.sql`variante_id, producto_id, producto, variante, sku, codigo_barras,
  stock_minimo, total, cantidad, por_deposito, marca, categoria, escaneado, sin_escanear, retirado`;

async function consultar(
  ctx: Ctx,
  f: FiltrosStock,
  depositos: DepositoStock[],
  paginar: boolean,
): Promise<FilaSql[]> {
  const db = dbPara(ctx.panelId);
  const orden = construirOrden(f, depositos);
  const tarjeta = condicionTarjeta(f);
  const offset = (f.page - 1) * f.pageSize;

  let crudo: unknown;
  if (f.agruparPorProducto) {
    // Pagina por PRODUCTO (con todas sus variantes), no por fila.
    crudo = await db.$queryRaw`
      ${ctes(ctx, f)},
      elegidas AS (SELECT ${COLUMNAS} FROM filas WHERE ${tarjeta}),
      productos AS (
        SELECT producto_id, MIN(lower(producto)) AS clave FROM elegidas GROUP BY producto_id
      ),
      pagina AS (
        SELECT producto_id, clave FROM productos ORDER BY clave, producto_id
        ${paginar ? Prisma.sql`LIMIT ${f.pageSize} OFFSET ${offset}` : Prisma.empty}
      )
      SELECT elegidas.*, (SELECT COUNT(*) FROM productos) AS total_resultados
      FROM elegidas JOIN pagina USING (producto_id)
      ORDER BY pagina.clave, elegidas.producto_id, lower(elegidas.variante)`;
  } else {
    crudo = await db.$queryRaw`
      ${ctes(ctx, f)}
      SELECT ${COLUMNAS}, COUNT(*) OVER () AS total_resultados
      FROM filas
      WHERE ${tarjeta}
      ORDER BY ${orden}
      ${paginar ? Prisma.sql`LIMIT ${f.pageSize} OFFSET ${offset}` : Prisma.empty}`;
  }
  return filasSqlSchema.parse(crudo);
}

const totalesSqlSchema = z.array(
  z.object({
    disponible: z.union([z.bigint(), z.number()]).transform(Number),
    escaneado: z.union([z.bigint(), z.number()]).transform(Number),
    sin_escanear: z.union([z.bigint(), z.number()]).transform(Number),
    retirado: z.union([z.bigint(), z.number()]).transform(Number),
  }),
);

/**
 * Totales de las tarjetas con los mismos filtros (galpón, buscador, marca,
 * modelo, gusto, pitadas, bajo mínimo), SIN el filtro de la tarjeta: así las
 * tres cifras no cambian al tocar una.
 */
async function consultarTotales(ctx: Ctx, f: FiltrosStock): Promise<TotalesStock> {
  const crudo = await dbPara(ctx.panelId).$queryRaw`
    ${ctes(ctx, f)}
    SELECT COALESCE(SUM(cantidad), 0)::bigint AS disponible,
           COALESCE(SUM(escaneado), 0)::bigint AS escaneado,
           COALESCE(SUM(sin_escanear), 0)::bigint AS sin_escanear,
           COALESCE(SUM(retirado), 0)::bigint AS retirado
    FROM filas`;
  const t = totalesSqlSchema.parse(crudo)[0] ?? {
    disponible: 0,
    escaneado: 0,
    sin_escanear: 0,
    retirado: 0,
  };
  return {
    disponible: t.disponible,
    escaneado: t.escaneado,
    sinEscanear: t.sin_escanear,
    retirado: t.retirado,
    fisico: t.disponible + t.escaneado + t.sin_escanear,
  };
}

function aFila(r: FilaSql, depositos: DepositoStock[]): FilaStock {
  const porDeposito: Record<string, number> = {};
  for (const d of depositos) porDeposito[d.id] = r.por_deposito[d.id] ?? 0;
  return {
    varianteId: r.variante_id,
    productoId: r.producto_id,
    producto: r.producto,
    variante: r.variante,
    sabor: saborVisible(r.variante),
    nombreCompleto: nombreConSabor(r.producto, r.variante),
    sku: r.sku,
    codigoBarras: r.codigo_barras,
    marca: r.marca,
    categoria: r.categoria,
    stockMinimo: r.stock_minimo,
    porDeposito,
    total: r.total,
    cantidad: r.cantidad,
    escaneado: r.escaneado,
    sinEscanear: r.sin_escanear,
    retirado: r.retirado,
    fisico: r.cantidad + r.escaneado + r.sin_escanear,
    estado: estadoDeStock(r.cantidad, r.stock_minimo),
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
  const [filas, totales] = await Promise.all([
    consultar(ctx, f, depositos, true),
    consultarTotales(ctx, f),
  ]);
  return {
    depositos,
    deposito: depositos.find((d) => d.id === f.depositoId) ?? null,
    filas: filas.map((r) => aFila(r, depositos)),
    totales,
    total: filas[0]?.total_resultados ?? 0,
    page: f.page,
    pageSize: f.pageSize,
  };
}

// =============================================================================
// Opciones de los filtros (modelos, gustos, pitadas)
// =============================================================================

export interface OpcionesFiltrosStock {
  modelos: { value: string; label: string }[];
  gustos: { value: string; label: string }[];
  pitadas: { value: string; label: string }[];
}

const opcionesSqlSchema = z.array(z.object({ valor: z.string(), etiqueta: z.string() }));

/**
 * Valores distintos del catálogo vivo del panel. Los modelos, de la marca
 * elegida (si hay); gustos y pitadas, de todo el panel (agrupados por nombre
 * normalizado: "Mango Ice" y "mango ice" son el mismo gusto).
 */
export async function opcionesFiltrosStock(
  ctx: Ctx,
  opciones: { marcaId?: string } = {},
): Promise<OpcionesFiltrosStock> {
  const db = dbPara(ctx.panelId);
  const vivos = Prisma.sql`p."panelId" = ${ctx.panelId} AND p."deletedAt" IS NULL`;
  const [modelos, gustos, pitadas] = await Promise.all([
    db.$queryRaw`
      SELECT ${MODELO_SQL} AS valor, MIN(btrim(p."nombre")) AS etiqueta
      FROM "Producto" p
      WHERE ${vivos} ${opciones.marcaId ? Prisma.sql`AND p."marcaId" = ${opciones.marcaId}` : Prisma.empty}
      GROUP BY 1 HAVING ${MODELO_SQL} <> '' ORDER BY 2`,
    db.$queryRaw`
      SELECT ${GUSTO_SQL} AS valor, MIN(btrim(v."nombre")) AS etiqueta
      FROM "Variante" v JOIN "Producto" p ON p."id" = v."productoId"
      WHERE ${vivos} AND v."deletedAt" IS NULL AND v."nombre" <> ${SABOR_UNICO} AND btrim(v."nombre") <> ''
      GROUP BY 1 ORDER BY 2`,
    db.$queryRaw`
      SELECT p."especificacionNorm" AS valor, MIN(btrim(p."especificacion")) AS etiqueta
      FROM "Producto" p
      WHERE ${vivos} AND p."especificacionNorm" <> ''
      GROUP BY 1
      ORDER BY NULLIF(regexp_replace(p."especificacionNorm", '[^0-9]', '', 'g'), '')::numeric NULLS LAST, 1`,
  ]);
  const aOpciones = (crudo: unknown) =>
    opcionesSqlSchema.parse(crudo).map((o) => ({ value: o.valor, label: o.etiqueta }));
  return { modelos: aOpciones(modelos), gustos: aOpciones(gustos), pitadas: aOpciones(pitadas) };
}

// =============================================================================
// Matriz por producto
// =============================================================================

export interface MatrizStockProducto {
  depositos: DepositoStock[];
  filas: {
    varianteId: string;
    variante: string;
    porDeposito: Record<string, number>;
    total: number;
    stockMinimo: number;
    estado: EstadoStockUI;
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
      estado: estadoDeStock(total, v.stockMinimo),
    };
  });
  return { depositos, filas, totalesPorDeposito, total: filas.reduce((a, f) => a + f.total, 0) };
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
    ? [`Disponible en ${deposito.nombre}`]
    : [...depositos.map((d) => d.nombre), "Disponible total"];
  return {
    titulo: deposito ? `Stock ${deposito.nombre}` : "Stock global",
    encabezado: [
      "Producto",
      "Sabor",
      "SKU",
      "Código de barras",
      "Marca",
      "Categoría",
      ...columnasStock,
      "Escaneado (reservado)",
      "Vendido sin retirar (sin escanear)",
      "Retirado",
      "Físico en galpón",
      "Stock mínimo",
      "Estado",
    ],
    filas: filas.map((fila) => [
      fila.producto,
      fila.sabor ?? "",
      fila.sku,
      fila.codigoBarras ?? "",
      fila.marca,
      fila.categoria ?? "",
      ...(deposito
        ? [fila.cantidad]
        : [...depositos.map((d) => fila.porDeposito[d.id] ?? 0), fila.total]),
      fila.escaneado,
      fila.sinEscanear,
      fila.retirado,
      fila.fisico,
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
