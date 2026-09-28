import { AccionAuditoria, EstadoCompra, Modulo, Prisma, type Moneda } from "@prisma/client";

import { puede, type SujetoPermisos } from "@/lib/permisos";
import { ahora } from "@/lib/reloj";
import type {
  ActualizarProveedor,
  CrearProveedor,
  ProductoDeProveedor,
} from "@/lib/validations/proveedor";
import { dbPara, enTransaccion, transaccion, type Ctx, type Tx } from "@/server/db/panel-scoped";
import { ConflictError, DomainError, NotFoundError } from "@/server/errors";
import { registrarAuditoria } from "@/server/services/audit.service";

/**
 * PROVEEDORES del panel: contacto (persona + tienda + teléfono) y la lista de
 * productos que vende con su precio (ProveedorProducto).
 *
 * - Teléfono normalizado "+54…" y único por panel entre los no borrados
 *   (índice parcial en la DB; acá se chequea antes para dar un error de campo).
 * - Precios de proveedor, montos comprados y totales: SOLO dueños o quien
 *   tiene `ver` en COMPRAS (`veCostosCompras`). Se filtran ACÁ, en el
 *   servidor: a los demás les llega `null`.
 * - Los precios de proveedor se actualizan a mano (ficha) o al recibir una
 *   compra con "actualizar precio" (compra.service).
 */

/** ctx de las páginas/acciones (CtxPanel) o uno sin usuario (nunca ve costos). */
export type CtxProveedores = Ctx & { usuario?: SujetoPermisos };

/** ¿Ve precios de proveedor, costos y totales comprados? Dueños o `ver` en COMPRAS. */
export function veCostosCompras(ctx: CtxProveedores): boolean {
  return ctx.usuario !== undefined && puede(ctx.usuario, ctx.panelId, Modulo.COMPRAS, "ver");
}

const dec = (d: Prisma.Decimal | string | number) => new Prisma.Decimal(d).toFixed(2);

// =============================================================================
// Tipos
// =============================================================================

export interface ProductoDeProveedorDTO {
  productoId: string;
  nombreCompleto: string;
  marca: string;
  modelo: string;
  /** null = quien mira no ve precios. */
  precio: string | null;
  moneda: Moneda | null;
  actualizadoAt: Date | null;
}

export interface ProveedorTarjeta {
  id: string;
  nombre: string;
  nombreTienda: string;
  telefono: string | null;
  activo: boolean;
  cantidadProductos: number;
  productos: ProductoDeProveedorDTO[];
}

export interface CompraDeProveedor {
  id: string;
  numero: number;
  fecha: Date;
  estado: EstadoCompra;
  deposito: string;
  items: number;
  unidades: number;
  /** null = quien mira no ve totales. */
  total: string | null;
}

export interface ProveedorDetalle {
  proveedor: {
    id: string;
    nombre: string;
    nombreTienda: string;
    telefono: string | null;
    notas: string | null;
    activo: boolean;
  };
  productos: ProductoDeProveedorDTO[];
  cantidadCompras: number;
  /** Σ compras RECIBIDAS. null = quien mira no ve totales. */
  totalComprado: string | null;
  /** Últimas 50. */
  compras: CompraDeProveedor[];
}

/** Contrato con la ficha de producto (agente PRODUCTOS). */
export interface ProveedorDeProducto {
  proveedorId: string;
  nombre: string;
  nombreTienda: string;
  telefono: string | null;
  precio: string;
  moneda: Moneda;
  actualizadoAt: Date;
  /** El producto con ese precio (con `ampliado` puede ser otro modelo de la misma marca y especificación). */
  productoId: string;
  nombreCompleto: string;
}

// =============================================================================
// Helpers
// =============================================================================

const selectProductoDeProveedor = {
  productoId: true,
  precio: true,
  moneda: true,
  actualizadoAt: true,
  producto: {
    select: { nombreCompleto: true, nombre: true, marca: { select: { nombre: true } } },
  },
} satisfies Prisma.ProveedorProductoSelect;

type FilaProductoDeProveedor = Prisma.ProveedorProductoGetPayload<{
  select: typeof selectProductoDeProveedor;
}>;

