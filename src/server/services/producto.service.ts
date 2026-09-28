import { randomInt } from "node:crypto";

import { AccionAuditoria, Prisma, type RolUsuario, type Variante } from "@prisma/client";

import { CODIGO_BARRAS_REGEX, digitoLuhn, normalizarCodigoBarras } from "@/lib/barcode";
import { esOwner } from "@/lib/permisos";
import {
  NOMBRE_VARIANTE_UNICA,
  type FiltrosProductos,
  type Producto,
} from "@/lib/validations/producto";
import { dbPara, enTransaccion, transaccion, type Ctx, type Tx } from "@/server/db/panel-scoped";
import { ConflictError, DomainError, NotFoundError } from "@/server/errors";
import { registrarAuditoria } from "@/server/services/audit.service";

/**
 * CATÁLOGO DEL PANEL: productos, variantes (sabores), códigos de barras y precios.
 * Todo vive dentro del panel del `ctx`: SKU y códigos de barras son únicos
 * POR PANEL (el mismo EAN puede existir en otro panel).
 *
 * Convenciones de los DTO que salen de acá hacia la UI:
 * - Montos como string con 2 decimales ("9500.00"): Decimal no viaja a
 *   Client Components y un float perdería precisión.
 * - Stock por depósito como Record<depositoId, cantidad> (0 si no hay fila).
 * - `precioCosto` (y el margen) solo llegan si el ctx es de un OWNER: con un
 *   CtxPanel (requireCtx / requirePaginaPanel) se decide solo; con un ctx sin
 *   usuario, nunca se incluyen.
 */

/** Contexto de lectura: panel y, si se conoce, quién mira (para decidir si ve costos). */
export type CtxCatalogo = Pick<Ctx, "panelId"> & { usuario?: { rol: RolUsuario } };

/** Contexto de escritura del catálogo: si no es de un dueño, el costo del formulario se ignora. */
export type CtxEscrituraCatalogo = Ctx & { usuario?: { rol: RolUsuario } };

/** ¿Este ctx puede ver costos? Solo los dueños. */
export function veCosto(ctx: CtxCatalogo): boolean {
  return ctx.usuario !== undefined && esOwner(ctx.usuario);
}

// =============================================================================
// Tipos (DTO)
// =============================================================================

export type EstadoStock = "OK" | "BAJO" | "SIN_STOCK";

export function estadoStock(total: number, minimo: number): EstadoStock {
  if (total <= 0) return "SIN_STOCK";
  if (total < minimo) return "BAJO";
  return "OK";
}

export interface VarianteListada {
  id: string;
  nombre: string;
  sku: string;
  codigoBarras: string | null;
  /** null si quien mira no es dueño. */
  precioCosto: string | null;
  precioVenta: string;
  stockMinimo: number;
  activo: boolean;
  stockPorDeposito: Record<string, number>;
  stockTotal: number;
  estado: EstadoStock;
}

export interface ProductoListado {
  id: string;
  nombre: string;
  marca: string | null;
  categoria: string;
  activo: boolean;
  tieneVariantes: boolean;
  imagenUrl: string | null;
  variantes: VarianteListada[];
  stockTotal: number;
  stockPorDeposito: Record<string, number>;
  precioVentaMin: string | null;
  precioVentaMax: string | null;
  /** SIN_STOCK si no hay unidades; BAJO si algún sabor activo está bajo el mínimo; OK si no. */
  estado: EstadoStock;
  variantesBajoMinimo: number;
}

export interface CodigoAlternativoDTO {
  id: string;
  codigo: string;
  descripcion: string | null;
}

export interface VarianteDetalle extends VarianteListada {
  codigosAlternativos: CodigoAlternativoDTO[];
  /** Margen sobre el costo, en %. null si el costo es 0 o quien mira no es dueño. */
  margen: number | null;
}

export interface ProductoDetalle extends Omit<ProductoListado, "variantes"> {
  descripcion: string | null;
  categoriaId: string;
  marcaId: string | null;
  variantes: VarianteDetalle[];
}

/** Resultado de buscarPorCodigo(): todo lo que necesita el escáner / el POS. */
export interface VarianteEncontrada {
  varianteId: string;
  productoId: string;
  producto: string;
  variante: string;
  nombreCompleto: string;
  sku: string;
  codigoBarras: string | null;
  /** true si el código escaneado es un código alternativo de la variante. */
  porCodigoAlternativo: boolean;
  marca: string | null;
  categoria: string;
  imagenUrl: string | null;
  activo: boolean;
  /** null si quien mira no es dueño. */
  precioCosto: string | null;
  precioVenta: string;
  stockMinimo: number;
  stock: { depositoId: string; deposito: string; esPrincipal: boolean; cantidad: number }[];
  stockTotal: number;
}

// =============================================================================
// Helpers
// =============================================================================

const dec = (d: Prisma.Decimal | string | number) => new Prisma.Decimal(d).toFixed(2);

/** "Ignite V80 — Mango Ice", o solo el producto si no tiene variantes. */
export function nombreCompleto(
  producto: string,
  variante: string,
  tieneVariantes: boolean,
): string {
  return tieneVariantes ? `${producto} — ${variante}` : producto;
}

