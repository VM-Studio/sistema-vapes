import { randomInt } from "node:crypto";

import { AccionAuditoria, Prisma, TipoMovimiento, type RolUsuario } from "@prisma/client";

import type { StockEnDeposito, VarianteEncontrada } from "@/features/scanner/tipos";
import { CODIGO_BARRAS_REGEX, digitoLuhn, normalizarCodigoBarras } from "@/lib/barcode";
import { esOwner } from "@/lib/permisos";
import { precioVentaEfectivo, tienePrecioPropio } from "@/lib/precios";
import {
  colapsarEspacios,
  NOMBRE_VARIANTE_UNICA,
  nombreConSabor,
  normalizarEspecificacion,
  saborVisible,
  type AltaRapida,
  type CargarStock,
  type FiltrosProductos,
  type Producto,
} from "@/lib/validations/producto";
import { dbPara, transaccion, type Ctx, type Tx } from "@/server/db/panel-scoped";
import { ConflictError, DomainError, NotFoundError } from "@/server/errors";
import { registrarAuditoria } from "@/server/services/audit.service";
import { registrarMovimiento } from "@/server/services/stock.service";

/**
 * CATÁLOGO DEL PANEL: productos (marca + modelo + especificación, con un
 * precio de venta), sus sabores (variantes, con código de barras y precio
 * propio opcional) y la carga de stock por escaneo. Todo dentro del panel del
 * `ctx`: SKU y códigos de barras son únicos POR PANEL (el mismo EAN puede
 * existir en otro panel y no se ven entre sí).
 *
 * - `nombreCompleto` / `especificacionNorm` del producto los mantiene la DB
 *   (trigger): acá solo se leen.
 * - Montos hacia la UI como string con 2 decimales.
 * - `ultimoCosto` solo llega si el ctx es de un dueño (se decide acá, en el servidor).
 */

/** Contexto de lectura: panel y, si se conoce, quién mira (para decidir si ve costos). */
export type CtxCatalogo = Pick<Ctx, "panelId"> & { usuario?: { rol: RolUsuario } };

/** ¿Este ctx puede ver costos? Solo los dueños. */
export function veCosto(ctx: CtxCatalogo): boolean {
  return ctx.usuario !== undefined && esOwner(ctx.usuario);
}

export const MENSAJE_SIN_GALPON = "Tenés que elegir el galpón antes de cargar stock";

// =============================================================================
// Tipos (DTO)
// =============================================================================

export type EstadoStock = "OK" | "BAJO" | "SIN_STOCK";

export function estadoStock(total: number, minimo: number): EstadoStock {
  if (total <= 0) return "SIN_STOCK";
  if (total < minimo) return "BAJO";
  return "OK";
}

/** "Elf Bar BC 5000 — Mango" a partir del nombre completo del producto y el nombre de la variante. */
export function nombreCompleto(nombreCompletoProducto: string, nombreVariante: string): string {
  return nombreConSabor(nombreCompletoProducto, nombreVariante);
}

export interface SaborListado {
  id: string;
  /** Nombre de la variante tal cual ("Único" en productos sin sabor). */
  nombre: string;
  sabor: string | null;
  sku: string;
  codigoBarras: string | null;
  /** Efectivo: el propio o el del producto. */
  precioVenta: string;
  tienePrecioPropio: boolean;
  stockMinimo: number;
  activo: boolean;
  stockPorDeposito: Record<string, number>;
  stockTotal: number;
  estado: EstadoStock;
}

export interface ProductoListado {
  id: string;
  nombreCompleto: string;
  marca: string;
  marcaId: string;
  modelo: string;
  especificacion: string;
  categoria: string | null;
  precioVenta: string;
  activo: boolean;
  imagenUrl: string | null;
  /** true si es un producto sin sabores (una sola variante "Único"). */
  sinSabores: boolean;
  sabores: SaborListado[];
  stockPorDeposito: Record<string, number>;
  stockTotal: number;
  /** SIN_STOCK sin unidades; BAJO si algún sabor activo está bajo el mínimo; si no, OK. */
  estado: EstadoStock;
  saboresBajoMinimo: number;
}

export interface CodigoAlternativoDTO {
  id: string;
  codigo: string;
  descripcion: string | null;
}

export interface SaborDetalle extends SaborListado {
  /** Precio propio (null = usa el del producto). */
  precioPropio: string | null;
  /** null si quien mira no es dueño. */
  ultimoCosto: string | null;
  codigosAlternativos: CodigoAlternativoDTO[];
}

export interface ProductoDetalle extends Omit<ProductoListado, "sabores"> {
  categoriaId: string | null;
  sabores: SaborDetalle[];
}

// =============================================================================
// Helpers
// =============================================================================

const dec = (d: Prisma.Decimal | string | number) => new Prisma.Decimal(d).toFixed(2);

/** Normaliza un código de barras (sin espacios, mayúsculas). null si no tiene formato válido. */
export function normalizarCodigo(codigo: string): string | null {
  const c = normalizarCodigoBarras(codigo.trim());
  return CODIGO_BARRAS_REGEX.test(c) ? c : null;
}

/** ¿El texto parece un código de barras (y no un nombre)? */
function pareceCodigo(q: string): boolean {
  return /^[0-9A-Za-z-]{4,64}$/.test(q) && /\d/.test(q);
}

/** Precio propio a guardar: null si no viene o si es igual al del producto. */
function precioPropio(
  precioSabor: number | null | undefined,
  precioProducto: Prisma.Decimal | number,
): Prisma.Decimal | null {
  if (precioSabor === null || precioSabor === undefined) return null;
  const p = new Prisma.Decimal(precioSabor).toDecimalPlaces(2);
  return p.equals(precioProducto) ? null : p;
}

// --- SKU ---------------------------------------------------------------------

const ALFABETO_SKU = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sin 0/O ni 1/I: se leen mal impresos
const LARGO_SKU = 6;

/** Prefijo de SKU del panel (Configuracion "prefijoSku", "PRD" por defecto). */
async function prefijoSku(tx: Tx): Promise<string> {
  const conf = await tx.configuracion.findFirst({ where: { clave: "prefijoSku" } });
  return typeof conf?.valor === "string" && conf.valor.trim() !== ""
    ? conf.valor.trim().toUpperCase()
    : "PRD";
}

/** Genera un SKU libre en el panel con formato `{prefijoSku}-XXXXXX`. */
export async function generarSku(
  tx: Tx,
  reservados: ReadonlySet<string> = new Set(),
): Promise<string> {
  const prefijo = await prefijoSku(tx);
  for (let intento = 0; intento < 20; intento++) {
    const sufijo = Array.from(
      { length: LARGO_SKU },
      () => ALFABETO_SKU[randomInt(ALFABETO_SKU.length)],
    ).join("");
    const sku = `${prefijo}-${sufijo}`;
    if (reservados.has(sku)) continue;
    const existe = await tx.variante.findFirst({ where: { sku }, select: { id: true } });
    if (!existe) return sku;
  }
  throw new Error("No se pudo generar un SKU único tras 20 intentos.");
}

// --- Códigos de barras -------------------------------------------------------

const selectNombre = {
  id: true,
  nombre: true,
  producto: { select: { nombreCompleto: true } },
} as const;