/** Orden por marca y modelo (y especificación, vía nombreCompleto). */
const ordenProductos: Prisma.ProveedorProductoOrderByWithRelationInput[] = [
  { producto: { marca: { nombre: "asc" } } },
  { producto: { nombre: "asc" } },
  { producto: { nombreCompleto: "asc" } },
];

function aProductoDTO(f: FilaProductoDeProveedor, conPrecio: boolean): ProductoDeProveedorDTO {
  return {
    productoId: f.productoId,
    nombreCompleto: f.producto.nombreCompleto,
    marca: f.producto.marca.nombre,
    modelo: f.producto.nombre,
    precio: conPrecio ? dec(f.precio) : null,
    moneda: conPrecio ? f.moneda : null,
    actualizadoAt: conPrecio ? f.actualizadoAt : null,
  };
}

const productosVigentes: Prisma.ProveedorProductoWhereInput = {
  producto: { deletedAt: null },
};

async function assertTelefonoLibre(tx: Tx, telefono: string | undefined, excluirId?: string) {
  if (!telefono) return;
  const otro = await tx.proveedor.findFirst({
    where: { telefono, deletedAt: null, ...(excluirId ? { id: { not: excluirId } } : {}) },
    select: { nombre: true, nombreTienda: true },
  });
  if (otro) {
    const mensaje = `Ese teléfono ya es de ${otro.nombre} (${otro.nombreTienda})`;
    throw new ConflictError(mensaje, { telefono: [mensaje] });
  }
}

/** Carrera entre dos altas con el mismo teléfono: el índice único parcial de la DB. */
function conflictoTelefono(error: unknown): void {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    const mensaje = "Ya hay un proveedor con ese teléfono en este panel";
    throw new ConflictError(mensaje, { telefono: [mensaje] });
  }
}

async function assertProveedor(tx: Tx, id: string) {
  const p = await tx.proveedor.findFirst({ where: { id, deletedAt: null } });
  if (!p) throw new NotFoundError("El proveedor no existe o fue dado de baja");
  return p;
}

async function assertProductos(tx: Tx, ids: string[]) {
  if (ids.length === 0) return;
  const n = await tx.producto.count({ where: { id: { in: ids }, deletedAt: null } });
  if (n !== new Set(ids).size) {
    throw new NotFoundError("Alguno de los productos no existe o fue dado de baja");
  }
}

// =============================================================================
// Escritura
// =============================================================================

export async function crear(
  ctx: CtxProveedores,
  input: CrearProveedor,
): Promise<{ id: string; nombre: string; nombreTienda: string }> {
  try {
    return await transaccion(ctx, async (tx) => {
      await assertTelefonoLibre(tx, input.telefono);
      await assertProductos(
        tx,
        input.productos.map((p) => p.productoId),
      );
      const momento = ahora();
      const p = await tx.proveedor.create({
        data: {
          nombre: input.nombre,
          telefono: input.telefono ?? null,
          nombreTienda: input.nombreTienda,
          notas: input.notas ?? null,
          productos: {
            create: input.productos.map((pp) => ({
              productoId: pp.productoId,
              precio: pp.precio,
              moneda: pp.moneda,
              actualizadoAt: momento,
              usuarioId: ctx.usuarioId,
            })),
          },
        },
      });
      await registrarAuditoria(tx, {
        usuarioId: ctx.usuarioId,
        accion: AccionAuditoria.CREATE,
        entidad: "Proveedor",
        entidadId: p.id,
        datosDespues: {
          nombre: p.nombre,
          nombreTienda: p.nombreTienda,
          telefono: p.telefono,
          productos: input.productos.map((pp) => ({ ...pp, precio: dec(pp.precio) })),
        },
        meta: ctx.meta,
      });
      return { id: p.id, nombre: p.nombre, nombreTienda: p.nombreTienda };
    });
  } catch (e) {
    conflictoTelefono(e);
    throw e;
  }
}