function margen(costo: Prisma.Decimal, venta: Prisma.Decimal): number | null {
  if (costo.isZero()) return null;
  return Number(venta.minus(costo).div(costo).mul(100).toFixed(1));
}

/** Normaliza un código de barras (sin espacios, mayúsculas). null si no tiene formato válido. */
export function normalizarCodigo(codigo: string): string | null {
  const c = normalizarCodigoBarras(codigo.trim());
  return CODIGO_BARRAS_REGEX.test(c) ? c : null;
}

// --- SKU ---------------------------------------------------------------------

const ALFABETO_SKU = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sin 0/O ni 1/I: se leen mal impresos
const LARGO_SKU = 6;

/** Prefijo de SKU del panel (Configuracion "prefijoSku", "PRD" por defecto). */
async function prefijoSku(tx: Tx, panelId: string): Promise<string> {
  const conf = await tx.configuracion.findFirst({ where: { panelId, clave: "prefijoSku" } });
  return typeof conf?.valor === "string" && conf.valor.trim() !== ""
    ? conf.valor.trim().toUpperCase()
    : "PRD";
}

/** Genera un SKU libre en el panel con formato `{prefijoSku}-XXXXXX`. */
export async function generarSku(
  tx: Tx,
  panelId: string,
  reservados: ReadonlySet<string> = new Set(),
): Promise<string> {
  const prefijo = await prefijoSku(tx, panelId);
  for (let intento = 0; intento < 20; intento++) {
    const sufijo = Array.from(
      { length: LARGO_SKU },
      () => ALFABETO_SKU[randomInt(ALFABETO_SKU.length)],
    ).join("");
    const sku = `${prefijo}-${sufijo}`;
    if (reservados.has(sku)) continue;
    const existe = await tx.variante.findFirst({ where: { panelId, sku }, select: { id: true } });
    if (!existe) return sku;
  }
  throw new Error("No se pudo generar un SKU único tras 20 intentos.");
}

async function assertSkuDisponible(
  tx: Tx,
  panelId: string,
  sku: string,
  excluirVarianteId?: string,
): Promise<void> {
  const v = await tx.variante.findFirst({
    where: { panelId, sku },
    select: {
      id: true,
      nombre: true,
      producto: { select: { nombre: true, tieneVariantes: true } },
    },
  });
  if (v && v.id !== excluirVarianteId) {
    throw new ConflictError(
      `El SKU ${sku} ya pertenece a ${nombreCompleto(v.producto.nombre, v.nombre, v.producto.tieneVariantes)}`,
    );
  }
}

// --- Códigos de barras -------------------------------------------------------

interface DuenioCodigo {
  varianteId: string;
  nombre: string;
}

/** ¿De quién es este código EN EL PANEL? Busca en código principal (variantes vivas) y alternativos. */
async function duenioDeCodigo(
  tx: Tx,
  panelId: string,
  codigo: string,
  excluirVarianteId?: string,
): Promise<DuenioCodigo | null> {
  const seleccion = {
    id: true,
    nombre: true,
    producto: { select: { nombre: true, tieneVariantes: true } },
  } as const;
  const [principal, alternativo] = await Promise.all([
    tx.variante.findFirst({
      where: {
        panelId,
        codigoBarras: codigo,
        deletedAt: null,
        ...(excluirVarianteId ? { id: { not: excluirVarianteId } } : {}),
      },
      select: seleccion,
    }),
    tx.codigoBarrasAlternativo.findFirst({
      where: { panelId, codigo },
      select: { variante: { select: seleccion } },
    }),
  ]);
  const v = principal ?? alternativo?.variante;
  return v
    ? {
        varianteId: v.id,
        nombre: nombreCompleto(v.producto.nombre, v.nombre, v.producto.tieneVariantes),
      }
    : null;
}

/** Lanza DomainError("El código X ya pertenece a {producto} — {variante}") si está usado en el panel. */
export async function assertCodigoDisponible(
  ctx: Pick<Ctx, "panelId">,
  codigo: string,
  excluirVarianteId?: string,
  tx: Tx = dbPara(ctx.panelId),
): Promise<void> {
  const duenio = await duenioDeCodigo(tx, ctx.panelId, codigo, excluirVarianteId);
  if (duenio)
    throw new DomainError(
      `El código ${codigo} ya pertenece a ${duenio.nombre}`,
      "CODIGO_EN_USO",
      409,
    );
}

/** Para validación en vivo del formulario (con debounce). */
export async function verificarCodigoDisponible(
  ctx: Pick<Ctx, "panelId">,
  codigo: string,
  excluirVarianteId?: string,
): Promise<{ disponible: true } | { disponible: false; mensaje: string }> {
  const c = normalizarCodigo(codigo);
  if (!c) return { disponible: false, mensaje: "Código de barras inválido" };
  const duenio = await duenioDeCodigo(dbPara(ctx.panelId), ctx.panelId, c, excluirVarianteId);
  return duenio
    ? { disponible: false, mensaje: `Ya pertenece a ${duenio.nombre}` }
    : { disponible: true };
}

// =============================================================================
// buscarPorCodigo — la función que usa el escáner (cientos de veces por día)
// =============================================================================