/** ¿De quién es este código EN EL PANEL? Código principal (sabores vivos) y alternativos. */
async function duenioDeCodigo(
  tx: Tx,
  codigo: string,
  excluirVarianteId?: string,
): Promise<{ varianteId: string; nombre: string } | null> {
  const [principal, alternativo] = await Promise.all([
    tx.variante.findFirst({
      where: {
        codigoBarras: codigo,
        deletedAt: null,
        ...(excluirVarianteId ? { id: { not: excluirVarianteId } } : {}),
      },
      select: selectNombre,
    }),
    tx.codigoBarrasAlternativo.findFirst({
      where: { codigo },
      select: { variante: { select: selectNombre } },
    }),
  ]);
  const v = principal ?? alternativo?.variante;
  return v
    ? { varianteId: v.id, nombre: nombreConSabor(v.producto.nombreCompleto, v.nombre) }
    : null;
}

/** Lanza DomainError("El código X ya pertenece a …") si está usado en el panel. */
export async function assertCodigoDisponible(
  ctx: Pick<Ctx, "panelId">,
  codigo: string,
  excluirVarianteId?: string,
  tx: Tx = dbPara(ctx.panelId),
): Promise<void> {
  const duenio = await duenioDeCodigo(tx, codigo, excluirVarianteId);
  if (duenio)
    throw new DomainError(
      `El código ${codigo} ya pertenece a ${duenio.nombre}`,
      "CODIGO_EN_USO",
      409,
    );
}

/** Para la validación en vivo del formulario (con debounce). */
export async function verificarCodigoDisponible(
  ctx: Pick<Ctx, "panelId">,
  codigo: string,
  excluirVarianteId?: string,
): Promise<{ disponible: true } | { disponible: false; mensaje: string }> {
  const c = normalizarCodigo(codigo);
  if (!c) return { disponible: false, mensaje: "Código de barras inválido" };
  const duenio = await duenioDeCodigo(dbPara(ctx.panelId), c, excluirVarianteId);
  return duenio
    ? { disponible: false, mensaje: `Ya pertenece a ${duenio.nombre}` }
    : { disponible: true };
}

// --- Códigos internos (Code128) para productos sin código de fábrica ---------

/** Prefijo de los códigos internos del panel: el de los SKU, solo letras y números. */
export async function prefijoCodigoInterno(
  ctx: Pick<Ctx, "panelId">,
  tx: Tx = dbPara(ctx.panelId),
): Promise<string> {
  return (await prefijoSku(tx)).replace(/[^A-Z0-9]/g, "") || "PRD";
}

/** Formato: {prefijo}{7 dígitos}{verificador Luhn} — ej: PRD12345674. Libre dentro del panel. */
export async function generarCodigoInterno(
  ctx: Pick<Ctx, "panelId">,
  tx: Tx = dbPara(ctx.panelId),
  reservados: ReadonlySet<string> = new Set(),
): Promise<string> {
  const prefijo = await prefijoCodigoInterno(ctx, tx);
  for (let intento = 0; intento < 20; intento++) {
    const base = String(randomInt(0, 10_000_000)).padStart(7, "0");
    const codigo = `${prefijo}${base}${digitoLuhn(base)}`;
    if (reservados.has(codigo)) continue;
    if (!(await duenioDeCodigo(tx, codigo))) return codigo;
  }
  throw new Error("No se pudo generar un código interno único tras 20 intentos.");
}

/** ¿Es un código generado por el sistema (y no uno de fábrica)? Puro: recibe el prefijo ya leído. */
export function esCodigoInterno(codigo: string | null, prefijo: string): boolean {
  if (!codigo || !codigo.startsWith(prefijo)) return false;
  const m = /^(\d{7})(\d)$/.exec(codigo.slice(prefijo.length));
  return m !== null && digitoLuhn(m[1]!) === Number(m[2]);
}

/** Asigna un código interno a los sabores del panel que no tienen código (los demás no se tocan). */
export async function asignarCodigosInternos(
  ctx: Ctx,
  varianteIds: string[],
): Promise<{ asignados: { varianteId: string; codigo: string }[] }> {
  return transaccion(ctx, async (tx) => {
    const sinCodigo = await tx.variante.findMany({
      where: { id: { in: varianteIds }, deletedAt: null, codigoBarras: null },
      select: { id: true },
    });
    const reservados = new Set<string>();
    const asignados: { varianteId: string; codigo: string }[] = [];
    for (const v of sinCodigo) {
      const codigo = await generarCodigoInterno(ctx, tx, reservados);
      reservados.add(codigo);
      await tx.variante.update({ where: { id: v.id }, data: { codigoBarras: codigo } });
      asignados.push({ varianteId: v.id, codigo });
    }
    if (asignados.length) {
      await registrarAuditoria(tx, {
        usuarioId: ctx.usuarioId,
        accion: AccionAuditoria.UPDATE,
        entidad: "Variante",
        datosDespues: { cambio: "codigo_interno", asignados },
        meta: ctx.meta,
      });
    }
    return { asignados };
  });
}

// =============================================================================
// VarianteEncontrada: la forma que usan escáner, POS, compras y carga de stock
// =============================================================================

const selectEncontrada = {
  id: true,
  nombre: true,
  sku: true,
  codigoBarras: true,
  precioVenta: true,
  ultimoCosto: true,
  stockMinimo: true,
  activo: true,
  producto: {
    select: {
      id: true,
      nombre: true,
      especificacion: true,
      nombreCompleto: true,
      precioVenta: true,
      imagenUrl: true,
      activo: true,
      marcaId: true,
      marca: { select: { nombre: true } },
      categoria: { select: { nombre: true } },
    },
  },
  stocks: { select: { depositoId: true, cantidad: true } },
  // Los depósitos activos del panel de la variante (el mismo del ctx): así el
  // stock sale con todos los galpones (0 donde no hay fila) en la misma query.
  panel: {
    select: {
      depositos: {
        where: { activo: true },
        orderBy: [{ esPrincipal: "desc" }, { nombre: "asc" }],
        select: { id: true, nombre: true, esPrincipal: true },
      },
    },
  },
} satisfies Prisma.VarianteSelect;

type FilaEncontrada = Prisma.VarianteGetPayload<{ select: typeof selectEncontrada }>;

function aEncontrada(
  v: FilaEncontrada,
  opciones: { codigoBuscado?: string | null; conCosto: boolean; depositoId?: string },
): VarianteEncontrada {
  const porDeposito = new Map(v.stocks.map((s) => [s.depositoId, s.cantidad]));
  const stockPorDeposito: StockEnDeposito[] = v.panel.depositos.map((d) => ({
    depositoId: d.id,
    nombre: d.nombre,
    esPrincipal: d.esPrincipal,
    cantidad: porDeposito.get(d.id) ?? 0,
  }));
  const p = v.producto;
  return {
    varianteId: v.id,
    productoId: p.id,
    nombreCompleto: p.nombreCompleto,
    sabor: saborVisible(v.nombre),
    titulo: nombreConSabor(p.nombreCompleto, v.nombre),
    marca: p.marca.nombre,
    marcaId: p.marcaId,
    modelo: p.nombre,
    especificacion: p.especificacion,
    categoria: p.categoria?.nombre ?? null,
    imagenUrl: p.imagenUrl,
    sku: v.sku,
    codigoBarras: v.codigoBarras,
    precioVenta: dec(precioVentaEfectivo(v, p)),
    precioVentaProducto: dec(p.precioVenta),
    tienePrecioPropio: tienePrecioPropio(v),
    ultimoCosto: opciones.conCosto && v.ultimoCosto !== null ? dec(v.ultimoCosto) : null,
    stockMinimo: v.stockMinimo,
    stockPorDeposito,
    stockTotal: stockPorDeposito.reduce((a, s) => a + s.cantidad, 0),
    stockEnDeposito: opciones.depositoId ? (porDeposito.get(opciones.depositoId) ?? 0) : null,
    activo: v.activo && p.activo,
    porCodigoAlternativo:
      opciones.codigoBuscado != null && v.codigoBarras !== opciones.codigoBuscado,
  };
}