export async function actualizar(ctx: Ctx, input: ActualizarProveedor): Promise<{ id: string }> {
  try {
    return await transaccion(ctx, async (tx) => {
      const antes = await assertProveedor(tx, input.id);
      await assertTelefonoLibre(tx, input.telefono, input.id);
      if (antes.activo && !input.activo) await assertSinBorradores(tx, input.id);
      const datos = {
        nombre: input.nombre,
        telefono: input.telefono ?? null,
        nombreTienda: input.nombreTienda,
        notas: input.notas ?? null,
        activo: input.activo,
      };
      await tx.proveedor.update({ where: { id: input.id }, data: datos });
      await registrarAuditoria(tx, {
        usuarioId: ctx.usuarioId,
        accion: AccionAuditoria.UPDATE,
        entidad: "Proveedor",
        entidadId: input.id,
        datosAntes: {
          nombre: antes.nombre,
          telefono: antes.telefono,
          nombreTienda: antes.nombreTienda,
          notas: antes.notas,
          activo: antes.activo,
        },
        datosDespues: datos,
        meta: ctx.meta,
      });
      return { id: input.id };
    });
  } catch (e) {
    conflictoTelefono(e);
    throw e;
  }
}

async function assertSinBorradores(tx: Tx, proveedorId: string) {
  const borradores = await tx.compra.count({
    where: { proveedorId, estado: EstadoCompra.BORRADOR },
  });
  if (borradores > 0) {
    throw new DomainError(
      `Tiene ${borradores} compra${borradores === 1 ? "" : "s"} en borrador: recibila${borradores === 1 ? "" : "s"} o anulala${borradores === 1 ? "" : "s"} antes de desactivarlo.`,
    );
  }
}

/** Deja de aparecer para nuevas compras (sus compras y precios quedan). No si tiene borradores. */
export async function desactivar(ctx: Ctx, id: string): Promise<void> {
  await transaccion(ctx, async (tx) => {
    const p = await assertProveedor(tx, id);
    if (!p.activo) return;
    await assertSinBorradores(tx, id);
    await tx.proveedor.update({ where: { id }, data: { activo: false } });
    await registrarAuditoria(tx, {
      usuarioId: ctx.usuarioId,
      accion: AccionAuditoria.UPDATE,
      entidad: "Proveedor",
      entidadId: id,
      datosAntes: { activo: true },
      datosDespues: { activo: false },
      meta: ctx.meta,
    });
  });
}

/**
 * Fija el precio de un producto para el proveedor (upsert): actualizadoAt =
 * ahora, usuarioId = quien lo fija. `tx` opcional para usarlo dentro de otra
 * transacción (recibir una compra con "actualizar precio").
 */
export async function asignarProducto(
  ctx: Ctx,
  proveedorId: string,
  datos: ProductoDeProveedor,
  tx?: Tx,
): Promise<void> {
  await enTransaccion(ctx, tx, async (t) => {
    await assertProveedor(t, proveedorId);
    await assertProductos(t, [datos.productoId]);
    const where = {
      panelId_proveedorId_productoId: {
        panelId: ctx.panelId,
        proveedorId,
        productoId: datos.productoId,
      },
    };
    const antes = await t.proveedorProducto.findUnique({ where });
    const valores = {
      precio: new Prisma.Decimal(datos.precio).toDecimalPlaces(2),
      moneda: datos.moneda,
      actualizadoAt: ahora(),
      usuarioId: ctx.usuarioId,
    };
    await t.proveedorProducto.upsert({
      where,
      create: { proveedorId, productoId: datos.productoId, ...valores },
      update: valores,
    });
    await registrarAuditoria(t, {
      usuarioId: ctx.usuarioId,
      accion: antes ? AccionAuditoria.UPDATE : AccionAuditoria.CREATE,
      entidad: "ProveedorProducto",
      entidadId: `${proveedorId}:${datos.productoId}`,
      datosAntes: antes ? { precio: dec(antes.precio), moneda: antes.moneda } : undefined,
      datosDespues: { precio: dec(valores.precio), moneda: valores.moneda },
      meta: ctx.meta,
    });
  });
}