const selectEncontrada = {
  id: true,
  nombre: true,
  sku: true,
  codigoBarras: true,
  precioCosto: true,
  precioVenta: true,
  stockMinimo: true,
  activo: true,
  producto: {
    select: {
      id: true,
      nombre: true,
      tieneVariantes: true,
      imagenUrl: true,
      activo: true,
      marca: { select: { nombre: true } },
      categoria: { select: { nombre: true } },
    },
  },
  stocks: {
    where: { deposito: { activo: true } },
    select: {
      cantidad: true,
      deposito: { select: { id: true, nombre: true, esPrincipal: true } },
    },
  },
} satisfies Prisma.VarianteSelect;

function aEncontrada(
  v: Prisma.VarianteGetPayload<{ select: typeof selectEncontrada }>,
  codigoBuscado: string | null,
  conCosto: boolean,
): VarianteEncontrada {
  const stock = v.stocks
    .map((s) => ({
      depositoId: s.deposito.id,
      deposito: s.deposito.nombre,
      esPrincipal: s.deposito.esPrincipal,
      cantidad: s.cantidad,
    }))
    .sort(
      (a, b) =>
        Number(b.esPrincipal) - Number(a.esPrincipal) || a.deposito.localeCompare(b.deposito),
    );

  return {
    varianteId: v.id,
    productoId: v.producto.id,
    producto: v.producto.nombre,
    variante: v.nombre,
    nombreCompleto: nombreCompleto(v.producto.nombre, v.nombre, v.producto.tieneVariantes),
    sku: v.sku,
    codigoBarras: v.codigoBarras,
    porCodigoAlternativo: codigoBuscado !== null && v.codigoBarras !== codigoBuscado,
    marca: v.producto.marca?.nombre ?? null,
    categoria: v.producto.categoria.nombre,
    imagenUrl: v.producto.imagenUrl,
    activo: v.activo && v.producto.activo,
    precioCosto: conCosto ? dec(v.precioCosto) : null,
    precioVenta: dec(v.precioVenta),
    stockMinimo: v.stockMinimo,
    stock,
    stockTotal: stock.reduce((acc, s) => acc + s.cantidad, 0),
  };
}

/**
 * Busca una variante DEL PANEL por código de barras principal o alternativo.
 * El código se normaliza (trim, sin espacios, mayúsculas) y la DB lo guarda
 * igual, así que la búsqueda es una igualdad exacta que usa los índices
 * únicos. Con relationLoadStrategy "join" Prisma resuelve variante + producto
 * + marca + categoría + stock + depósitos en UNA sola query.
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
  return v ? aEncontrada(v, c, veCosto(ctx)) : null;
}

/** Misma forma que buscarPorCodigo pero por id (ej: volver al escáner después de crear el producto). */
export async function obtenerVarianteEncontrada(
  ctx: CtxCatalogo,
  id: string,
): Promise<VarianteEncontrada | null> {
  const v = await dbPara(ctx.panelId).variante.findFirst({
    relationLoadStrategy: "join",
    where: { id, deletedAt: null, producto: { deletedAt: null } },
    select: selectEncontrada,
  });
  return v ? aEncontrada(v, v.codigoBarras, veCosto(ctx)) : null;
}

// =============================================================================
// Códigos internos (Code128) para productos sin código de fábrica
// =============================================================================

/** Prefijo de los códigos internos del panel: el de los SKU, solo letras y números. */
export async function prefijoCodigoInterno(
  ctx: Pick<Ctx, "panelId">,
  tx: Tx = dbPara(ctx.panelId),
): Promise<string> {
  return (await prefijoSku(tx, ctx.panelId)).replace(/[^A-Z0-9]/g, "") || "PRD";
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
    if (!(await duenioDeCodigo(tx, ctx.panelId, codigo))) return codigo;
  }
  throw new Error("No se pudo generar un código interno único tras 20 intentos.");
}

/** ¿Es un código generado por el sistema (y no uno de fábrica)? Puro: recibe el prefijo ya leído. */
export function esCodigoInterno(codigo: string | null, prefijo: string): boolean {
  if (!codigo || !codigo.startsWith(prefijo)) return false;
  const m = /^(\d{7})(\d)$/.exec(codigo.slice(prefijo.length));
  return m !== null && digitoLuhn(m[1]!) === Number(m[2]);
}

/**
 * Asigna un código interno a las variantes del panel que no tienen código de
 * barras (las que ya tienen uno no se tocan).
 */
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
// Crear / actualizar producto
// =============================================================================

async function assertClasificacionActiva(tx: Tx, categoriaId: string, marcaId: string | undefined) {
  const [categoria, marca] = await Promise.all([
    tx.categoria.findUnique({ where: { id: categoriaId }, select: { activo: true } }),
    marcaId
      ? tx.marca.findUnique({ where: { id: marcaId }, select: { activo: true } })
      : Promise.resolve(null),
  ]);
  if (!categoria)
    throw new DomainError("La categoría no existe", "VALIDATION_ERROR", 400, {
      categoriaId: ["La categoría no existe"],
    });
  if (!categoria.activo)
    throw new DomainError("La categoría está inactiva", "VALIDATION_ERROR", 400, {
      categoriaId: ["La categoría está inactiva"],
    });
  if (marcaId && !marca)
    throw new DomainError("La marca no existe", "VALIDATION_ERROR", 400, {
      marcaId: ["La marca no existe"],
    });
  if (marca && !marca.activo)
    throw new DomainError("La marca está inactiva", "VALIDATION_ERROR", 400, {
      marcaId: ["La marca está inactiva"],
    });
}