/**
 * Busca un sabor DEL PANEL por código de barras principal o alternativo.
 * El código se normaliza igual que lo guarda la DB, así que es una igualdad
 * exacta sobre índices únicos. Con relationLoadStrategy "join", variante +
 * producto + marca + categoría + stock + depósitos salen en UNA query.
 */
export async function buscarPorCodigo(
  ctx: CtxCatalogo,
  codigo: string,
): Promise<VarianteEncontrada | null> {
  const c = normalizarCodigo(codigo);
  if (!c) return null;
  const v = await dbPara(ctx.panelId).variante.findFirst({
    relationLoadStrategy: "join",
    where: {
      deletedAt: null,
      producto: { deletedAt: null },
      OR: [{ codigoBarras: c }, { codigosAlternativos: { some: { codigo: c } } }],
    },
    select: selectEncontrada,
  });
  return v ? aEncontrada(v, { codigoBuscado: c, conCosto: veCosto(ctx) }) : null;
}

/** Sabores del panel por id, en el orden pedido (los que no existen se omiten). */
export async function obtenerVariantesPorId(
  ctx: CtxCatalogo,
  ids: string[],
  depositoId?: string,
): Promise<VarianteEncontrada[]> {
  if (ids.length === 0) return [];
  const filas = await dbPara(ctx.panelId).variante.findMany({
    relationLoadStrategy: "join",
    where: { id: { in: ids }, deletedAt: null, producto: { deletedAt: null } },
    select: selectEncontrada,
  });
  const conCosto = veCosto(ctx);
  const porId = new Map(filas.map((v) => [v.id, v]));
  return ids.flatMap((id) => {
    const v = porId.get(id);
    return v ? [aEncontrada(v, { conCosto, depositoId })] : [];
  });
}

/** Un sabor por id (null si no existe en el panel). */
export async function obtenerVarianteEncontrada(
  ctx: CtxCatalogo,
  id: string,
): Promise<VarianteEncontrada | null> {
  return (await obtenerVariantesPorId(ctx, [id]))[0] ?? null;
}

/**
 * Buscador manual de sabores del panel (carga de stock, POS, compras,
 * movimientos): código exacto primero; si no, cada palabra tiene que aparecer
 * en el nombre completo del producto, el sabor o el SKU ("elf mango").
 */
export async function buscarVariantes(
  ctx: CtxCatalogo,
  q: string,
  opciones: {
    depositoId?: string;
    limite?: number;
    soloConStockEnDeposito?: boolean;
    incluirInactivas?: boolean;
  } = {},
): Promise<VarianteEncontrada[]> {
  const texto = q.trim();
  if (texto.length === 0) return [];
  const db = dbPara(ctx.panelId);
  const base: Prisma.VarianteWhereInput = {
    deletedAt: null,
    producto: { deletedAt: null, ...(opciones.incluirInactivas ? {} : { activo: true }) },
    ...(opciones.incluirInactivas ? {} : { activo: true }),
  };

  let where: Prisma.VarianteWhereInput | null = null;
  if (pareceCodigo(texto)) {
    const c = normalizarCodigoBarras(texto);
    const porCodigo: Prisma.VarianteWhereInput = {
      ...base,
      OR: [{ codigoBarras: c }, { codigosAlternativos: { some: { codigo: c } } }],
    };
    if ((await db.variante.count({ where: porCodigo })) > 0) where = porCodigo;
  }
  if (!where) {
    const palabras = texto.split(/\s+/).filter(Boolean).slice(0, 6);
    where = {
      ...base,
      AND: palabras.map((w) => ({
        OR: [
          { nombre: { contains: w, mode: "insensitive" as const } },
          { sku: { contains: w, mode: "insensitive" as const } },
          { producto: { nombreCompleto: { contains: w, mode: "insensitive" as const } } },
        ],
      })),
    };
  }
  if (opciones.soloConStockEnDeposito && opciones.depositoId) {
    where = {
      ...where,
      stocks: { some: { depositoId: opciones.depositoId, cantidad: { gt: 0 } } },
    };
  }
  const filas = await db.variante.findMany({
    relationLoadStrategy: "join",
    where,
    take: opciones.limite ?? 20,
    orderBy: [{ producto: { nombreCompleto: "asc" } }, { nombre: "asc" }],
    select: selectEncontrada,
  });
  const conCosto = veCosto(ctx);
  return filas.map((v) => aEncontrada(v, { conCosto, depositoId: opciones.depositoId }));
}

// =============================================================================
// Marca / producto por clave (marca + modelo + especificación)
// =============================================================================

/** Marca del panel por nombre (sin distinguir mayúsculas). Si no existe y `crear`, la crea. */
async function marcaPorNombre(
  tx: Tx,
  ctx: Ctx,
  nombre: string,
): Promise<{ id: string; nombre: string }> {
  const limpio = colapsarEspacios(nombre);
  const existente = await tx.marca.findFirst({
    where: { nombre: { equals: limpio, mode: "insensitive" } },
    select: { id: true, nombre: true, activo: true },
  });
  if (existente) {
    if (!existente.activo)
      await tx.marca.update({ where: { id: existente.id }, data: { activo: true } });
    return { id: existente.id, nombre: existente.nombre };
  }
  const marca = await tx.marca.create({
    data: { nombre: limpio },
    select: { id: true, nombre: true },
  });
  await registrarAuditoria(tx, {
    usuarioId: ctx.usuarioId,
    accion: AccionAuditoria.CREATE,
    entidad: "Marca",
    entidadId: marca.id,
    datosDespues: { nombre: marca.nombre },
    meta: ctx.meta,
  });
  return marca;
}

/** "Mismo producto": misma marca, mismo modelo (sin distinguir mayúsculas) y misma especificación normalizada. */
function whereClave(
  marcaId: string,
  modelo: string,
  especificacion: string,
): Prisma.ProductoWhereInput {
  return {
    marcaId,
    nombre: { equals: colapsarEspacios(modelo), mode: "insensitive" },
    especificacionNorm: normalizarEspecificacion(especificacion),
  };
}

export interface ProductoParaAlta {
  id: string;
  nombreCompleto: string;
  marca: string;
  modelo: string;
  especificacion: string;
  precioVenta: string;
  activo: boolean;
  /** Sabores vivos (sin "Único"). */
  sabores: string[];
}

const selectParaAlta = {
  id: true,
  nombreCompleto: true,
  nombre: true,
  especificacion: true,
  precioVenta: true,
  activo: true,
  marca: { select: { nombre: true } },
  variantes: { where: { deletedAt: null }, select: { nombre: true }, orderBy: { nombre: "asc" } },
} satisfies Prisma.ProductoSelect;