export async function quitarProducto(
  ctx: Ctx,
  proveedorId: string,
  productoId: string,
): Promise<void> {
  await transaccion(ctx, async (tx) => {
    await assertProveedor(tx, proveedorId);
    const antes = await tx.proveedorProducto.findUnique({
      where: { panelId_proveedorId_productoId: { panelId: ctx.panelId, proveedorId, productoId } },
    });
    if (!antes) return;
    await tx.proveedorProducto.delete({ where: { id: antes.id } });
    await registrarAuditoria(tx, {
      usuarioId: ctx.usuarioId,
      accion: AccionAuditoria.DELETE,
      entidad: "ProveedorProducto",
      entidadId: `${proveedorId}:${productoId}`,
      datosAntes: { precio: dec(antes.precio), moneda: antes.moneda },
      meta: ctx.meta,
    });
  });
}

// =============================================================================
// Lectura
// =============================================================================

/**
 * Tarjetas de proveedores. `q` busca por nombre, tienda o nombre completo de
 * un producto que vende (cada palabra en cualquiera de los tres).
 */
export async function listar(
  ctx: CtxProveedores,
  opciones: { q?: string } = {},
): Promise<ProveedorTarjeta[]> {
  const db = dbPara(ctx.panelId);
  const conPrecio = veCostosCompras(ctx);
  const palabras = (opciones.q ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 5);
  const where: Prisma.ProveedorWhereInput = {
    deletedAt: null,
    ...(palabras.length
      ? {
          AND: palabras.map((w) => ({
            OR: [
              { nombre: { contains: w, mode: "insensitive" as const } },
              { nombreTienda: { contains: w, mode: "insensitive" as const } },
              {
                productos: {
                  some: {
                    producto: {
                      deletedAt: null,
                      nombreCompleto: { contains: w, mode: "insensitive" as const },
                    },
                  },
                },
              },
            ],
          })),
        }
      : {}),
  };
  const filas = await db.proveedor.findMany({
    where,
    orderBy: [{ activo: "desc" }, { nombre: "asc" }],
    take: 200,
    select: {
      id: true,
      nombre: true,
      nombreTienda: true,
      telefono: true,
      activo: true,
      productos: {
        where: productosVigentes,
        orderBy: ordenProductos,
        select: selectProductoDeProveedor,
      },
    },
  });
  return filas.map((p) => ({
    id: p.id,
    nombre: p.nombre,
    nombreTienda: p.nombreTienda,
    telefono: p.telefono,
    activo: p.activo,
    cantidadProductos: p.productos.length,
    productos: p.productos.map((f) => aProductoDTO(f, conPrecio)),
  }));
}

/** Para selects (compras): los activos, por nombre. */
export async function listarProveedoresActivos(
  ctx: Pick<Ctx, "panelId">,
): Promise<{ id: string; nombre: string; nombreTienda: string }[]> {
  return dbPara(ctx.panelId).proveedor.findMany({
    where: { deletedAt: null, activo: true },
    select: { id: true, nombre: true, nombreTienda: true },
    orderBy: { nombre: "asc" },
  });
}

/** Productos que vende el proveedor, por marca y modelo (precios solo si `veCostosCompras`). */
export async function listarProductosDeProveedor(
  ctx: CtxProveedores,
  proveedorId: string,
): Promise<ProductoDeProveedorDTO[]> {
  const filas = await dbPara(ctx.panelId).proveedorProducto.findMany({
    where: { proveedorId, ...productosVigentes },
    orderBy: ordenProductos,
    select: selectProductoDeProveedor,
  });
  const conPrecio = veCostosCompras(ctx);
  return filas.map((f) => aProductoDTO(f, conPrecio));
}