/** Nombre único por marca entre productos vivos del panel (NULL en marca incluido, que el índice no cubre). */
async function assertNombreDisponible(
  tx: Tx,
  nombre: string,
  marcaId: string | undefined,
  excluirId?: string,
) {
  const existente = await tx.producto.findFirst({
    where: {
      nombre: { equals: nombre, mode: "insensitive" },
      marcaId: marcaId ?? null,
      deletedAt: null,
      ...(excluirId ? { id: { not: excluirId } } : {}),
    },
    select: { id: true },
  });
  if (existente) {
    throw new ConflictError("Ya existe un producto con ese nombre para esa marca", {
      nombre: ["Ya existe un producto con ese nombre para esa marca"],
    });
  }
}

/** Valida códigos y SKUs de las variantes contra el panel, con el error en el campo correcto. */
async function assertCodigosYSkus(tx: Tx, panelId: string, variantes: Producto["variantes"]) {
  for (const [i, v] of variantes.entries()) {
    if (v.codigoBarras) {
      const duenio = await duenioDeCodigo(tx, panelId, v.codigoBarras, v.id);
      if (duenio) {
        const msg = `El código ${v.codigoBarras} ya pertenece a ${duenio.nombre}`;
        throw new DomainError(msg, "CODIGO_EN_USO", 409, {
          [`variantes.${i}.codigoBarras`]: [msg],
        });
      }
    }
    if (v.sku) {
      try {
        await assertSkuDisponible(tx, panelId, v.sku, v.id);
      } catch (e) {
        if (e instanceof ConflictError)
          throw new ConflictError(e.message, { [`variantes.${i}.sku`]: [e.message] });
        throw e;
      }
    }
  }
}

function snapshotProducto(p: {
  nombre: string;
  categoriaId: string;
  marcaId: string | null;
  activo: boolean;
  tieneVariantes: boolean;
  variantes: Pick<
    Variante,
    | "id"
    | "nombre"
    | "sku"
    | "codigoBarras"
    | "precioCosto"
    | "precioVenta"
    | "stockMinimo"
    | "activo"
    | "deletedAt"
  >[];
}): Prisma.InputJsonObject {
  return {
    nombre: p.nombre,
    categoriaId: p.categoriaId,
    marcaId: p.marcaId,
    activo: p.activo,
    tieneVariantes: p.tieneVariantes,
    variantes: p.variantes.map((v) => ({
      id: v.id,
      nombre: v.nombre,
      sku: v.sku,
      codigoBarras: v.codigoBarras,
      precioCosto: dec(v.precioCosto),
      precioVenta: dec(v.precioVenta),
      stockMinimo: v.stockMinimo,
      activo: v.activo,
      eliminada: v.deletedAt !== null,
    })),
  };
}

/**
 * Crea Producto + Variantes en el panel. Sin variantes => una sola variante
 * "Único". SKU autogenerado si no viene. Registra AuditLog CREATE.
 * Un empleado no ve ni carga costos: sus productos nuevos arrancan con costo 0.
 */