function aParaAlta(
  p: Prisma.ProductoGetPayload<{ select: typeof selectParaAlta }>,
): ProductoParaAlta {
  return {
    id: p.id,
    nombreCompleto: p.nombreCompleto,
    marca: p.marca.nombre,
    modelo: p.nombre,
    especificacion: p.especificacion,
    precioVenta: dec(p.precioVenta),
    activo: p.activo,
    sabores: p.variantes.flatMap((v) => (saborVisible(v.nombre) ? [v.nombre] : [])),
  };
}

/** ¿Ya existe marca + modelo + especificación en el panel? (el Sheet de alta rápida lo detecta). */
export async function productoPorClave(
  ctx: Pick<Ctx, "panelId">,
  clave: { marca: string; modelo: string; especificacion: string },
): Promise<ProductoParaAlta | null> {
  const db = dbPara(ctx.panelId);
  const marca = await db.marca.findFirst({
    where: { nombre: { equals: colapsarEspacios(clave.marca), mode: "insensitive" } },
    select: { id: true },
  });
  if (!marca) return null;
  const p = await db.producto.findFirst({
    where: { ...whereClave(marca.id, clave.modelo, clave.especificacion), deletedAt: null },
    select: selectParaAlta,
  });
  return p ? aParaAlta(p) : null;
}

/** Autocompletar del alta rápida: marcas y productos del panel que coinciden con el texto. */
export async function buscarParaAltaRapida(
  ctx: Pick<Ctx, "panelId">,
  q: string,
): Promise<{ marcas: string[]; productos: ProductoParaAlta[] }> {
  const db = dbPara(ctx.panelId);
  const texto = q.trim();
  const palabras = texto.split(/\s+/).filter(Boolean).slice(0, 6);
  const [marcas, productos] = await Promise.all([
    db.marca.findMany({
      where: texto ? { nombre: { contains: texto, mode: "insensitive" } } : {},
      orderBy: [{ activo: "desc" }, { nombre: "asc" }],
      take: texto ? 10 : 200,
      select: { nombre: true },
    }),
    texto
      ? db.producto.findMany({
          where: {
            deletedAt: null,
            AND: palabras.map((w) => ({
              nombreCompleto: { contains: w, mode: "insensitive" as const },
            })),
          },
          orderBy: { nombreCompleto: "asc" },
          take: 8,
          select: selectParaAlta,
        })
      : Promise.resolve([]),
  ]);
  return { marcas: marcas.map((m) => m.nombre), productos: productos.map(aParaAlta) };
}

// =============================================================================
// Alta rápida (código desconocido escaneado)
// =============================================================================

/**
 * Código desconocido → sabor listo para la lista de carga:
 * - si marca + modelo + especificación ya existe, agrega el sabor con el
 *   código (si el sabor ya existe, le asigna el código: principal si no
 *   tenía, alternativo si ya tenía uno);
 * - si no, crea el producto (y la marca si hace falta) con ese sabor.
 * El sabor usa el precio del producto salvo que `precioVentaSabor` (o un
 * `precioVenta` distinto en un producto existente) indique uno propio.
 */
export async function altaRapida(ctx: Ctx, input: AltaRapida): Promise<VarianteEncontrada> {
  const codigo = normalizarCodigo(input.codigoBarras);
  if (!codigo)
    throw new DomainError("Código de barras inválido", "VALIDATION_ERROR", 400, {
      codigoBarras: ["Código inválido"],
    });
  const nombreVariante = input.sabor ? colapsarEspacios(input.sabor) : NOMBRE_VARIANTE_UNICA;

  const varianteId = await transaccion(ctx, async (tx) => {
    const duenio = await duenioDeCodigo(tx, codigo);
    if (duenio) {
      const msg = `El código ${codigo} ya pertenece a ${duenio.nombre}`;
      throw new DomainError(msg, "CODIGO_EN_USO", 409, { codigoBarras: [msg] });
    }
    const marca = await marcaPorNombre(tx, ctx, input.marca);
    const existente = await tx.producto.findFirst({
      where: { ...whereClave(marca.id, input.modelo, input.especificacion), deletedAt: null },
      select: {
        id: true,
        precioVenta: true,
        activo: true,
        variantes: {
          select: { id: true, nombre: true, codigoBarras: true, deletedAt: true },
        },
      },
    });

    if (!existente) {
      if (input.precioVenta === undefined) {
        throw new DomainError("Poné el precio de venta", "VALIDATION_ERROR", 400, {
          precioVenta: ["Poné el precio de venta"],
        });
      }
      const producto = await tx.producto.create({
        data: {
          marcaId: marca.id,
          nombre: colapsarEspacios(input.modelo),
          especificacion: input.especificacion,
          precioVenta: input.precioVenta,
          variantes: {
            create: {
              nombre: nombreVariante,
              sku: await generarSku(tx),
              codigoBarras: codigo,
              precioVenta: precioPropio(input.precioVentaSabor, input.precioVenta),
            },
          },
        },
        select: { id: true, nombreCompleto: true, variantes: { select: { id: true } } },
      });
      await registrarAuditoria(tx, {
        usuarioId: ctx.usuarioId,
        accion: AccionAuditoria.CREATE,
        entidad: "Producto",
        entidadId: producto.id,
        datosDespues: {
          origen: "alta_rapida",
          nombreCompleto: producto.nombreCompleto,
          sabor: nombreVariante,
          codigo,
          precioVenta: dec(input.precioVenta),
        },
        meta: ctx.meta,
      });
      return producto.variantes[0]!.id;
    }

    // Producto existente: el sabor.
    if (!existente.activo)
      await tx.producto.update({ where: { id: existente.id }, data: { activo: true } });
    const propio = precioPropio(input.precioVentaSabor ?? input.precioVenta, existente.precioVenta);
    const mismo = existente.variantes.find(
      (v) => v.nombre.toLocaleLowerCase("es") === nombreVariante.toLocaleLowerCase("es"),
    );
    const vivas = existente.variantes.filter((v) => v.deletedAt === null);
    let id: string;
    if (mismo && mismo.deletedAt === null) {
      id = mismo.id;
      if (mismo.codigoBarras === null) {
        await tx.variante.update({ where: { id }, data: { codigoBarras: codigo } });
      } else {
        await tx.codigoBarrasAlternativo.create({
          data: { varianteId: id, codigo, descripcion: "Alta rápida desde el escáner" },
        });
      }
    } else if (mismo) {
      id = mismo.id;
      await tx.variante.update({
        where: { id },
        data: { deletedAt: null, activo: true, codigoBarras: codigo, precioVenta: propio },
      });
    } else if (
      // Producto sin sabores que recién recibe el primero: la variante "Único" (vacía) pasa a ser ese sabor.
      nombreVariante !== NOMBRE_VARIANTE_UNICA &&
      vivas.length === 1 &&
      vivas[0]!.nombre === NOMBRE_VARIANTE_UNICA &&
      vivas[0]!.codigoBarras === null &&
      (await tx.stock.count({ where: { varianteId: vivas[0]!.id, cantidad: { not: 0 } } })) === 0
    ) {
      id = vivas[0]!.id;
      await tx.variante.update({
        where: { id },
        data: { nombre: nombreVariante, codigoBarras: codigo, precioVenta: propio },
      });
    } else {
      const v = await tx.variante.create({
        data: {
          productoId: existente.id,
          nombre: nombreVariante,
          sku: await generarSku(tx),
          codigoBarras: codigo,
          precioVenta: propio,
        },
        select: { id: true },
      });
      id = v.id;
    }
    await registrarAuditoria(tx, {
      usuarioId: ctx.usuarioId,
      accion: AccionAuditoria.UPDATE,
      entidad: "Producto",
      entidadId: existente.id,
      datosDespues: {
        origen: "alta_rapida",
        varianteId: id,
        sabor: nombreVariante,
        codigo,
        precioPropio: propio ? dec(propio) : null,
      },
      meta: ctx.meta,
    });
    return id;
  }).catch((error: unknown) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
      throw new ConflictError("Ese sabor o código ya existe en este producto.");
    throw error;
  });

  const v = await obtenerVarianteEncontrada(ctx, varianteId);
  if (!v) throw new NotFoundError("No se encontró el sabor recién creado");
  return v;
}