export async function obtener(ctx: CtxProveedores, id: string): Promise<ProveedorDetalle> {
  const db = dbPara(ctx.panelId);
  const p = await db.proveedor.findFirst({ where: { id, deletedAt: null } });
  if (!p) throw new NotFoundError("El proveedor no existe o fue dado de baja");
  const conTotales = veCostosCompras(ctx);
  const [productos, cantidadCompras, suma, compras] = await Promise.all([
    listarProductosDeProveedor(ctx, id),
    db.compra.count({ where: { proveedorId: id } }),
    conTotales
      ? db.compra.aggregate({
          where: { proveedorId: id, estado: EstadoCompra.RECIBIDA },
          _sum: { total: true },
        })
      : Promise.resolve(null),
    db.compra.findMany({
      where: { proveedorId: id },
      orderBy: { numero: "desc" },
      take: 50,
      select: {
        id: true,
        numero: true,
        fecha: true,
        estado: true,
        total: true,
        deposito: { select: { nombre: true } },
        items: { select: { cantidad: true } },
      },
    }),
  ]);
  return {
    proveedor: {
      id: p.id,
      nombre: p.nombre,
      nombreTienda: p.nombreTienda,
      telefono: p.telefono,
      notas: p.notas,
      activo: p.activo,
    },
    productos,
    cantidadCompras,
    totalComprado: suma ? dec(suma._sum.total ?? 0) : null,
    compras: compras.map((c) => ({
      id: c.id,
      numero: c.numero,
      fecha: c.fecha,
      estado: c.estado,
      deposito: c.deposito.nombre,
      items: c.items.length,
      unidades: c.items.reduce((a, i) => a + i.cantidad, 0),
      total: conTotales ? dec(c.total) : null,
    })),
  };
}

/**
 * Proveedores que venden un producto, del más barato al más caro.
 * "Mismo producto exacto" = misma marca + misma especificación normalizada
 * (el sabor no importa: el precio es por producto). Por defecto además el
 * mismo modelo (= ese productoId, por el UNIQUE de Producto); con
 * `ampliado: true` entran otros modelos de la misma marca y especificación.
 * Un proveedor aparece una sola vez (su precio más bajo).
 * No filtra por permisos: quien llama muestra esto solo a dueños o a quien
 * tiene `ver` en COMPRAS o PROVEEDORES.
 */
export async function proveedoresDeProducto(
  ctx: Pick<Ctx, "panelId">,
  productoId: string,
  opciones: { ampliado?: boolean } = {},
): Promise<ProveedorDeProducto[]> {
  const db = dbPara(ctx.panelId);
  const producto = await db.producto.findUnique({
    where: { id: productoId },
    select: { marcaId: true, nombre: true, especificacionNorm: true },
  });
  if (!producto) return [];
  const filas = await db.proveedorProducto.findMany({
    where: {
      proveedor: { deletedAt: null },
      producto: {
        deletedAt: null,
        marcaId: producto.marcaId,
        especificacionNorm: producto.especificacionNorm,
        ...(opciones.ampliado ? {} : { nombre: producto.nombre }),
      },
    },
    orderBy: [{ precio: "asc" }, { moneda: "asc" }, { actualizadoAt: "desc" }],
    select: {
      precio: true,
      moneda: true,
      actualizadoAt: true,
      productoId: true,
      producto: { select: { nombreCompleto: true } },
      proveedor: {
        select: { id: true, nombre: true, nombreTienda: true, telefono: true },
      },
    },
  });
  const vistos = new Set<string>();
  return filas.flatMap((f) => {
    if (vistos.has(f.proveedor.id)) return [];
    vistos.add(f.proveedor.id);
    return [
      {
        proveedorId: f.proveedor.id,
        nombre: f.proveedor.nombre,
        nombreTienda: f.proveedor.nombreTienda,
        telefono: f.proveedor.telefono,
        precio: dec(f.precio),
        moneda: f.moneda,
        actualizadoAt: f.actualizadoAt,
        productoId: f.productoId,
        nombreCompleto: f.producto.nombreCompleto,
      },
    ];
  });
}

/** Buscador de productos del panel para las filas "Productos que vende". */
export async function buscarProductosDelPanel(
  ctx: Pick<Ctx, "panelId">,
  q: string,
): Promise<{ id: string; nombreCompleto: string }[]> {
  const palabras = q.trim().split(/\s+/).filter(Boolean).slice(0, 5);
  if (palabras.length === 0) return [];
  return dbPara(ctx.panelId).producto.findMany({
    where: {
      deletedAt: null,
      activo: true,
      AND: palabras.map((w) => ({ nombreCompleto: { contains: w, mode: "insensitive" as const } })),
    },
    orderBy: { nombreCompleto: "asc" },
    take: 20,
    select: { id: true, nombreCompleto: true },
  });
}
