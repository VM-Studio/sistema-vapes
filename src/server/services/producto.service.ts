import { randomInt } from "node:crypto";

import { AccionAuditoria, Prisma, type Variante } from "@prisma/client";

import { CODIGO_BARRAS_REGEX, digitoLuhn, normalizarCodigoBarras } from "@/lib/barcode";
import {
  aCSV,
  decodificarTexto,
  formatearDecimalAR,
  normalizarEncabezado,
  parsearCSV,
  parsearPrecioAR,
} from "@/lib/csv";
import { prisma, withTransaction, type Tx } from "@/lib/db";
import { monto } from "@/lib/validations/common";
import {
  NOMBRE_VARIANTE_UNICA,
  type AumentoPorcentual,
  type FiltrosProductos,
  type Producto,
} from "@/lib/validations/producto";
import { ConflictError, DomainError, NotFoundError } from "@/server/errors";
import type { Actor } from "@/server/services/actor";
import { registrarAuditoria } from "@/server/services/audit.service";
import { obtenerOCrearClasificacion } from "@/server/services/clasificacion.service";

/**
 * CATÁLOGO: productos, variantes (sabores), códigos de barras y precios.
 *
 * Convenciones de los DTO que salen de acá hacia la UI:
 * - Montos como string con 2 decimales ("9500.00"): Decimal no viaja a
 *   Client Components y un float perdería precisión.
 * - Stock por depósito como Record<depositoId, cantidad> (0 si no hay fila).
 */

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
  precioCosto: string;
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
  /** Margen sobre el costo, en %. null si el costo es 0. */
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
  precioCosto: string;
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

async function prefijoSku(tx: Tx): Promise<string> {
  const conf = await tx.configuracion.findUnique({ where: { clave: "prefijoSku" } });
  return typeof conf?.valor === "string" && conf.valor.trim() !== ""
    ? conf.valor.trim().toUpperCase()
    : "PRD";
}

/** Genera un SKU libre con formato `{prefijoSku}-XXXXXX` verificando unicidad. */
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
    const existe = await tx.variante.findUnique({ where: { sku }, select: { id: true } });
    if (!existe) return sku;
  }
  throw new Error("No se pudo generar un SKU único tras 20 intentos.");
}