export async function crearProducto(
  ctx: CtxEscrituraCatalogo,
  input: Producto,
): Promise<{
  id: string;
  variantes: { id: string; nombre: string; codigoBarras: string | null }[];
}> {
  const conCosto = veCosto(ctx);
  try {
    return await transaccion(ctx, async (tx) => {
      await assertClasificacionActiva(tx, input.categoriaId, input.marcaId);
      await assertNombreDisponible(tx, input.nombre, input.marcaId);
      await assertCodigosYSkus(tx, ctx.panelId, input.variantes);

      const reservados = new Set(input.variantes.flatMap((v) => (v.sku ? [v.sku] : [])));
      const variantes = [];
      for (const v of input.variantes) {
        const sku = v.sku ?? (await generarSku(tx, ctx.panelId, reservados));
        reservados.add(sku);
        variantes.push({
          nombre: input.tieneVariantes ? v.nombre : NOMBRE_VARIANTE_UNICA,
          sku,
          codigoBarras: v.codigoBarras ?? null,
          precioCosto: conCosto ? (v.precioCosto ?? 0) : 0,
          precioVenta: v.precioVenta,
          stockMinimo: v.stockMinimo,
          activo: v.activo,
        });
      }

      const producto = await tx.producto.create({
        data: {
          nombre: input.nombre,
          descripcion: input.descripcion ?? null,
          categoriaId: input.categoriaId,
          marcaId: input.marcaId ?? null,
          imagenUrl: input.imagenUrl ?? null,
          activo: input.activo,
          tieneVariantes: input.tieneVariantes,
          variantes: { create: variantes },
        },
        include: { variantes: { orderBy: { createdAt: "asc" } } },
      });

      await registrarAuditoria(tx, {
        usuarioId: ctx.usuarioId,
        accion: AccionAuditoria.CREATE,
        entidad: "Producto",
        entidadId: producto.id,
        datosDespues: snapshotProducto(producto),
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
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ConflictError(
        "Ya existe un producto o variante con esos datos (nombre, SKU o código).",
      );
    }
    throw error;
  }
}

/**
 * Actualiza el producto y sincroniza sus variantes:
 * - con id: se actualizan (precio incluido: update simple, queda en la auditoría);
 * - sin id: se crean (si coincide con una variante dada de baja, se reactiva);
 * - las que faltan: soft delete (deletedAt + activo=false), nunca DELETE físico.
 *   Si tienen stock > 0 no se pueden quitar: primero hay que ajustarlo o transferirlo.
 * Si quien edita no es dueño, el costo existente no se toca.
 */
export async function actualizarProducto(
  ctx: CtxEscrituraCatalogo,
  id: string,
  input: Producto,
): Promise<{ id: string }> {
  const conCosto = veCosto(ctx);
  const costoDe = (v: Producto["variantes"][number], actual?: Prisma.Decimal) =>
    conCosto && v.precioCosto !== undefined ? v.precioCosto : (actual ?? 0);
  try {
    return await transaccion(
      ctx,
      async (tx) => {
        const antes = await tx.producto.findFirst({
          where: { id, deletedAt: null },
          include: { variantes: { orderBy: { createdAt: "asc" } } },
        });
        if (!antes) throw new NotFoundError("El producto no existe o fue dado de baja");

        await assertClasificacionActiva(tx, input.categoriaId, input.marcaId);
        await assertNombreDisponible(tx, input.nombre, input.marcaId, id);

        const vivas = antes.variantes.filter((v) => v.deletedAt === null);
        const porId = new Map(vivas.map((v) => [v.id, v]));
        for (const v of input.variantes) {
          if (v.id && !porId.has(v.id))
            throw new DomainError("Una de las variantes no pertenece a este producto");
        }

        // 1) Variantes quitadas: soft delete (libera su código de barras). Sin stock.
        const idsQueQuedan = new Set(input.variantes.flatMap((v) => (v.id ? [v.id] : [])));
        const quitadas = vivas.filter((v) => !idsQueQuedan.has(v.id));
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
              `No se puede quitar "${v.nombre}": tiene ${conStock._sum.cantidad} unidades en stock. Ajustalo a 0 o transferilo primero.`,
            );
          }
          await tx.variante.updateMany({
            where: { id: { in: quitadas.map((v) => v.id) } },
            data: { deletedAt: new Date(), activo: false },
          });
        }

        // 2) Liberar códigos que cambian (permite mover un código de una variante a otra).
        for (const v of input.variantes) {
          const actual = v.id ? porId.get(v.id) : undefined;
          if (actual && actual.codigoBarras && actual.codigoBarras !== (v.codigoBarras ?? null)) {
            await tx.variante.update({ where: { id: actual.id }, data: { codigoBarras: null } });
          }
        }

        // 3) Validar contra el panel ya con los códigos liberados.
        await assertCodigosYSkus(tx, ctx.panelId, input.variantes);

        await tx.producto.update({
          where: { id },
          data: {
            nombre: input.nombre,
            descripcion: input.descripcion ?? null,
            categoriaId: input.categoriaId,
            marcaId: input.marcaId ?? null,
            imagenUrl: input.imagenUrl ?? null,
            activo: input.activo,
            tieneVariantes: input.tieneVariantes,
          },
        });

        // 4) Actualizar existentes y crear/reactivar nuevas.
        const reservados = new Set(input.variantes.flatMap((v) => (v.sku ? [v.sku] : [])));
        for (const v of input.variantes) {
          const nombre = input.tieneVariantes ? v.nombre : NOMBRE_VARIANTE_UNICA;
          const actual = v.id ? porId.get(v.id) : undefined;
          if (actual) {
            await tx.variante.update({
              where: { id: actual.id },
              data: {
                nombre,
                sku: v.sku ?? actual.sku,
                codigoBarras: v.codigoBarras ?? null,
                precioCosto: costoDe(v, actual.precioCosto),
                precioVenta: v.precioVenta,
                stockMinimo: v.stockMinimo,
                activo: v.activo,
              },
            });
            continue;
          }
          const eliminada = antes.variantes.find(
            (x) => x.deletedAt !== null && x.nombre === nombre,
          );
          if (eliminada) {
            await tx.variante.update({
              where: { id: eliminada.id },
              data: {
                deletedAt: null,
                activo: v.activo,
                sku: v.sku ?? eliminada.sku,
                codigoBarras: v.codigoBarras ?? null,
                precioCosto: costoDe(v, eliminada.precioCosto),
                precioVenta: v.precioVenta,
                stockMinimo: v.stockMinimo,
              },
            });
            continue;
          }
          const sku = v.sku ?? (await generarSku(tx, ctx.panelId, reservados));
          reservados.add(sku);
          await tx.variante.create({
            data: {
              productoId: id,
              nombre,
              sku,
              codigoBarras: v.codigoBarras ?? null,
              precioCosto: costoDe(v),
              precioVenta: v.precioVenta,
              stockMinimo: v.stockMinimo,
              activo: v.activo,
            },
          });
        }

        const despues = await tx.producto.findUniqueOrThrow({
          where: { id },
          include: { variantes: { orderBy: { createdAt: "asc" } } },
        });
        await registrarAuditoria(tx, {
          usuarioId: ctx.usuarioId,
          accion: AccionAuditoria.UPDATE,
          entidad: "Producto",
          entidadId: id,
          datosAntes: snapshotProducto(antes),
          datosDespues: snapshotProducto(despues),
          meta: ctx.meta,
        });
        return { id };
      },
      { timeout: 30_000 },
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ConflictError("Hay nombres de variante, SKU o códigos repetidos.");
    }
    throw error;
  }
}