// =============================================================================
// Crear / actualizar / desactivar (formulario completo)
// =============================================================================

async function assertCategoria(tx: Tx, categoriaId: string | undefined, actual?: string | null) {
  if (!categoriaId || categoriaId === actual) return;
  const c = await tx.categoria.findUnique({ where: { id: categoriaId }, select: { activo: true } });
  if (!c || !c.activo)
    throw new DomainError("La categoría no existe o está inactiva", "VALIDATION_ERROR", 400, {
      categoriaId: ["La categoría no existe o está inactiva"],
    });
}

async function assertClaveLibre(
  tx: Tx,
  marcaId: string,
  input: Pick<Producto, "modelo" | "especificacion">,
  excluirId?: string,
) {
  const otro = await tx.producto.findFirst({
    where: {
      ...whereClave(marcaId, input.modelo, input.especificacion),
      ...(excluirId ? { id: { not: excluirId } } : {}),
    },
    select: { nombreCompleto: true, deletedAt: true },
  });
  if (otro) {
    const msg = otro.deletedAt
      ? `Ya existió "${otro.nombreCompleto}" (dado de baja): usá otro modelo o especificación`
      : `Ya existe "${otro.nombreCompleto}"`;
    throw new ConflictError(msg, { modelo: [msg] });
  }
}

async function assertCodigos(tx: Tx, sabores: Producto["sabores"]) {
  for (const [i, s] of sabores.entries()) {
    if (!s.codigoBarras) continue;
    const duenio = await duenioDeCodigo(tx, s.codigoBarras, s.id);
    if (duenio) {
      const msg = `El código ${s.codigoBarras} ya pertenece a ${duenio.nombre}`;
      throw new DomainError(msg, "CODIGO_EN_USO", 409, { [`sabores.${i}.codigoBarras`]: [msg] });
    }
  }
}

const selectSnapshot = {
  nombreCompleto: true,
  marcaId: true,
  nombre: true,
  especificacion: true,
  categoriaId: true,
  precioVenta: true,
  imagenUrl: true,
  activo: true,
  variantes: {
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      nombre: true,
      sku: true,
      codigoBarras: true,
      precioVenta: true,
      stockMinimo: true,
      activo: true,
      deletedAt: true,
    },
  },
} satisfies Prisma.ProductoSelect;

function snapshot(p: Prisma.ProductoGetPayload<{ select: typeof selectSnapshot }>) {
  return {
    nombreCompleto: p.nombreCompleto,
    marcaId: p.marcaId,
    modelo: p.nombre,
    especificacion: p.especificacion,
    categoriaId: p.categoriaId,
    precioVenta: dec(p.precioVenta),
    imagenUrl: p.imagenUrl,
    activo: p.activo,
    sabores: p.variantes.map((v) => ({
      id: v.id,
      nombre: v.nombre,
      sku: v.sku,
      codigoBarras: v.codigoBarras,
      precioVenta: v.precioVenta === null ? null : dec(v.precioVenta),
      stockMinimo: v.stockMinimo,
      activo: v.activo,
      eliminado: v.deletedAt !== null,
    })),
  } satisfies Prisma.InputJsonObject;
}

function mapearUnico(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
    throw new ConflictError("Hay sabores, SKU o códigos repetidos.");
  throw error;
}

/**
 * Crea producto + sabores. Una sola fila sin sabor = producto sin sabores
 * (variante "Único"). La marca se crea si no existe. SKU automático.
 */
export async function crear(
  ctx: Ctx,
  input: Producto,
): Promise<{
  id: string;
  variantes: { id: string; nombre: string; codigoBarras: string | null }[];
}> {
  return transaccion(ctx, async (tx) => {
    const marca = await marcaPorNombre(tx, ctx, input.marca);
    await assertCategoria(tx, input.categoriaId);
    await assertClaveLibre(tx, marca.id, input);
    await assertCodigos(tx, input.sabores);

    const reservados = new Set<string>();
    const variantes: Prisma.VarianteCreateWithoutProductoInput[] = [];
    for (const s of input.sabores) {
      const sku = await generarSku(tx, reservados);
      reservados.add(sku);
      variantes.push({
        nombre: s.nombre,
        sku,
        codigoBarras: s.codigoBarras ?? null,
        precioVenta: precioPropio(s.precioVenta, input.precioVenta),
        stockMinimo: s.stockMinimo,
        activo: s.activo,
      } as Prisma.VarianteCreateWithoutProductoInput);
    }
    const producto = await tx.producto.create({
      data: {
        marcaId: marca.id,
        nombre: input.modelo,
        especificacion: input.especificacion,
        categoriaId: input.categoriaId ?? null,
        precioVenta: input.precioVenta,
        imagenUrl: input.imagenUrl ?? null,
        activo: input.activo,
        variantes: { create: variantes },
      },
      select: { id: true, ...selectSnapshot },
    });
    await registrarAuditoria(tx, {
      usuarioId: ctx.usuarioId,
      accion: AccionAuditoria.CREATE,
      entidad: "Producto",
      entidadId: producto.id,
      datosDespues: snapshot(producto),
      meta: ctx.meta,
    });
    return {
      id: producto.id,
      variantes: producto.variantes.map((v) => ({
        id: v.id,
        nombre: v.nombre,
        codigoBarras: v.codigoBarras,
      })),
    };
  }).catch(mapearUnico);
}

/**
 * Actualiza el producto y sincroniza sus sabores:
 * - con id: se actualizan; sin id: se crean (o se reactiva uno dado de baja con ese nombre);
 * - los que faltan: soft delete (nunca DELETE físico), solo si no tienen stock.
 */