async function assertSkuDisponible(tx: Tx, sku: string, excluirVarianteId?: string): Promise<void> {
  const v = await tx.variante.findUnique({
    where: { sku },
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

/** ¿De quién es este código? Busca en código principal (variantes vivas) y alternativos. */
async function duenioDeCodigo(
  tx: Tx,
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
        codigoBarras: codigo,
        deletedAt: null,
        ...(excluirVarianteId ? { id: { not: excluirVarianteId } } : {}),
      },
      select: seleccion,
    }),
    tx.codigoBarrasAlternativo.findUnique({
      where: { codigo },
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

/** Lanza DomainError("El código X ya pertenece a {producto} — {variante}") si está usado. */
export async function assertCodigoDisponible(
  tx: Tx,
  codigo: string,
  excluirVarianteId?: string,
): Promise<void> {
  const duenio = await duenioDeCodigo(tx, codigo, excluirVarianteId);
  if (duenio)
    throw new DomainError(
      `El código ${codigo} ya pertenece a ${duenio.nombre}`,
      "CODIGO_EN_USO",
      409,
    );
}

/** Para validación en vivo del formulario (con debounce). */
export async function verificarCodigoDisponible(
  codigo: string,
  excluirVarianteId?: string,
): Promise<{ disponible: true } | { disponible: false; mensaje: string }> {
  const c = normalizarCodigo(codigo);
  if (!c) return { disponible: false, mensaje: "Código de barras inválido" };
  const duenio = await duenioDeCodigo(prisma, c, excluirVarianteId);
  return duenio
    ? { disponible: false, mensaje: `Ya pertenece a ${duenio.nombre}` }
    : { disponible: true };
}

// =============================================================================
// buscarPorCodigo — la función que usa el escáner (cientos de veces por día)
// =============================================================================

/**
 * Busca una variante por código de barras principal o alternativo.
 * El código se normaliza (trim, sin espacios, mayúsculas) y la DB lo guarda
 * igual, así que la búsqueda "case-insensitive" es una igualdad exacta que usa
 * los índices únicos. Con relationLoadStrategy "join" Prisma resuelve
 * variante + producto + marca + categoría + stock + depósitos en UNA sola query.
 */
export async function buscarPorCodigo(codigo: string): Promise<VarianteEncontrada | null> {
  const c = normalizarCodigo(codigo);
  if (!c) return null;

  const v = await prisma.variante.findFirst({
    relationLoadStrategy: "join",
    where: {
      deletedAt: null,
      producto: { deletedAt: null },
      OR: [{ codigoBarras: c }, { codigosAlternativos: { some: { codigo: c } } }],
    },
    select: selectEncontrada,
  });
  return v ? aEncontrada(v, c) : null;
}

/** Misma forma que buscarPorCodigo pero por id (ej: volver al escáner después de crear el producto). */
export async function obtenerVarianteEncontrada(id: string): Promise<VarianteEncontrada | null> {
  const v = await prisma.variante.findFirst({
    relationLoadStrategy: "join",
    where: { id, deletedAt: null, producto: { deletedAt: null } },
    select: selectEncontrada,
  });
  return v ? aEncontrada(v, v.codigoBarras) : null;
}

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
    precioCosto: dec(v.precioCosto),
    precioVenta: dec(v.precioVenta),
    stockMinimo: v.stockMinimo,
    stock,
    stockTotal: stock.reduce((acc, s) => acc + s.cantidad, 0),
  };
}

// =============================================================================
// Códigos internos (Code128) para productos sin código de fábrica
// =============================================================================

/** Prefijo de los códigos internos: el de los SKU, solo letras y números (Code128 lo acepta y es fácil de tipear). */
export async function prefijoCodigoInterno(tx: Tx = prisma): Promise<string> {
  return (await prefijoSku(tx)).replace(/[^A-Z0-9]/g, "") || "PRD";
}

/** Formato: {prefijo}{7 dígitos}{verificador Luhn} (8 dígitos en total) — ej: PRD12345674. */
export async function generarCodigoInterno(
  tx: Tx = prisma,
  reservados: ReadonlySet<string> = new Set(),
): Promise<string> {
  const prefijo = await prefijoCodigoInterno(tx);
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

/**
 * Asigna un código interno a las variantes que no tienen código de barras
 * (las que ya tienen uno no se tocan). Devuelve cuántas se actualizaron.
 */
export async function asignarCodigosInternos(
  varianteIds: string[],
  actor: Actor,
): Promise<{ asignados: { varianteId: string; codigo: string }[] }> {
  return withTransaction(async (tx) => {
    const sinCodigo = await tx.variante.findMany({
      where: { id: { in: varianteIds }, deletedAt: null, codigoBarras: null },
      select: { id: true },
    });
    const reservados = new Set<string>();
    const asignados: { varianteId: string; codigo: string }[] = [];
    for (const v of sinCodigo) {
      const codigo = await generarCodigoInterno(tx, reservados);
      reservados.add(codigo);
      await tx.variante.update({ where: { id: v.id }, data: { codigoBarras: codigo } });
      asignados.push({ varianteId: v.id, codigo });
    }
    if (asignados.length) {
      await registrarAuditoria(tx, {
        usuarioId: actor.id,
        accion: AccionAuditoria.UPDATE,
        entidad: "Variante",
        datosDespues: { cambio: "codigo_interno", asignados },
        meta: actor.meta,
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

/** Nombre único por marca entre productos vivos (NULL en marca incluido, que el índice no cubre). */
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

/** Valida códigos y SKUs de las variantes contra la DB, con el error en el campo correcto. */
async function assertCodigosYSkus(tx: Tx, variantes: Producto["variantes"]) {
  for (const [i, v] of variantes.entries()) {
    if (v.codigoBarras) {
      const duenio = await duenioDeCodigo(tx, v.codigoBarras, v.id);
      if (duenio) {
        const msg = `El código ${v.codigoBarras} ya pertenece a ${duenio.nombre}`;
        throw new DomainError(msg, "CODIGO_EN_USO", 409, {
          [`variantes.${i}.codigoBarras`]: [msg],
        });
      }
    }
    if (v.sku) {
      try {
        await assertSkuDisponible(tx, v.sku, v.id);
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
 * Crea Producto + Variantes en una transacción. Sin variantes => una sola
 * variante "Único". SKU autogenerado si no viene. Registra AuditLog CREATE.
 */
export async function crearProducto(
  input: Producto,
  actor: Actor,
): Promise<{
  id: string;
  variantes: { id: string; nombre: string; codigoBarras: string | null }[];
}> {
  try {
    return await withTransaction(async (tx) => {
      await assertClasificacionActiva(tx, input.categoriaId, input.marcaId);
      await assertNombreDisponible(tx, input.nombre, input.marcaId);
      await assertCodigosYSkus(tx, input.variantes);

      const reservados = new Set(input.variantes.flatMap((v) => (v.sku ? [v.sku] : [])));
      const variantes = [];
      for (const v of input.variantes) {
        const sku = v.sku ?? (await generarSku(tx, reservados));
        reservados.add(sku);
        variantes.push({
          nombre: input.tieneVariantes ? v.nombre : NOMBRE_VARIANTE_UNICA,
          sku,
          codigoBarras: v.codigoBarras ?? null,
          precioCosto: v.precioCosto,
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
        usuarioId: actor.id,
        accion: AccionAuditoria.CREATE,
        entidad: "Producto",
        entidadId: producto.id,
        datosDespues: snapshotProducto(producto),
        meta: actor.meta,
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
 * - con id: se actualizan (precios con historial);
 * - sin id: se crean (si coincide con una variante dada de baja, se reactiva);
 * - las que faltan: soft delete (deletedAt + activo=false), nunca DELETE físico.
 *   Si tienen stock > 0 no se pueden quitar: primero hay que ajustarlo o transferirlo.
 * Una variante nunca cambia de producto (la DB lo impide si tiene movimientos).
 */
export async function actualizarProducto(
  id: string,
  input: Producto,
  actor: Actor,
): Promise<{ id: string }> {
  try {
    return await withTransaction(
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

        // 3) Validar contra la DB ya con los códigos liberados.
        await assertCodigosYSkus(tx, input.variantes);

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
            await aplicarPrecio(
              tx,
              actual,
              { costo: v.precioCosto, venta: v.precioVenta },
              actor.id,
              "Edición del producto",
            );
            await tx.variante.update({
              where: { id: actual.id },
              data: {
                nombre,
                sku: v.sku ?? actual.sku,
                codigoBarras: v.codigoBarras ?? null,
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
            await aplicarPrecio(
              tx,
              eliminada,
              { costo: v.precioCosto, venta: v.precioVenta },
              actor.id,
              "Reactivación de variante",
            );
            await tx.variante.update({
              where: { id: eliminada.id },
              data: {
                deletedAt: null,
                activo: v.activo,
                sku: v.sku ?? eliminada.sku,
                codigoBarras: v.codigoBarras ?? null,
                stockMinimo: v.stockMinimo,
              },
            });
            continue;
          }
          const sku = v.sku ?? (await generarSku(tx, reservados));
          reservados.add(sku);
          await tx.variante.create({
            data: {
              productoId: id,
              nombre,
              sku,
              codigoBarras: v.codigoBarras ?? null,
              precioCosto: v.precioCosto,
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
          usuarioId: actor.id,
          accion: AccionAuditoria.UPDATE,
          entidad: "Producto",
          entidadId: id,
          datosAntes: snapshotProducto(antes),
          datosDespues: snapshotProducto(despues),
          meta: actor.meta,
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
export async function darDeBajaProducto(id: string, actor: Actor): Promise<void> {
  await withTransaction(async (tx) => {
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
      usuarioId: actor.id,
      accion: AccionAuditoria.DELETE,
      entidad: "Producto",
      entidadId: id,
      datosAntes: { nombre: p.nombre },
      meta: actor.meta,
    });
  });
}

// =============================================================================
// Precios (siempre con HistorialPrecio; la DB rechaza un cambio sin historial)
// =============================================================================

/**
 * Cambia los precios de una variante registrando HistorialPrecio en la misma
 * tx. Devuelve false si no hay cambio real. Orden: historial primero (el
 * trigger habilita el UPDATE de precio para exactamente esos valores).
 */
async function aplicarPrecio(
  tx: Tx,
  variante: Pick<Variante, "id" | "precioCosto" | "precioVenta">,
  nuevo: { costo?: number | string | Prisma.Decimal; venta?: number | string | Prisma.Decimal },
  usuarioId: string,
  motivo?: string | null,
): Promise<boolean> {
  const costoNuevo = new Prisma.Decimal(nuevo.costo ?? variante.precioCosto).toDecimalPlaces(2);
  const ventaNuevo = new Prisma.Decimal(nuevo.venta ?? variante.precioVenta).toDecimalPlaces(2);
  if (costoNuevo.equals(variante.precioCosto) && ventaNuevo.equals(variante.precioVenta))
    return false;

  await tx.historialPrecio.create({
    data: {
      varianteId: variante.id,
      precioCostoAnterior: variante.precioCosto,
      precioCostoNuevo: costoNuevo,
      precioVentaAnterior: variante.precioVenta,
      precioVentaNuevo: ventaNuevo,
      usuarioId,
      motivo: motivo ?? null,
    },
  });
  await tx.variante.update({
    where: { id: variante.id },
    data: { precioCosto: costoNuevo, precioVenta: ventaNuevo },
  });
  return true;
}

/** Actualiza precios de una o varias variantes (con historial y AuditLog). */
export async function actualizarPrecios(
  varianteIds: string | string[],
  precios: { precioCosto?: number; precioVenta?: number },
  actor: Actor,
  motivo?: string,
  tx?: Tx,
): Promise<{ actualizadas: number }> {
  const ids = Array.isArray(varianteIds) ? varianteIds : [varianteIds];
  const ejecutar = async (t: Tx) => {
    const variantes = await t.variante.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: { id: true, precioCosto: true, precioVenta: true },
    });
    if (variantes.length !== ids.length)
      throw new NotFoundError("Alguna de las variantes no existe");
    let actualizadas = 0;
    for (const v of variantes) {
      if (
        await aplicarPrecio(
          t,
          v,
          { costo: precios.precioCosto, venta: precios.precioVenta },
          actor.id,
          motivo,
        )
      )
        actualizadas++;
    }
    if (actualizadas > 0) {
      await registrarAuditoria(t, {
        usuarioId: actor.id,
        accion: AccionAuditoria.UPDATE,
        entidad: "Variante",
        entidadId: ids.length === 1 ? ids[0] : null,
        datosDespues: {
          cambio: "precios",
          varianteIds: ids,
          precioCosto: precios.precioCosto ?? null,
          precioVenta: precios.precioVenta ?? null,
          motivo: motivo ?? null,
        },
        meta: actor.meta,
      });
    }
    return { actualizadas };
  };
  return tx ? ejecutar(tx) : withTransaction(ejecutar);
}

function whereAumento(filtro: AumentoPorcentual["filtro"]): Prisma.VarianteWhereInput {
  return {
    deletedAt: null,
    producto: {
      deletedAt: null,
      ...(filtro.categoriaId ? { categoriaId: filtro.categoriaId } : {}),
      ...(filtro.marcaId ? { marcaId: filtro.marcaId } : {}),
      ...(filtro.productoId ? { id: filtro.productoId } : {}),
    },
  };
}

/** precio × (1 + %/100), redondeado al múltiplo más cercano de `redondeo` pesos. */
export function calcularAumento(
  precio: Prisma.Decimal | string,
  porcentaje: number,
  redondeo: number,
): Prisma.Decimal {
  const factor = new Prisma.Decimal(100).plus(porcentaje).div(100);
  const bruto = new Prisma.Decimal(precio).mul(factor);
  return bruto.div(redondeo).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).mul(redondeo);
}

export interface PreviaAumento {
  cantidad: number;
  ejemplos: { nombre: string; campo: "costo" | "venta"; antes: string; despues: string }[];
}

/** Cuántas variantes toca y cómo quedan algunas (para confirmar antes de aplicar). */
export async function previsualizarAumento(datos: AumentoPorcentual): Promise<PreviaAumento> {
  const where = whereAumento(datos.filtro);
  const [cantidad, muestra] = await Promise.all([
    prisma.variante.count({ where }),
    prisma.variante.findMany({
      where,
      take: 5,
      orderBy: [{ producto: { nombre: "asc" } }, { nombre: "asc" }],
      select: {
        nombre: true,
        precioCosto: true,
        precioVenta: true,
        producto: { select: { nombre: true, tieneVariantes: true } },
      },
    }),
  ]);
  const campo = datos.aplicarA === "costo" ? "costo" : "venta";
  return {
    cantidad,
    ejemplos: muestra.map((v) => {
      const antes = campo === "costo" ? v.precioCosto : v.precioVenta;
      return {
        nombre: nombreCompleto(v.producto.nombre, v.nombre, v.producto.tieneVariantes),
        campo,
        antes: dec(antes),
        despues: dec(calcularAumento(antes, datos.porcentaje, datos.redondeo)),
      };
    }),
  };
}

/**
 * Aumento (o rebaja) porcentual masivo por categoría / marca / producto.
 * Una fila de HistorialPrecio por variante afectada.
 */
export async function aplicarAumentoPorcentual(
  datos: AumentoPorcentual,
  actor: Actor,
): Promise<{ afectadas: number }> {
  return withTransaction(
    async (tx) => {
      const variantes = await tx.variante.findMany({
        where: whereAumento(datos.filtro),
        select: { id: true, precioCosto: true, precioVenta: true },
      });
      let afectadas = 0;
      const motivo =
        datos.motivo ??
        `Aumento ${datos.porcentaje > 0 ? "+" : ""}${datos.porcentaje}% (${datos.aplicarA})`;
      for (const v of variantes) {
        const nuevo = {
          costo:
            datos.aplicarA !== "venta"
              ? calcularAumento(v.precioCosto, datos.porcentaje, datos.redondeo)
              : undefined,
          venta:
            datos.aplicarA !== "costo"
              ? calcularAumento(v.precioVenta, datos.porcentaje, datos.redondeo)
              : undefined,
        };
        if (await aplicarPrecio(tx, v, nuevo, actor.id, motivo)) afectadas++;
      }
      await registrarAuditoria(tx, {
        usuarioId: actor.id,
        accion: AccionAuditoria.UPDATE,
        entidad: "Variante",
        datosDespues: {
          cambio: "aumento_porcentual",
          filtro: { ...datos.filtro },
          porcentaje: datos.porcentaje,
          aplicarA: datos.aplicarA,
          redondeo: datos.redondeo,
          afectadas,
        },
        meta: actor.meta,
      });
      return { afectadas };
    },
    { timeout: 120_000 },
  );
}

export interface HistorialPrecioDTO {
  id: string;
  fecha: Date;
  variante: string;
  precioCostoAnterior: string;
  precioCostoNuevo: string;
  precioVentaAnterior: string;
  precioVentaNuevo: string;
  usuario: string;
  motivo: string | null;
}

export async function listarHistorialPrecios(
  productoId: string,
  limite = 100,
): Promise<HistorialPrecioDTO[]> {
  const filas = await prisma.historialPrecio.findMany({
    where: { variante: { productoId } },
    orderBy: { createdAt: "desc" },
    take: limite,
    include: { variante: { select: { nombre: true } }, usuario: { select: { nombre: true } } },
  });
  return filas.map((h) => ({
    id: h.id,
    fecha: h.createdAt,
    variante: h.variante.nombre,
    precioCostoAnterior: dec(h.precioCostoAnterior),
    precioCostoNuevo: dec(h.precioCostoNuevo),
    precioVentaAnterior: dec(h.precioVentaAnterior),
    precioVentaNuevo: dec(h.precioVentaNuevo),
    usuario: h.usuario.nombre,
    motivo: h.motivo,
  }));
}

// =============================================================================
// Códigos alternativos
// =============================================================================

export async function agregarCodigoAlternativo(
  varianteId: string,
  codigo: string,
  descripcion: string | undefined,
  actor: Actor,
): Promise<CodigoAlternativoDTO> {
  const c = normalizarCodigo(codigo);
  if (!c)
    throw new DomainError("Código de barras inválido", "VALIDATION_ERROR", 400, {
      codigo: ["Código inválido"],
    });
  return withTransaction(async (tx) => {
    const v = await tx.variante.findFirst({
      where: { id: varianteId, deletedAt: null },
      select: { id: true },
    });
    if (!v) throw new NotFoundError("La variante no existe");
    const duenio = await duenioDeCodigo(tx, c);
    if (duenio) {
      const msg = `El código ${c} ya pertenece a ${duenio.nombre}`;
      throw new DomainError(msg, "CODIGO_EN_USO", 409, { codigo: [msg] });
    }
    const alt = await tx.codigoBarrasAlternativo.create({
      data: { varianteId, codigo: c, descripcion: descripcion ?? null },
    });
    await registrarAuditoria(tx, {
      usuarioId: actor.id,
      accion: AccionAuditoria.CREATE,
      entidad: "CodigoBarrasAlternativo",
      entidadId: alt.id,
      datosDespues: { varianteId, codigo: c, descripcion: descripcion ?? null },
      meta: actor.meta,
    });
    return { id: alt.id, codigo: alt.codigo, descripcion: alt.descripcion };
  });
}

export async function quitarCodigoAlternativo(id: string, actor: Actor): Promise<void> {
  await withTransaction(async (tx) => {
    const alt = await tx.codigoBarrasAlternativo.findUnique({ where: { id } });
    if (!alt) throw new NotFoundError("El código alternativo no existe");
    await tx.codigoBarrasAlternativo.delete({ where: { id } });
    await registrarAuditoria(tx, {
      usuarioId: actor.id,
      accion: AccionAuditoria.DELETE,
      entidad: "CodigoBarrasAlternativo",
      entidadId: id,
      datosAntes: { varianteId: alt.varianteId, codigo: alt.codigo, descripcion: alt.descripcion },
      meta: actor.meta,
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

function aVarianteListada(v: VarianteConStock): VarianteListada {
  const stockPorDeposito: Record<string, number> = {};
  for (const s of v.stocks) stockPorDeposito[s.depositoId] = s.cantidad;
  const stockTotal = v.stocks.reduce((acc, s) => acc + s.cantidad, 0);
  return {
    id: v.id,
    nombre: v.nombre,
    sku: v.sku,
    codigoBarras: v.codigoBarras,
    precioCosto: dec(v.precioCosto),
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
  // sabor activo bajo el mínimo (o en 0) → BAJO; si no, OK. (Tomar el "peor
  // sabor" mostraría "Sin stock" en un producto que tiene 48 unidades.)
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
  filtros: Omit<FiltrosProductos, "page" | "pageSize" | "orden">,
): Promise<Prisma.ProductoWhereInput> {
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
      const vs = await prisma.variante.findMany({
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
    const alertas = await prisma.$queryRaw<
      { producto_id: string }[]
    >`SELECT DISTINCT producto_id FROM vw_alertas_stock`;
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
 * Listado paginado server-side. Búsqueda por nombre, sabor, SKU o código
 * (si `q` parece un código, primero busca el código exacto).
 */
export async function listarProductos(
  filtros: FiltrosProductos,
): Promise<{ productos: ProductoListado[]; total: number; page: number; pageSize: number }> {
  const where = await whereProductos(filtros);
  const [total, filas] = await Promise.all([
    prisma.producto.count({ where }),
    prisma.producto.findMany({
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
    const variantes = p.variantes.map(aVarianteListada);
    return { ...resumirProducto(p, variantes), variantes };
  });
  return { productos, total, page: filtros.page, pageSize: filtros.pageSize };
}

/** Ficha completa (también la usa el formulario de edición). */
export async function obtenerProducto(id: string): Promise<ProductoDetalle> {
  const p = await prisma.producto.findFirst({
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
    ...aVarianteListada(v),
    codigosAlternativos: v.codigosAlternativos,
    margen: margen(v.precioCosto, v.precioVenta),
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
  precioCosto: string;
  precioVenta: string;
  stockTotal: number;
  /** Stock en el depósito pedido (si se pidió uno). */
  stockDeposito: number | null;
}

/**
 * Buscador de variantes para ingresos, ajustes y transferencias (y, en el
 * próximo prompt, para el escáner): código exacto primero, si no por texto.
 */
export async function buscarVariantes(
  q: string,
  opciones: { depositoId?: string; limite?: number; soloConStockEnDeposito?: boolean } = {},
): Promise<VarianteBuscada[]> {
  const texto = q.trim();
  if (texto.length === 0) return [];
  const limite = opciones.limite ?? 20;
  const base: Prisma.VarianteWhereInput = {
    deletedAt: null,
    activo: true,
    producto: { deletedAt: null },
  };

  let where: Prisma.VarianteWhereInput | null = null;
  if (pareceCodigo(texto)) {
    const c = normalizarCodigoBarras(texto);
    const exactas = await prisma.variante.count({
      where: {
        ...base,
        OR: [{ codigoBarras: c }, { codigosAlternativos: { some: { codigo: c } } }],
      },
    });
    if (exactas > 0)
      where = {
        ...base,
        OR: [{ codigoBarras: c }, { codigosAlternativos: { some: { codigo: c } } }],
      };
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

  const filas = await prisma.variante.findMany({
    where,
    take: limite,
    orderBy: [{ producto: { nombre: "asc" } }, { nombre: "asc" }],
    select: {
      id: true,
      nombre: true,
      sku: true,
      codigoBarras: true,
      precioCosto: true,
      precioVenta: true,
      producto: { select: { nombre: true, tieneVariantes: true } },
      stocks: { select: { depositoId: true, cantidad: true } },
    },
  });
  return filas.map((v) => ({
    id: v.id,
    nombreCompleto: nombreCompleto(v.producto.nombre, v.nombre, v.producto.tieneVariantes),
    sku: v.sku,
    codigoBarras: v.codigoBarras,
    precioCosto: dec(v.precioCosto),
    precioVenta: dec(v.precioVenta),
    stockTotal: v.stocks.reduce((a, s) => a + s.cantidad, 0),
    stockDeposito: opciones.depositoId
      ? (v.stocks.find((s) => s.depositoId === opciones.depositoId)?.cantidad ?? 0)
      : null,
  }));
}

/** Datos mínimos de varias variantes (para precargar formularios por id). */
export async function obtenerVariantesPorId(
  ids: string[],
  depositoId?: string,
): Promise<VarianteBuscada[]> {
  if (ids.length === 0) return [];
  const filas = await prisma.variante.findMany({
    where: { id: { in: ids }, deletedAt: null },
    select: {
      id: true,
      nombre: true,
      sku: true,
      codigoBarras: true,
      precioCosto: true,
      precioVenta: true,
      producto: { select: { nombre: true, tieneVariantes: true } },
      stocks: { select: { depositoId: true, cantidad: true } },
    },
  });
  const porId = new Map(filas.map((v) => [v.id, v]));
  return ids.flatMap((id) => {
    const v = porId.get(id);
    if (!v) return [];
    return [
      {
        id: v.id,
        nombreCompleto: nombreCompleto(v.producto.nombre, v.nombre, v.producto.tieneVariantes),
        sku: v.sku,
        codigoBarras: v.codigoBarras,
        precioCosto: dec(v.precioCosto),
        precioVenta: dec(v.precioVenta),
        stockTotal: v.stocks.reduce((a, s) => a + s.cantidad, 0),
        stockDeposito: depositoId
          ? (v.stocks.find((s) => s.depositoId === depositoId)?.cantidad ?? 0)
          : null,
      },
    ];
  });
}

// =============================================================================
// CSV: importación (todo o nada) y exportación
// =============================================================================

export const COLUMNAS_CSV = [
  "producto",
  "marca",
  "categoria",
  "variante",
  "sku",
  "codigo_barras",
  "precio_costo",
  "precio_venta",
  "stock_minimo",
] as const;

const OBLIGATORIAS = ["producto", "categoria", "precio_costo", "precio_venta"] as const;

export interface FilaReporte {
  fila: number;
  estado: "ok" | "error";
  mensaje: string;
  producto?: string;
  variante?: string;
}

export interface ReporteImportacion {
  valido: boolean;
  importado: boolean;
  encoding: string;
  separador: string;
  filas: FilaReporte[];
  resumen: {
    total: number;
    ok: number;
    errores: number;
    productosNuevos: number;
    variantesNuevas: number;
  };
}

interface FilaParseada {
  fila: number;
  producto: string;
  marca: string | null;
  categoria: string;
  variante: string | null;
  sku: string | null;
  codigo: string | null;
  precioCosto: string;
  precioVenta: string;
  stockMinimo: number;
}

interface PlanProducto {
  clave: string;
  nombre: string;
  marca: string | null;
  categoria: string;
  existenteId: string | null;
  tieneVariantes: boolean;
  filas: FilaParseada[];
}

const claveProducto = (nombre: string, marca: string | null) =>
  `${nombre.toLocaleLowerCase("es")}|${(marca ?? "").toLocaleLowerCase("es")}`;

/**
 * Valida el archivo completo sin escribir nada. Devuelve el reporte por fila y,
 * si no hay errores, el plan de inserción.
 */
async function analizarCSV(
  bytes: Uint8Array,
): Promise<{ reporte: ReporteImportacion; plan: PlanProducto[] }> {
  const { texto, encoding } = decodificarTexto(bytes);
  const separador = texto.split(/\r?\n/, 1)[0]?.includes(";") ? ";" : ",";
  const filas = parsearCSV(texto, separador);
  const vacio = (errores: FilaReporte[]) => ({
    reporte: {
      valido: false,
      importado: false,
      encoding,
      separador,
      filas: errores,
      resumen: { total: 0, ok: 0, errores: errores.length, productosNuevos: 0, variantesNuevas: 0 },
    },
    plan: [],
  });

  if (filas.length < 2)
    return vacio([{ fila: 1, estado: "error", mensaje: "El archivo no tiene filas de datos" }]);
  const encabezados = filas[0]!.map(normalizarEncabezado);
  const faltantes = OBLIGATORIAS.filter((c) => !encabezados.includes(c));
  if (faltantes.length) {
    return vacio([
      {
        fila: 1,
        estado: "error",
        mensaje: `Faltan columnas: ${faltantes.join(", ")}. Usá la plantilla.`,
      },
    ]);
  }
  if (filas.length - 1 > 5000)
    return vacio([{ fila: 1, estado: "error", mensaje: "Máximo 5000 filas por archivo" }]);
  const col = (fila: string[], nombre: (typeof COLUMNAS_CSV)[number]) => {
    const i = encabezados.indexOf(nombre);
    return i === -1 ? "" : (fila[i] ?? "").trim();
  };

  // --- Parseo y validaciones por fila (formato) ---
  const reporte: FilaReporte[] = [];
  const parseadas: FilaParseada[] = [];
  const errores = new Map<number, string[]>();
  const agregarError = (fila: number, msg: string) =>
    errores.set(fila, [...(errores.get(fila) ?? []), msg]);

  for (const [i, celdas] of filas.slice(1).entries()) {
    const fila = i + 2; // 1 = encabezados
    const producto = col(celdas, "producto");
    const categoria = col(celdas, "categoria");
    const marca = col(celdas, "marca") || null;
    const variante = col(celdas, "variante") || null;
    const skuTxt = col(celdas, "sku").toUpperCase();
    const codigoTxt = col(celdas, "codigo_barras");
    const costoTxt = parsearPrecioAR(col(celdas, "precio_costo"));
    const ventaTxt = parsearPrecioAR(col(celdas, "precio_venta"));
    const minimoTxt = col(celdas, "stock_minimo");

    if (!producto) agregarError(fila, "Falta el nombre del producto");
    else if (producto.length > 150)
      agregarError(fila, "Nombre de producto demasiado largo (máx. 150)");
    if (!categoria) agregarError(fila, "Falta la categoría");
    if (variante && variante.length > 100)
      agregarError(fila, "Nombre de variante demasiado largo (máx. 100)");
    const costo = costoTxt === null ? null : monto.safeParse(costoTxt);
    const venta = ventaTxt === null ? null : monto.safeParse(ventaTxt);
    if (!costo?.success)
      agregarError(fila, `Precio de costo inválido: "${col(celdas, "precio_costo")}"`);
    if (!venta?.success)
      agregarError(fila, `Precio de venta inválido: "${col(celdas, "precio_venta")}"`);
    const minimo = minimoTxt === "" ? 0 : Number(minimoTxt);
    if (!Number.isInteger(minimo) || minimo < 0)
      agregarError(fila, `Stock mínimo inválido: "${minimoTxt}"`);
    if (skuTxt && !/^[A-Z0-9-]{3,32}$/.test(skuTxt))
      agregarError(fila, `SKU inválido: "${skuTxt}"`);
    const codigo = codigoTxt ? normalizarCodigo(codigoTxt) : null;
    if (codigoTxt && !codigo) agregarError(fila, `Código de barras inválido: "${codigoTxt}"`);

    parseadas.push({
      fila,
      producto,
      marca,
      categoria,
      variante,
      sku: skuTxt || null,
      codigo,
      precioCosto: costo?.success ? costo.data.toFixed(2) : "0",
      precioVenta: venta?.success ? venta.data.toFixed(2) : "0",
      stockMinimo: Number.isInteger(minimo) && minimo >= 0 ? minimo : 0,
    });
  }

  // --- Duplicados dentro del archivo ---
  const vistosCodigo = new Map<string, number>();
  const vistosSku = new Map<string, number>();
  for (const f of parseadas) {
    if (f.codigo) {
      const otra = vistosCodigo.get(f.codigo);
      if (otra !== undefined)
        agregarError(f.fila, `Código ${f.codigo} repetido (también en la fila ${otra})`);
      else vistosCodigo.set(f.codigo, f.fila);
    }
    if (f.sku) {
      const otra = vistosSku.get(f.sku);
      if (otra !== undefined)
        agregarError(f.fila, `SKU ${f.sku} repetido (también en la fila ${otra})`);
      else vistosSku.set(f.sku, f.fila);
    }
  }

  // --- Contra la DB (en lote) ---
  const codigos = [...vistosCodigo.keys()];
  const skus = [...vistosSku.keys()];
  const [codigosUsados, altUsados, skusUsados, productosExistentes, categorias, marcas] =
    await Promise.all([
      prisma.variante.findMany({
        where: { codigoBarras: { in: codigos }, deletedAt: null },
        select: { codigoBarras: true },
      }),
      prisma.codigoBarrasAlternativo.findMany({
        where: { codigo: { in: codigos } },
        select: { codigo: true },
      }),
      prisma.variante.findMany({ where: { sku: { in: skus } }, select: { sku: true } }),
      prisma.producto.findMany({
        where: {
          deletedAt: null,
          nombre: { in: [...new Set(parseadas.map((f) => f.producto))], mode: "insensitive" },
        },
        select: {
          id: true,
          nombre: true,
          tieneVariantes: true,
          marca: { select: { nombre: true } },
          variantes: { select: { nombre: true, deletedAt: true } },
        },
      }),
      prisma.categoria.findMany({ select: { nombre: true, activo: true } }),
      prisma.marca.findMany({ select: { nombre: true, activo: true } }),
    ]);
  const codigoOcupado = new Set([
    ...codigosUsados.map((c) => c.codigoBarras!),
    ...altUsados.map((a) => a.codigo),
  ]);
  const skuOcupado = new Set(skusUsados.map((s) => s.sku));
  const catInactivas = new Set(
    categorias.filter((c) => !c.activo).map((c) => c.nombre.toLocaleLowerCase("es")),
  );
  const marcasInactivas = new Set(
    marcas.filter((m) => !m.activo).map((m) => m.nombre.toLocaleLowerCase("es")),
  );
  const existentes = new Map(
    productosExistentes.map((p) => [claveProducto(p.nombre, p.marca?.nombre ?? null), p]),
  );

  for (const f of parseadas) {
    if (f.codigo && codigoOcupado.has(f.codigo))
      agregarError(f.fila, `El código ${f.codigo} ya existe en el sistema`);
    if (f.sku && skuOcupado.has(f.sku))
      agregarError(f.fila, `El SKU ${f.sku} ya existe en el sistema`);
    if (catInactivas.has(f.categoria.toLocaleLowerCase("es")))
      agregarError(f.fila, `La categoría "${f.categoria}" está inactiva`);
    if (f.marca && marcasInactivas.has(f.marca.toLocaleLowerCase("es")))
      agregarError(f.fila, `La marca "${f.marca}" está inactiva`);
  }

  // --- Agrupar por producto ---
  const grupos = new Map<string, PlanProducto>();
  for (const f of parseadas) {
    if (!f.producto) continue;
    const clave = claveProducto(f.producto, f.marca);
    const g = grupos.get(clave);
    if (g) {
      if (g.categoria.toLocaleLowerCase("es") !== f.categoria.toLocaleLowerCase("es")) {
        agregarError(
          f.fila,
          `"${f.producto}" aparece con otra categoría (${g.categoria}) en la fila ${g.filas[0]!.fila}`,
        );
      }
      g.filas.push(f);
    } else {
      const ex = existentes.get(clave);
      grupos.set(clave, {
        clave,
        nombre: ex?.nombre ?? f.producto,
        marca: f.marca,
        categoria: f.categoria,
        existenteId: ex?.id ?? null,
        tieneVariantes: ex?.tieneVariantes ?? true,
        filas: [f],
      });
    }
  }

  for (const g of grupos.values()) {
    const ex = existentes.get(g.clave);
    if (ex) {
      if (!ex.tieneVariantes) {
        for (const f of g.filas)
          agregarError(f.fila, `"${ex.nombre}" ya existe como producto sin variantes`);
        continue;
      }
      const nombres = new Set(ex.variantes.map((v) => v.nombre.toLocaleLowerCase("es")));
      for (const f of g.filas) {
        if (!f.variante)
          agregarError(f.fila, `"${ex.nombre}" ya existe: indicá el nombre de la variante nueva`);
        else if (nombres.has(f.variante.toLocaleLowerCase("es"))) {
          agregarError(f.fila, `La variante "${f.variante}" ya existe en "${ex.nombre}"`);
        }
      }
    } else {
      const sinNombre = g.filas.filter((f) => !f.variante || f.variante === NOMBRE_VARIANTE_UNICA);
      g.tieneVariantes = !(g.filas.length === 1 && sinNombre.length === 1);
      if (g.tieneVariantes) {
        for (const f of sinNombre)
          agregarError(
            f.fila,
            `"${g.nombre}" tiene varias filas: cada una necesita el nombre de la variante`,
          );
      }
    }
    const vistas = new Map<string, number>();
    for (const f of g.filas) {
      if (!f.variante) continue;
      const k = f.variante.toLocaleLowerCase("es");
      const otra = vistas.get(k);
      if (otra !== undefined)
        agregarError(f.fila, `Variante "${f.variante}" repetida (también en la fila ${otra})`);
      else vistas.set(k, f.fila);
    }
  }

  // --- Reporte ---
  let productosNuevos = 0;
  let variantesNuevas = 0;
  for (const f of parseadas) {
    const errs = errores.get(f.fila);
    const g = f.producto ? grupos.get(claveProducto(f.producto, f.marca)) : undefined;
    if (errs) {
      reporte.push({
        fila: f.fila,
        estado: "error",
        mensaje: errs.join(" · "),
        producto: f.producto,
        variante: f.variante ?? undefined,
      });
      continue;
    }
    variantesNuevas++;
    const primera = g?.filas[0]?.fila === f.fila;
    if (primera && !g?.existenteId) productosNuevos++;
    reporte.push({
      fila: f.fila,
      estado: "ok",
      mensaje: g?.existenteId
        ? `Variante nueva en "${g.nombre}"`
        : g?.tieneVariantes
          ? primera
            ? `Producto nuevo "${g.nombre}" con variantes`
            : `Variante de "${g?.nombre}"`
          : `Producto nuevo "${g?.nombre}" (sin variantes)`,
      producto: f.producto,
      variante: f.variante ?? undefined,
    });
  }
  const conError = reporte.filter((r) => r.estado === "error").length;
  return {
    reporte: {
      valido: conError === 0,
      importado: false,
      encoding,
      separador,
      filas: reporte,
      resumen: {
        total: reporte.length,
        ok: reporte.length - conError,
        errores: conError,
        productosNuevos,
        variantesNuevas,
      },
    },
    plan: [...grupos.values()],
  };
}

/** Previsualización: valida TODO el archivo y devuelve el reporte por fila. No escribe. */
export async function previsualizarImportacion(bytes: Uint8Array): Promise<ReporteImportacion> {
  return (await analizarCSV(bytes)).reporte;
}

/**
 * Importación masiva (carga inicial). Valida todo antes de insertar; si hay
 * una sola fila con error no se inserta nada. Crea marcas y categorías que no
 * existan. No carga stock: el stock solo entra por movimientos.
 */
export async function importarProductosCSV(
  bytes: Uint8Array,
  actor: Actor,
): Promise<ReporteImportacion> {
  const { reporte, plan } = await analizarCSV(bytes);
  if (!reporte.valido) return reporte;

  await withTransaction(
    async (tx) => {
      const reservados = new Set(
        plan.flatMap((g) => g.filas.flatMap((f) => (f.sku ? [f.sku] : []))),
      );
      const cacheCat = new Map<string, string>();
      const cacheMarca = new Map<string, string>();
      const idCategoria = async (n: string) => {
        const k = n.toLocaleLowerCase("es");
        if (!cacheCat.has(k)) cacheCat.set(k, await obtenerOCrearClasificacion(tx, "Categoria", n));
        return cacheCat.get(k)!;
      };
      const idMarca = async (n: string | null) => {
        if (!n) return null;
        const k = n.toLocaleLowerCase("es");
        if (!cacheMarca.has(k)) cacheMarca.set(k, await obtenerOCrearClasificacion(tx, "Marca", n));
        return cacheMarca.get(k)!;
      };

      for (const g of plan) {
        const variantes = [];
        for (const f of g.filas) {
          const sku = f.sku ?? (await generarSku(tx, reservados));
          reservados.add(sku);
          variantes.push({
            nombre: g.tieneVariantes ? f.variante! : NOMBRE_VARIANTE_UNICA,
            sku,
            codigoBarras: f.codigo,
            precioCosto: f.precioCosto,
            precioVenta: f.precioVenta,
            stockMinimo: f.stockMinimo,
          });
        }
        if (g.existenteId) {
          await tx.variante.createMany({
            data: variantes.map((v) => ({ ...v, productoId: g.existenteId! })),
          });
        } else {
          await tx.producto.create({
            data: {
              nombre: g.nombre,
              categoriaId: await idCategoria(g.categoria),
              marcaId: await idMarca(g.marca),
              tieneVariantes: g.tieneVariantes,
              variantes: { create: variantes },
            },
          });
        }
      }
      await registrarAuditoria(tx, {
        usuarioId: actor.id,
        accion: AccionAuditoria.CREATE,
        entidad: "ImportacionCSV",
        datosDespues: { ...reporte.resumen },
        meta: actor.meta,
      });
    },
    { timeout: 180_000, maxWait: 10_000 },
  );
  return { ...reporte, importado: true };
}

/** Plantilla de importación: encabezados + 3 filas de ejemplo. */
export function plantillaCSV(): string {
  return aCSV([
    [...COLUMNAS_CSV],
    ["Ignite V50", "Ignite", "Vapes", "Mango Ice", "", "7790000999992", "8500,00", "15000,00", "5"],
    ["Ignite V50", "Ignite", "Vapes", "Grape Ice", "", "7790000999985", "8500,00", "15000,00", "5"],
    ["Cable USB-C 1m", "TechPro", "Accesorios", "", "", "", "1200,00", "2500,00", "3"],
  ]);
}

/** Exporta (una fila por variante) con los mismos filtros del listado, sin paginar. */
export async function exportarProductosCSV(
  filtros: Omit<FiltrosProductos, "page" | "pageSize">,
  depositos: { id: string; nombre: string }[],
): Promise<string> {
  const where = await whereProductos(filtros);
  const productos = await prisma.producto.findMany({
    where,
    orderBy: ORDEN_PRODUCTOS[filtros.orden],
    select: {
      nombre: true,
      marca: { select: { nombre: true } },
      categoria: { select: { nombre: true } },
      tieneVariantes: true,
      variantes: {
        where: { deletedAt: null },
        orderBy: { nombre: "asc" },
        select: selectVarianteConStock,
      },
    },
  });
  const filas: (string | number)[][] = [
    [...COLUMNAS_CSV, ...depositos.map((d) => `stock_${d.nombre}`), "stock_total"],
  ];
  for (const p of productos) {
    for (const v of p.variantes) {
      const lv = aVarianteListada(v);
      filas.push([
        p.nombre,
        p.marca?.nombre ?? "",
        p.categoria.nombre,
        p.tieneVariantes ? v.nombre : "",
        v.sku,
        v.codigoBarras ?? "",
        formatearDecimalAR(lv.precioCosto),
        formatearDecimalAR(lv.precioVenta),
        v.stockMinimo,
        ...depositos.map((d) => lv.stockPorDeposito[d.id] ?? 0),
        lv.stockTotal,
      ]);
    }
  }
  return aCSV(filas);
}