/** Soft delete del producto completo (solo si no tiene stock). */
export async function darDeBajaProducto(ctx: Ctx, id: string): Promise<void> {
  await transaccion(ctx, async (tx) => {
    const p = await tx.producto.findFirst({
      where: { id, deletedAt: null },
      select: { nombre: true },
    });
    if (!p) throw new NotFoundError("El producto no existe o ya fue dado de baja");
    const stock = await tx.stock.aggregate({
      where: { variante: { productoId: id } },
      _sum: { cantidad: true },
    });
    const unidades = stock._sum.cantidad ?? 0;
    if (unidades > 0) {
      throw new DomainError(
        `"${p.nombre}" tiene ${unidades} unidades en stock: no se puede dar de baja. Desactivalo o ajustá el stock a 0.`,
      );
    }
    const ahora = new Date();
    await tx.producto.update({ where: { id }, data: { deletedAt: ahora, activo: false } });
    await tx.variante.updateMany({
      where: { productoId: id, deletedAt: null },
      data: { deletedAt: ahora, activo: false },
    });
    await registrarAuditoria(tx, {
      usuarioId: ctx.usuarioId,
      accion: AccionAuditoria.DELETE,
      entidad: "Producto",
      entidadId: id,
      datosAntes: { nombre: p.nombre },
      meta: ctx.meta,
    });
  });
}

// =============================================================================
// Precios (update simple + auditoría)
// =============================================================================

/**
 * Actualiza precios de una o varias variantes del panel (queda en AuditLog con
 * los valores anteriores). Si recibe `tx`, corre dentro de esa transacción
 * (ej: al recibir una compra con "actualizar costo").
 */