export async function actualizar(ctx: Ctx, id: string, input: Producto): Promise<{ id: string }> {
  return transaccion(
    ctx,
    async (tx) => {
      const antes = await tx.producto.findFirst({
        where: { id, deletedAt: null },
        select: selectSnapshot,
      });
      if (!antes) throw new NotFoundError("El producto no existe o fue dado de baja");

      const marca = await marcaPorNombre(tx, ctx, input.marca);
      await assertCategoria(tx, input.categoriaId, antes.categoriaId);
      await assertClaveLibre(tx, marca.id, input, id);

      const vivas = antes.variantes.filter((v) => v.deletedAt === null);
      const porId = new Map(vivas.map((v) => [v.id, v]));
      for (const s of input.sabores) {
        if (s.id && !porId.has(s.id))
          throw new DomainError("Uno de los sabores no pertenece a este producto");
      }

      // 1) Sabores quitados: soft delete (libera el código). Solo sin stock.
      const quedan = new Set(input.sabores.flatMap((s) => (s.id ? [s.id] : [])));
      const quitadas = vivas.filter((v) => !quedan.has(v.id));
      if (quitadas.length > 0) {
        const stocks = await tx.stock.groupBy({
          by: ["varianteId"],
          where: { varianteId: { in: quitadas.map((v) => v.id) } },
          _sum: { cantidad: true },
        });
        const conStock = stocks.find((s) => (s._sum.cantidad ?? 0) > 0);
        if (conStock) {
          const v = quitadas.find((q) => q.id === conStock.varianteId)!;
          throw new DomainError(
            `No se puede quitar "${v.nombre}": tiene ${conStock._sum.cantidad} unidades en stock.`,
          );
        }
        await tx.variante.updateMany({
          where: { id: { in: quitadas.map((v) => v.id) } },
          data: { deletedAt: new Date(), activo: false, codigoBarras: null },
        });
      }

      // 2) Liberar los códigos que cambian (permite pasar un código de un sabor a otro).
      for (const s of input.sabores) {
        const actual = s.id ? porId.get(s.id) : undefined;
        if (actual?.codigoBarras && actual.codigoBarras !== (s.codigoBarras ?? null))
          await tx.variante.update({ where: { id: actual.id }, data: { codigoBarras: null } });
      }
      await assertCodigos(tx, input.sabores);

      await tx.producto.update({
        where: { id },
        data: {
          marcaId: marca.id,
          nombre: input.modelo,
          especificacion: input.especificacion,
          categoriaId: input.categoriaId ?? null,
          precioVenta: input.precioVenta,
          imagenUrl: input.imagenUrl ?? null,
          activo: input.activo,
        },
      });

      // 3) Existentes, reactivados y nuevos.
      const reservados = new Set<string>();
      for (const s of input.sabores) {
        const datos = {
          nombre: s.nombre,
          codigoBarras: s.codigoBarras ?? null,
          precioVenta: precioPropio(s.precioVenta, input.precioVenta),
          stockMinimo: s.stockMinimo,
          activo: s.activo,
        };
        const actual = s.id ? porId.get(s.id) : undefined;
        if (actual) {
          await tx.variante.update({ where: { id: actual.id }, data: datos });
          continue;
        }
        const eliminada = antes.variantes.find(
          (v) => v.deletedAt !== null && v.nombre === s.nombre,
        );
        if (eliminada) {
          await tx.variante.update({
            where: { id: eliminada.id },
            data: { ...datos, deletedAt: null },
          });
          continue;
        }
        const sku = await generarSku(tx, reservados);
        reservados.add(sku);
        await tx.variante.create({ data: { ...datos, productoId: id, sku } });
      }

      const despues = await tx.producto.findUniqueOrThrow({
        where: { id },
        select: selectSnapshot,
      });
      await registrarAuditoria(tx, {
        usuarioId: ctx.usuarioId,
        accion: AccionAuditoria.UPDATE,
        entidad: "Producto",
        entidadId: id,
        datosAntes: snapshot(antes),
        datosDespues: snapshot(despues),
        meta: ctx.meta,
      });
      return { id };
    },
    { timeout: 30_000 },
  ).catch(mapearUnico);
}

/** Desactiva el producto (deja de venderse y de reconocerse como activo). Su stock e historial quedan. */
export async function desactivar(ctx: Ctx, id: string): Promise<void> {
  await transaccion(ctx, async (tx) => {
    const p = await tx.producto.findFirst({
      where: { id, deletedAt: null },
      select: { nombreCompleto: true, activo: true },
    });
    if (!p) throw new NotFoundError("El producto no existe o fue dado de baja");
    if (!p.activo) return;
    await tx.producto.update({ where: { id }, data: { activo: false } });
    await registrarAuditoria(tx, {
      usuarioId: ctx.usuarioId,
      accion: AccionAuditoria.UPDATE,
      entidad: "Producto",
      entidadId: id,
      datosAntes: { activo: true },
      datosDespues: { activo: false, nombreCompleto: p.nombreCompleto },
      meta: ctx.meta,
    });
  });
}

// =============================================================================
// Códigos alternativos
// =============================================================================

export async function agregarCodigoAlternativo(
  ctx: Ctx,
  varianteId: string,
  codigo: string,
  descripcion: string | undefined,
): Promise<CodigoAlternativoDTO> {
  const c = normalizarCodigo(codigo);
  if (!c)
    throw new DomainError("Código de barras inválido", "VALIDATION_ERROR", 400, {
      codigo: ["Código inválido"],
    });
  return transaccion(ctx, async (tx) => {
    const v = await tx.variante.findFirst({
      where: { id: varianteId, deletedAt: null },
      select: { id: true },
    });
    if (!v) throw new NotFoundError("El sabor no existe");
    const duenio = await duenioDeCodigo(tx, c);
    if (duenio) {
      const msg = `El código ${c} ya pertenece a ${duenio.nombre}`;
      throw new DomainError(msg, "CODIGO_EN_USO", 409, { codigo: [msg] });
    }
    const alt = await tx.codigoBarrasAlternativo.create({
      data: { varianteId, codigo: c, descripcion: descripcion ?? null },
    });
    await registrarAuditoria(tx, {
      usuarioId: ctx.usuarioId,
      accion: AccionAuditoria.CREATE,
      entidad: "CodigoBarrasAlternativo",
      entidadId: alt.id,
      datosDespues: { varianteId, codigo: c, descripcion: descripcion ?? null },
      meta: ctx.meta,
    });
    return { id: alt.id, codigo: alt.codigo, descripcion: alt.descripcion };
  });
}

export async function quitarCodigoAlternativo(ctx: Ctx, id: string): Promise<void> {
  await transaccion(ctx, async (tx) => {
    const alt = await tx.codigoBarrasAlternativo.findUnique({ where: { id } });
    if (!alt) throw new NotFoundError("El código alternativo no existe");
    await tx.codigoBarrasAlternativo.delete({ where: { id } });
    await registrarAuditoria(tx, {
      usuarioId: ctx.usuarioId,
      accion: AccionAuditoria.DELETE,
      entidad: "CodigoBarrasAlternativo",
      entidadId: id,
      datosAntes: { varianteId: alt.varianteId, codigo: alt.codigo, descripcion: alt.descripcion },
      meta: ctx.meta,
    });
  });
}

// =============================================================================
// Lectura: listado y ficha
// =============================================================================

const selectSabor = {
  id: true,
  nombre: true,
  sku: true,
  codigoBarras: true,
  precioVenta: true,
  stockMinimo: true,
  activo: true,
  stocks: { select: { depositoId: true, cantidad: true } },
} satisfies Prisma.VarianteSelect;

const selectProducto = {
  id: true,
  nombreCompleto: true,
  nombre: true,
  especificacion: true,
  precioVenta: true,
  activo: true,
  imagenUrl: true,
  marcaId: true,
  marca: { select: { nombre: true } },
  categoria: { select: { nombre: true } },
} satisfies Prisma.ProductoSelect;