export async function actualizarPrecios(
  ctx: Ctx,
  varianteIds: string | string[],
  precios: { precioCosto?: number; precioVenta?: number },
  motivo?: string,
  tx?: Tx,
): Promise<{ actualizadas: number }> {
  const ids = Array.isArray(varianteIds) ? varianteIds : [varianteIds];
  return enTransaccion(ctx, tx, async (t) => {
    const variantes = await t.variante.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: { id: true, precioCosto: true, precioVenta: true },
    });
    if (variantes.length !== ids.length)
      throw new NotFoundError("Alguna de las variantes no existe");
    const antes: { id: string; precioCosto: string; precioVenta: string }[] = [];
    for (const v of variantes) {
      const costo = new Prisma.Decimal(precios.precioCosto ?? v.precioCosto).toDecimalPlaces(2);
      const venta = new Prisma.Decimal(precios.precioVenta ?? v.precioVenta).toDecimalPlaces(2);
      if (costo.equals(v.precioCosto) && venta.equals(v.precioVenta)) continue;
      await t.variante.update({
        where: { id: v.id },
        data: { precioCosto: costo, precioVenta: venta },
      });
      antes.push({ id: v.id, precioCosto: dec(v.precioCosto), precioVenta: dec(v.precioVenta) });
    }
    if (antes.length > 0) {
      await registrarAuditoria(t, {
        usuarioId: ctx.usuarioId,
        accion: AccionAuditoria.UPDATE,
        entidad: "Variante",
        entidadId: antes.length === 1 ? antes[0]!.id : null,
        datosAntes: { variantes: antes },
        datosDespues: {
          cambio: "precios",
          varianteIds: antes.map((a) => a.id),
          precioCosto: precios.precioCosto ?? null,
          precioVenta: precios.precioVenta ?? null,
          motivo: motivo ?? null,
        },
        meta: ctx.meta,
      });
    }
    return { actualizadas: antes.length };
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
    if (!v) throw new NotFoundError("La variante no existe");
    const duenio = await duenioDeCodigo(tx, ctx.panelId, c);
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
// Lectura: listado, ficha, búsqueda de variantes
// =============================================================================

const selectVarianteConStock = {
  id: true,
  nombre: true,
  sku: true,
  codigoBarras: true,
  precioCosto: true,
  precioVenta: true,
  stockMinimo: true,
  activo: true,
  stocks: { select: { depositoId: true, cantidad: true } },
} satisfies Prisma.VarianteSelect;

type VarianteConStock = Prisma.VarianteGetPayload<{ select: typeof selectVarianteConStock }>;

function aVarianteListada(v: VarianteConStock, conCosto: boolean): VarianteListada {
  const stockPorDeposito: Record<string, number> = {};
  for (const s of v.stocks) stockPorDeposito[s.depositoId] = s.cantidad;
  const stockTotal = v.stocks.reduce((acc, s) => acc + s.cantidad, 0);
  return {
    id: v.id,
    nombre: v.nombre,
    sku: v.sku,
    codigoBarras: v.codigoBarras,
    precioCosto: conCosto ? dec(v.precioCosto) : null,
    precioVenta: dec(v.precioVenta),
    stockMinimo: v.stockMinimo,
    activo: v.activo,
    stockPorDeposito,
    stockTotal,
    estado: estadoStock(stockTotal, v.stockMinimo),
  };
}

function resumirProducto(
  p: {
    id: string;
    nombre: string;
    activo: boolean;
    tieneVariantes: boolean;
    imagenUrl: string | null;
    marca: { nombre: string } | null;
    categoria: { nombre: string };
  },
  variantes: VarianteListada[],
) {
  const activas = variantes.filter((v) => v.activo);
  const stockPorDeposito: Record<string, number> = {};
  for (const v of variantes)
    for (const [dep, n] of Object.entries(v.stockPorDeposito))
      stockPorDeposito[dep] = (stockPorDeposito[dep] ?? 0) + n;
  const precios = activas.map((v) => new Prisma.Decimal(v.precioVenta));
  const min = precios.length ? Prisma.Decimal.min(...precios) : null;
  const max = precios.length ? Prisma.Decimal.max(...precios) : null;
  // Estado del PRODUCTO: sin unidades → SIN_STOCK; con unidades pero algún
  // sabor activo bajo el mínimo (o en 0) → BAJO; si no, OK.
  const total = variantes.reduce((acc, v) => acc + v.stockTotal, 0);
  const estado: EstadoStock =
    total <= 0
      ? "SIN_STOCK"
      : (activas.length ? activas : variantes).some((v) => v.estado !== "OK")
        ? "BAJO"
        : "OK";
  return {
    id: p.id,
    nombre: p.nombre,
    marca: p.marca?.nombre ?? null,
    categoria: p.categoria.nombre,
    activo: p.activo,
    tieneVariantes: p.tieneVariantes,
    imagenUrl: p.imagenUrl,
    stockTotal: total,
    stockPorDeposito,
    precioVentaMin: min ? dec(min) : null,
    precioVentaMax: max ? dec(max) : null,
    estado,
    variantesBajoMinimo: activas.filter((v) => v.estado !== "OK").length,
  };
}

/** ¿El texto parece un código de barras (y no un nombre)? */
function pareceCodigo(q: string): boolean {
  return /^[0-9A-Za-z-]{4,64}$/.test(q) && /\d/.test(q);
}

async function whereProductos(
  ctx: Pick<Ctx, "panelId">,
  filtros: Omit<FiltrosProductos, "page" | "pageSize" | "orden">,
): Promise<Prisma.ProductoWhereInput> {
  const db = dbPara(ctx.panelId);
  const where: Prisma.ProductoWhereInput = { deletedAt: null };
  if (filtros.estado === "activos") where.activo = true;
  if (filtros.estado === "inactivos") where.activo = false;
  if (filtros.categoriaId) where.categoriaId = filtros.categoriaId;
  if (filtros.marcaId) where.marcaId = filtros.marcaId;

  const and: Prisma.ProductoWhereInput[] = [];
  if (filtros.q) {
    const q = filtros.q.trim();
    let porCodigo: string[] = [];
    if (pareceCodigo(q)) {
      // Código exacto primero (principal o alternativo).
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
      const contiene = { contains: q, mode: "insensitive" as const };
      and.push({
        OR: [
          { nombre: contiene },
          {
            variantes: {
              some: {
                deletedAt: null,
                OR: [
                  { nombre: contiene },
                  { sku: contiene },
                  { codigoBarras: { contains: q.toUpperCase() } },
                ],
              },
            },
          },
        ],
      });
    }
  }
  if (filtros.conStockBajo) {
    const alertas = await db.$queryRaw<{ producto_id: string }[]>`
      SELECT DISTINCT producto_id FROM vw_alertas_stock WHERE panel_id = ${ctx.panelId}`;
    and.push({ id: { in: alertas.map((a) => a.producto_id) } });
  }
  if (and.length) where.AND = and;
  return where;
}

const ORDEN_PRODUCTOS: Record<FiltrosProductos["orden"], Prisma.ProductoOrderByWithRelationInput> =
  {
    nombre: { nombre: "asc" },
    "-nombre": { nombre: "desc" },
    reciente: { createdAt: "desc" },
  };

/**
 * Listado paginado server-side del panel. Búsqueda por nombre, sabor, SKU o
 * código (si `q` parece un código, primero busca el código exacto).
 */
export async function listarProductos(
  ctx: CtxCatalogo,
  filtros: FiltrosProductos,
): Promise<{ productos: ProductoListado[]; total: number; page: number; pageSize: number }> {
  const db = dbPara(ctx.panelId);
  const conCosto = veCosto(ctx);
  const where = await whereProductos(ctx, filtros);
  const [total, filas] = await Promise.all([
    db.producto.count({ where }),
    db.producto.findMany({
      where,
      orderBy: [ORDEN_PRODUCTOS[filtros.orden], { id: "asc" }],
      skip: (filtros.page - 1) * filtros.pageSize,
      take: filtros.pageSize,
      select: {
        id: true,
        nombre: true,
        activo: true,
        tieneVariantes: true,
        imagenUrl: true,
        marca: { select: { nombre: true } },
        categoria: { select: { nombre: true } },
        variantes: {
          where: { deletedAt: null },
          orderBy: { nombre: "asc" },
          select: selectVarianteConStock,
        },
      },
    }),
  ]);
  const productos = filas.map((p) => {
    const variantes = p.variantes.map((v) => aVarianteListada(v, conCosto));
    return { ...resumirProducto(p, variantes), variantes };
  });
  return { productos, total, page: filtros.page, pageSize: filtros.pageSize };
}

/** Ficha completa (también la usa el formulario de edición). */
export async function obtenerProducto(ctx: CtxCatalogo, id: string): Promise<ProductoDetalle> {
  const conCosto = veCosto(ctx);
  const p = await dbPara(ctx.panelId).producto.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      nombre: true,
      descripcion: true,
      activo: true,
      tieneVariantes: true,
      imagenUrl: true,
      categoriaId: true,
      marcaId: true,
      marca: { select: { nombre: true } },
      categoria: { select: { nombre: true } },
      variantes: {
        where: { deletedAt: null },
        orderBy: { nombre: "asc" },
        select: {
          ...selectVarianteConStock,
          codigosAlternativos: {
            select: { id: true, codigo: true, descripcion: true },
            orderBy: { createdAt: "asc" },
          },
        },
      },
    },
  });
  if (!p) throw new NotFoundError("El producto no existe o fue dado de baja");
  const variantes: VarianteDetalle[] = p.variantes.map((v) => ({
    ...aVarianteListada(v, conCosto),
    codigosAlternativos: v.codigosAlternativos,
    margen: conCosto ? margen(v.precioCosto, v.precioVenta) : null,
  }));
  return {
    ...resumirProducto(p, variantes),
    descripcion: p.descripcion,
    categoriaId: p.categoriaId,
    marcaId: p.marcaId,
    variantes,
  };
}