function aSabor(
  v: Prisma.VarianteGetPayload<{ select: typeof selectSabor }>,
  precioProducto: Prisma.Decimal,
): SaborListado {
  const stockPorDeposito: Record<string, number> = {};
  for (const s of v.stocks) stockPorDeposito[s.depositoId] = s.cantidad;
  const stockTotal = v.stocks.reduce((a, s) => a + s.cantidad, 0);
  return {
    id: v.id,
    nombre: v.nombre,
    sabor: saborVisible(v.nombre),
    sku: v.sku,
    codigoBarras: v.codigoBarras,
    precioVenta: dec(precioVentaEfectivo(v, { precioVenta: precioProducto })),
    tienePrecioPropio: tienePrecioPropio(v),
    stockMinimo: v.stockMinimo,
    activo: v.activo,
    stockPorDeposito,
    stockTotal,
    estado: estadoStock(stockTotal, v.stockMinimo),
  };
}

function resumir(
  p: Prisma.ProductoGetPayload<{ select: typeof selectProducto }>,
  sabores: SaborListado[],
): Omit<ProductoListado, "sabores"> {
  const activos = sabores.filter((s) => s.activo);
  const stockPorDeposito: Record<string, number> = {};
  for (const s of sabores)
    for (const [dep, n] of Object.entries(s.stockPorDeposito))
      stockPorDeposito[dep] = (stockPorDeposito[dep] ?? 0) + n;
  const total = sabores.reduce((a, s) => a + s.stockTotal, 0);
  const bajo = activos.filter((s) => s.estado !== "OK").length;
  return {
    id: p.id,
    nombreCompleto: p.nombreCompleto,
    marca: p.marca.nombre,
    marcaId: p.marcaId,
    modelo: p.nombre,
    especificacion: p.especificacion,
    categoria: p.categoria?.nombre ?? null,
    precioVenta: dec(p.precioVenta),
    activo: p.activo,
    imagenUrl: p.imagenUrl,
    sinSabores: sabores.length === 1 && sabores[0]!.sabor === null,
    stockPorDeposito,
    stockTotal: total,
    estado: total <= 0 ? "SIN_STOCK" : bajo > 0 ? "BAJO" : "OK",
    saboresBajoMinimo: bajo,
  };
}

async function whereListado(
  ctx: Pick<Ctx, "panelId">,
  f: Pick<FiltrosProductos, "q" | "marcaId" | "soloBajoMinimo" | "inactivos">,
): Promise<Prisma.ProductoWhereInput> {
  const db = dbPara(ctx.panelId);
  const where: Prisma.ProductoWhereInput = { deletedAt: null, activo: !f.inactivos };
  if (f.marcaId) where.marcaId = f.marcaId;
  const and: Prisma.ProductoWhereInput[] = [];
  if (f.q) {
    const q = f.q.trim();
    let porCodigo: string[] = [];
    if (pareceCodigo(q)) {
      const c = normalizarCodigoBarras(q);
      const vs = await db.variante.findMany({
        where: {
          deletedAt: null,
          OR: [{ codigoBarras: c }, { codigosAlternativos: { some: { codigo: c } } }],
        },
        select: { productoId: true },
      });
      porCodigo = vs.map((v) => v.productoId);
    }
    if (porCodigo.length > 0) {
      and.push({ id: { in: porCodigo } });
    } else {
      // Cada palabra en el nombre completo o en algún sabor / SKU / código ("elf mango").
      for (const w of q.split(/\s+/).filter(Boolean).slice(0, 6)) {
        const contiene = { contains: w, mode: "insensitive" as const };
        and.push({
          OR: [
            { nombreCompleto: contiene },
            {
              variantes: {
                some: {
                  deletedAt: null,
                  OR: [
                    { nombre: contiene },
                    { sku: contiene },
                    { codigoBarras: { contains: w.toUpperCase() } },
                  ],
                },
              },
            },
          ],
        });
      }
    }
  }
  if (f.soloBajoMinimo) {
    const alertas = await db.$queryRaw<{ producto_id: string }[]>`
      SELECT DISTINCT producto_id FROM vw_alertas_stock WHERE panel_id = ${ctx.panelId}`;
    and.push({ id: { in: alertas.map((a) => a.producto_id) } });
  }
  if (and.length) where.AND = and;
  return where;
}

/** Listado paginado del panel: búsqueda por nombre completo, sabor, SKU o código; marca; bajo mínimo. */
export async function listar(
  ctx: CtxCatalogo,
  filtros: FiltrosProductos,
): Promise<{ productos: ProductoListado[]; total: number; page: number; pageSize: number }> {
  const db = dbPara(ctx.panelId);
  const where = await whereListado(ctx, filtros);
  const [total, filas] = await Promise.all([
    db.producto.count({ where }),
    db.producto.findMany({
      where,
      orderBy: [{ nombreCompleto: "asc" }, { id: "asc" }],
      skip: (filtros.page - 1) * filtros.pageSize,
      take: filtros.pageSize,
      select: {
        ...selectProducto,
        variantes: { where: { deletedAt: null }, orderBy: { nombre: "asc" }, select: selectSabor },
      },
    }),
  ]);
  const productos = filas.map((p) => {
    const sabores = p.variantes.map((v) => aSabor(v, p.precioVenta));
    return { ...resumir(p, sabores), sabores };
  });
  return { productos, total, page: filtros.page, pageSize: filtros.pageSize };
}

/** Ficha completa (también la usa el formulario de edición). */
export async function obtener(ctx: CtxCatalogo, id: string): Promise<ProductoDetalle> {
  const conCosto = veCosto(ctx);
  const p = await dbPara(ctx.panelId).producto.findFirst({
    where: { id, deletedAt: null },
    select: {
      ...selectProducto,
      categoriaId: true,
      variantes: {
        where: { deletedAt: null },
        orderBy: { nombre: "asc" },
        select: {
          ...selectSabor,
          ultimoCosto: true,
          codigosAlternativos: {
            select: { id: true, codigo: true, descripcion: true },
            orderBy: { createdAt: "asc" },
          },
        },
      },
    },
  });
  if (!p) throw new NotFoundError("El producto no existe o fue dado de baja");
  const sabores: SaborDetalle[] = p.variantes.map((v) => ({
    ...aSabor(v, p.precioVenta),
    precioPropio: v.precioVenta === null ? null : dec(v.precioVenta),
    ultimoCosto: conCosto && v.ultimoCosto !== null ? dec(v.ultimoCosto) : null,
    codigosAlternativos: v.codigosAlternativos,
  }));
  return { ...resumir(p, sabores), categoriaId: p.categoriaId, sabores };
}

export { listar as listarProductos, obtener as obtenerProducto };

// =============================================================================
// Carga de stock por escaneo
// =============================================================================

export interface ResumenCargaStock {
  /** Galpón de ingreso: el elegido en el paso 1 (o, sin él, el que más recibió). */
  deposito: { id: string; nombre: string };
  unidades: number;
  items: {
    varianteId: string;
    titulo: string;
    cantidad: number;
    /** Stock del sabor en los galpones que recibieron, antes y después de la carga. */
    stockAnterior: number;
    stockPosterior: number;
    /** Cuánto fue a cada galpón. */
    distribucion: { depositoId: string; nombre: string; cantidad: number }[];
  }[];
  /** Unidades cargadas en cada galpón ("150 a Ayres Plaza · 50 a Mercedes"), mayor primero. */
  cargadoPorDeposito: { depositoId: string; nombre: string; unidades: number }[];
  /** Unidades de los sabores cargados en cada galpón activo, después de la carga. */
  porDeposito: { depositoId: string; nombre: string; unidades: number }[];
}

type EntradaCarga = CargarStock["items"][number];