export interface VarianteBuscada {
  id: string;
  nombreCompleto: string;
  sku: string;
  codigoBarras: string | null;
  /** null si quien mira no es dueño. */
  precioCosto: string | null;
  precioVenta: string;
  stockTotal: number;
  /** Stock en el depósito pedido (si se pidió uno). */
  stockDeposito: number | null;
}

const selectBuscada = {
  id: true,
  nombre: true,
  sku: true,
  codigoBarras: true,
  precioCosto: true,
  precioVenta: true,
  producto: { select: { nombre: true, tieneVariantes: true } },
  stocks: { select: { depositoId: true, cantidad: true } },
} satisfies Prisma.VarianteSelect;

function aBuscada(
  v: Prisma.VarianteGetPayload<{ select: typeof selectBuscada }>,
  conCosto: boolean,
  depositoId: string | undefined,
): VarianteBuscada {
  return {
    id: v.id,
    nombreCompleto: nombreCompleto(v.producto.nombre, v.nombre, v.producto.tieneVariantes),
    sku: v.sku,
    codigoBarras: v.codigoBarras,
    precioCosto: conCosto ? dec(v.precioCosto) : null,
    precioVenta: dec(v.precioVenta),
    stockTotal: v.stocks.reduce((a, s) => a + s.cantidad, 0),
    stockDeposito: depositoId
      ? (v.stocks.find((s) => s.depositoId === depositoId)?.cantidad ?? 0)
      : null,
  };
}

/**
 * Buscador de variantes del panel (ingresos, ajustes, transferencias, POS,
 * compras): código exacto primero, si no por texto.
 */
export async function buscarVariantes(
  ctx: CtxCatalogo,
  q: string,
  opciones: { depositoId?: string; limite?: number; soloConStockEnDeposito?: boolean } = {},
): Promise<VarianteBuscada[]> {
  const texto = q.trim();
  if (texto.length === 0) return [];
  const db = dbPara(ctx.panelId);
  const limite = opciones.limite ?? 20;
  const base: Prisma.VarianteWhereInput = {
    deletedAt: null,
    activo: true,
    producto: { deletedAt: null },
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
    const palabras = texto.split(/\s+/).filter(Boolean).slice(0, 5);
    // Cada palabra tiene que aparecer en producto, sabor o SKU ("ignite mango").
    where = {
      ...base,
      AND: palabras.map((w) => ({
        OR: [
          { nombre: { contains: w, mode: "insensitive" as const } },
          { sku: { contains: w, mode: "insensitive" as const } },
          { producto: { nombre: { contains: w, mode: "insensitive" as const } } },
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
    where,
    take: limite,
    orderBy: [{ producto: { nombre: "asc" } }, { nombre: "asc" }],
    select: selectBuscada,
  });
  const conCosto = veCosto(ctx);
  return filas.map((v) => aBuscada(v, conCosto, opciones.depositoId));
}

/** Datos mínimos de varias variantes del panel (para precargar formularios por id). */
export async function obtenerVariantesPorId(
  ctx: CtxCatalogo,
  ids: string[],
  depositoId?: string,
): Promise<VarianteBuscada[]> {
  if (ids.length === 0) return [];
  const filas = await dbPara(ctx.panelId).variante.findMany({
    where: { id: { in: ids }, deletedAt: null },
    select: selectBuscada,
  });
  const conCosto = veCosto(ctx);
  const porId = new Map(filas.map((v) => [v.id, v]));
  return ids.flatMap((id) => {
    const v = porId.get(id);
    return v ? [aBuscada(v, conCosto, depositoId)] : [];
  });
}