/**
 * Normaliza la carga a (variante, depósito) → cantidad. Un item simple va
 * entero al galpón de ingreso (`depositoId`); uno distribuido, a cada galpón
 * de su distribución. Un sabor escaneado en dos tandas (o el mismo galpón
 * repetido) se suma. Valida cantidades > 0 y, si el item trae lo escaneado,
 * que la distribución sume exactamente eso.
 */
function normalizarCarga(
  depositoIngreso: string | undefined,
  items: EntradaCarga[],
  titulo: (varianteId: string) => string,
): Map<string, Map<string, number>> {
  const porVariante = new Map<string, Map<string, number>>();
  const sumar = (varianteId: string, depositoId: string, cantidad: number) => {
    if (!Number.isSafeInteger(cantidad) || cantidad <= 0)
      throw new DomainError(`${titulo(varianteId)}: cada cantidad tiene que ser mayor a 0`);
    const m = porVariante.get(varianteId) ?? new Map<string, number>();
    m.set(depositoId, (m.get(depositoId) ?? 0) + cantidad);
    porVariante.set(varianteId, m);
  };
  for (const item of items) {
    if ("distribucion" in item) {
      const suma = item.distribucion.reduce((a, d) => a + d.cantidad, 0);
      if (item.cantidad !== undefined && suma !== item.cantidad)
        throw new DomainError(
          `${titulo(item.varianteId)}: la distribución suma ${suma} y se escanearon ${item.cantidad}`,
          "DISTRIBUCION_INVALIDA",
        );
      for (const d of item.distribucion) sumar(item.varianteId, d.depositoId, d.cantidad);
    } else {
      if (!depositoIngreso) throw new DomainError(MENSAJE_SIN_GALPON, "SIN_GALPON");
      sumar(item.varianteId, depositoIngreso, item.cantidad);
    }
  }
  return porVariante;
}

/**
 * Ingreso manual de lo escaneado, en el galpón de ingreso o repartido entre
 * galpones (paso "Distribuir"). Cada depósito tiene que ser un depósito
 * activo del panel. Registra un INGRESO_MANUAL por (sabor, depósito), todo en
 * una transacción (si algo falla, no se carga nada). Firma vieja
 * (`depositoId` + items con cantidad) = una sola entrada en la distribución.
 */
export async function cargarStockPorEscaneo(
  ctx: Ctx,
  input: {
    depositoId?: string | null;
    items: EntradaCarga[];
    motivo?: string;
  },
): Promise<ResumenCargaStock> {
  const depositoIngreso = input.depositoId?.trim() || undefined;
  const distribuidos = input.items.some((i) => "distribucion" in i);
  if (!depositoIngreso && !distribuidos) throw new DomainError(MENSAJE_SIN_GALPON, "SIN_GALPON");
  if (input.items.length === 0) throw new DomainError("No hay nada para cargar");

  return transaccion(
    ctx,
    async (tx) => {
      const variantes = await tx.variante.findMany({
        where: {
          id: { in: [...new Set(input.items.map((i) => i.varianteId))] },
          deletedAt: null,
          producto: { deletedAt: null },
        },
        select: { id: true, nombre: true, producto: { select: { nombreCompleto: true } } },
      });
      const porId = new Map(variantes.map((v) => [v.id, v]));
      const titulo = (id: string) => {
        const v = porId.get(id);
        return v ? nombreConSabor(v.producto.nombreCompleto, v.nombre) : "Un producto";
      };
      const carga = normalizarCarga(depositoIngreso, input.items, titulo);
      // Orden fijo por sabor y galpón: los bloqueos de Stock siempre en el mismo orden (sin deadlocks).
      const ids = [...carga.keys()].sort();
      if (ids.some((id) => !porId.has(id)))
        throw new NotFoundError("Alguno de los productos ya no existe. Quitalo de la lista.");

      const depositos = await tx.deposito.findMany({
        where: { activo: true },
        orderBy: [{ esPrincipal: "desc" }, { nombre: "asc" }],
        select: { id: true, nombre: true },
      });
      const activos = new Map(depositos.map((d) => [d.id, d]));
      if (depositoIngreso && !activos.has(depositoIngreso))
        throw new DomainError(MENSAJE_SIN_GALPON, "SIN_GALPON");
      for (const m of carga.values())
        for (const depositoId of m.keys())
          if (!activos.has(depositoId))
            throw new DomainError(
              "Alguno de los galpones de la distribución no existe o está inactivo",
              "SIN_GALPON",
            );

      const motivo = input.motivo ?? "Carga por escaneo";
      const items: ResumenCargaStock["items"] = [];
      const cargado = new Map<string, number>();
      for (const varianteId of ids) {
        const destinos = [...carga.get(varianteId)!.entries()].sort(([a], [b]) =>
          a.localeCompare(b),
        );
        let stockAnterior = 0;
        let stockPosterior = 0;
        for (const [depositoId, cantidad] of destinos) {
          const m = await registrarMovimiento(tx, {
            tipo: TipoMovimiento.INGRESO_MANUAL,
            varianteId,
            depositoId,
            cantidad,
            usuarioId: ctx.usuarioId,
            motivo,
          });
          stockAnterior += m.stockAnterior;
          stockPosterior += m.stockPosterior;
          cargado.set(depositoId, (cargado.get(depositoId) ?? 0) + cantidad);
        }
        items.push({
          varianteId,
          titulo: titulo(varianteId),
          cantidad: destinos.reduce((a, [, c]) => a + c, 0),
          stockAnterior,
          stockPosterior,
          distribucion: depositos
            .filter((d) => carga.get(varianteId)!.has(d.id))
            .map((d) => ({
              depositoId: d.id,
              nombre: d.nombre,
              cantidad: carga.get(varianteId)!.get(d.id)!,
            })),
        });
      }

      const cargadoPorDeposito = depositos
        .filter((d) => cargado.has(d.id))
        .map((d) => ({ depositoId: d.id, nombre: d.nombre, unidades: cargado.get(d.id)! }))
        .sort((a, b) => b.unidades - a.unidades);
      const ingreso = activos.get(depositoIngreso ?? "") ?? {
        id: cargadoPorDeposito[0]!.depositoId,
        nombre: cargadoPorDeposito[0]!.nombre,
      };
      const unidades = items.reduce((a, i) => a + i.cantidad, 0);

      await registrarAuditoria(tx, {
        usuarioId: ctx.usuarioId,
        accion: AccionAuditoria.CREATE,
        entidad: "IngresoManual",
        datosDespues: {
          origen: "carga-por-escaneo",
          depositoIngresoId: ingreso.id,
          motivo,
          unidades,
          items: items.map((i) => ({
            varianteId: i.varianteId,
            distribucion: i.distribucion.map((d) => ({
              depositoId: d.depositoId,
              cantidad: d.cantidad,
            })),
          })),
        },
        meta: ctx.meta,
      });

      const sumas = await tx.stock.groupBy({
        by: ["depositoId"],
        where: { varianteId: { in: ids } },
        _sum: { cantidad: true },
      });
      const suma = new Map(sumas.map((s) => [s.depositoId, s._sum.cantidad ?? 0]));
      return {
        deposito: { id: ingreso.id, nombre: ingreso.nombre },
        unidades,
        items,
        cargadoPorDeposito,
        porDeposito: depositos.map((d) => ({
          depositoId: d.id,
          nombre: d.nombre,
          unidades: suma.get(d.id) ?? 0,
        })),
      };
    },
    { timeout: 60_000 },
  );
}
