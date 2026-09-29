import { AccionAuditoria, EstadoCompra, Moneda, Prisma, TipoMovimiento } from "@prisma/client";

import { finDelDia, hoyAR, inicioDelDia } from "@/lib/fechas";
import { formatearIdCompra } from "@/lib/paneles";
import type { Compra, FiltrosCompras } from "@/lib/validations/compra";
import { dbPara, transaccion, type Ctx, type Tx } from "@/server/db/panel-scoped";
import { siguienteNumero } from "@/server/db/secuencia";
import { DomainError, NotFoundError, StockInsuficienteError } from "@/server/errors";
import { registrarAuditoria } from "@/server/services/audit.service";
import { asignarProducto } from "@/server/services/proveedor.service";
import { registrarMovimiento } from "@/server/services/stock.service";

/**
 * COMPRAS a proveedores (por panel: numeración, proveedor y galpón del panel).
 *
 * - Proveedor y galpón destino son OBLIGATORIOS.
 * - Los totales se calculan SIEMPRE acá (nunca se confía en los del cliente);
 *   la DB además verifica subtotal = Σ ítems y total = subtotal − descuento.
 * - Cada ítem es un SABOR (varianteId) y lleva su productoId (= variante.productoId,
 *   lo verifica un trigger).
 * - El stock entra solo al RECIBIR (INGRESO_COMPRA, vía el motor de stock) y
 *   sale solo al ANULAR una recibida (DEVOLUCION_PROVEEDOR).
 * - Recibir actualiza `Variante.ultimoCosto` con el costo de la compra. Cada
 *   VENTA guarda un SNAPSHOT de ese costo al vender (`costoParaVenta` de
 *   `src/lib/precios.ts` → VentaItem.costoUnitario): cambiar el costo después
 *   no cambia la ganancia de las ventas ya hechas.
 * - Opcionalmente, recibir actualiza el precio del proveedor
 *   (ProveedorProducto) con el costo pagado. El precio del proveedor es POR
 *   PRODUCTO: si la compra trae varios sabores del mismo producto con costos
 *   distintos, gana el costo del ÚLTIMO ítem de ese producto (orden de carga).
 * - Una compra recibida no se edita (lo garantiza la DB): se anula.
 * - Costos y totales: solo dueños o `ver` en COMPRAS (el módulo entero ya lo exige).
 */

const dec = (d: Prisma.Decimal | string | number) => new Prisma.Decimal(d).toFixed(2);

async function slugDelPanel(tx: Tx, panelId: string): Promise<string> {
  const panel = await tx.panel.findUnique({ where: { id: panelId }, select: { slug: true } });
  if (!panel) throw new NotFoundError("El panel no existe");
  return panel.slug;
}

// =============================================================================
// Totales
// =============================================================================

export interface TotalesCompra {
  items: {
    varianteId: string;
    cantidad: number;
    costoUnitario: Prisma.Decimal;
    subtotal: Prisma.Decimal;
  }[];
  subtotal: Prisma.Decimal;
  total: Prisma.Decimal;
}

/** subtotal ítem = cantidad × costo · total = Σ ítems. */
export function calcularTotalesCompra(datos: Pick<Compra, "items">): TotalesCompra {
  const items = datos.items.map((i) => {
    const costoUnitario = new Prisma.Decimal(i.costoUnitario).toDecimalPlaces(2);
    return {
      varianteId: i.varianteId,
      cantidad: i.cantidad,
      costoUnitario,
      subtotal: costoUnitario.mul(i.cantidad),
    };
  });
  const subtotal = items.reduce((acc, i) => acc.plus(i.subtotal), new Prisma.Decimal(0));
  return { items, subtotal, total: subtotal };
}

async function bloquearCompra(tx: Tx, ctx: Ctx, id: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "Compra" WHERE "id" = ${id} AND "panelId" = ${ctx.panelId} FOR UPDATE`;
}

/** Valida proveedor y galpón (del panel, activos) y devuelve el productoId de cada sabor. */
async function validarReferencias(tx: Tx, datos: Compra): Promise<Map<string, string>> {
  if (!datos.proveedorId) throw new DomainError("Elegí el proveedor de la compra");
  if (!datos.depositoId) throw new DomainError("Elegí el galpón donde entra la mercadería");
  const [deposito, proveedor, variantes] = await Promise.all([
    tx.deposito.findUnique({
      where: { id: datos.depositoId },
      select: { activo: true, nombre: true },
    }),
    tx.proveedor.findFirst({
      where: { id: datos.proveedorId, deletedAt: null },
      select: { activo: true, nombre: true },
    }),
    tx.variante.findMany({
      where: {
        id: { in: datos.items.map((i) => i.varianteId) },
        deletedAt: null,
        producto: { deletedAt: null },
      },
      select: { id: true, productoId: true },
    }),
  ]);
  if (!deposito) throw new NotFoundError("El galpón no existe");
  if (!deposito.activo) throw new DomainError(`El galpón "${deposito.nombre}" está inactivo`);
  if (!proveedor) throw new NotFoundError("El proveedor no existe o fue dado de baja");
  if (!proveedor.activo) throw new DomainError(`El proveedor "${proveedor.nombre}" está inactivo`);
  if (variantes.length !== datos.items.length)
    throw new NotFoundError("Alguno de los productos no existe o fue dado de baja");
  return new Map(variantes.map((v) => [v.id, v.productoId]));
}

function snapshot(datos: Compra, t: TotalesCompra): Prisma.InputJsonObject {
  return {
    proveedorId: datos.proveedorId,
    depositoId: datos.depositoId,
    total: dec(t.total),
    items: t.items.map((i) => ({
      varianteId: i.varianteId,
      cantidad: i.cantidad,
      costoUnitario: dec(i.costoUnitario),
    })),
  };
}

/**
 * createdAt escalonado (1 ms por ítem): conserva el orden de carga, que
 * define qué costo gana como precio del proveedor (el del último ítem).
 */
function itemsParaCrear(t: TotalesCompra, productoDe: Map<string, string>) {
  const base = Date.now();
  return t.items.map((i, n) => ({
    ...i,
    productoId: productoDe.get(i.varianteId)!,
    createdAt: new Date(base + n),
  }));
}

// =============================================================================
// Escritura
// =============================================================================

/** Crea la compra en BORRADOR (no mueve stock). */
export async function crearCompra(
  ctx: Ctx,
  datos: Compra,
): Promise<{ id: string; numero: number }> {
  return transaccion(ctx, async (tx) => {
    const productoDe = await validarReferencias(tx, datos);
    const t = calcularTotalesCompra(datos);
    const numero = await siguienteNumero(tx, ctx.panelId, "COMPRA");
    const compra = await tx.compra.create({
      data: {
        numero,
        proveedorId: datos.proveedorId,
        depositoId: datos.depositoId,
        fecha: datos.fecha ?? new Date(),
        estado: EstadoCompra.BORRADOR,
        subtotal: t.subtotal,
        descuento: 0,
        total: t.total,
        notas: datos.notas ?? null,
        usuarioId: ctx.usuarioId,
        items: { create: itemsParaCrear(t, productoDe) },
      },
    });
    await registrarAuditoria(tx, {
      usuarioId: ctx.usuarioId,
      accion: AccionAuditoria.CREATE,
      entidad: "Compra",
      entidadId: compra.id,
      datosDespues: { numero: compra.numero, ...snapshot(datos, t) },
      meta: ctx.meta,
    });
    return { id: compra.id, numero: compra.numero };
  });
}

/** Reemplaza los datos e ítems de una compra en BORRADOR. */
export async function actualizarCompra(
  ctx: Ctx,
  id: string,
  datos: Compra,
): Promise<{ id: string; numero: number }> {
  return transaccion(ctx, async (tx) => {
    await bloquearCompra(tx, ctx, id);
    const antes = await tx.compra.findUnique({ where: { id }, include: { items: true } });
    if (!antes) throw new NotFoundError("La compra no existe");
    if (antes.estado !== EstadoCompra.BORRADOR) {
      const idVisible = formatearIdCompra(await slugDelPanel(tx, ctx.panelId), antes.numero);
      throw new DomainError(
        `La compra ${idVisible} está ${antes.estado.toLowerCase()}: solo se editan los borradores.`,
      );
    }
    const productoDe = await validarReferencias(tx, datos);
    const t = calcularTotalesCompra(datos);
    await tx.compraItem.deleteMany({ where: { compraId: id } });
    await tx.compra.update({
      where: { id },
      data: {
        proveedorId: datos.proveedorId,
        depositoId: datos.depositoId,
        // Mismo día que ya tenía → conserva la hora original.
        fecha: datos.fecha && hoyAR(datos.fecha) !== hoyAR(antes.fecha) ? datos.fecha : antes.fecha,
        subtotal: t.subtotal,
        descuento: 0,
        total: t.total,
        notas: datos.notas ?? null,
        items: { create: itemsParaCrear(t, productoDe) },
      },
    });
    await registrarAuditoria(tx, {
      usuarioId: ctx.usuarioId,
      accion: AccionAuditoria.UPDATE,
      entidad: "Compra",
      entidadId: id,
      datosAntes: {
        total: dec(antes.total),
        items: antes.items.map((i) => ({
          varianteId: i.varianteId,
          cantidad: i.cantidad,
          costoUnitario: dec(i.costoUnitario),
        })),
      },
      datosDespues: snapshot(datos, t),
      meta: ctx.meta,
    });
    return { id, numero: antes.numero };
  });
}

/**
 * Costo sugerido por sabor para una compra a `proveedorId`: el precio (en
 * pesos) que ese proveedor tiene cargado para el producto; si no tiene (o lo
 * tiene en dólares), el último costo del sabor; si tampoco, null.
 */
export async function costoSugerido(
  ctx: Ctx,
  proveedorId: string,
  varianteIds: string[],
): Promise<Record<string, { costo: string | null; fuente: "PROVEEDOR" | "ULTIMO_COSTO" | null }>> {
  if (varianteIds.length === 0) return {};
  const db = dbPara(ctx.panelId);
  const variantes = await db.variante.findMany({
    where: { id: { in: varianteIds }, deletedAt: null },
    select: { id: true, productoId: true, ultimoCosto: true },
  });
  const precios = await db.proveedorProducto.findMany({
    where: {
      proveedorId,
      moneda: Moneda.ARS,
      productoId: { in: [...new Set(variantes.map((v) => v.productoId))] },
    },
    select: { productoId: true, precio: true },
  });
  const precioDe = new Map(precios.map((p) => [p.productoId, p.precio]));
  return Object.fromEntries(
    variantes.map((v) => {
      const precio = precioDe.get(v.productoId);
      if (precio) return [v.id, { costo: dec(precio), fuente: "PROVEEDOR" as const }];
      if (v.ultimoCosto)
        return [v.id, { costo: dec(v.ultimoCosto), fuente: "ULTIMO_COSTO" as const }];
      return [v.id, { costo: null, fuente: null }];
    }),
  );
}

export interface CambioPrecioProveedor {
  productoId: string;
  nombreCompleto: string;
  /** null = el proveedor todavía no tenía precio para ese producto. */
  antes: string | null;
  monedaAntes: Moneda | null;
  despues: string;
}

/**
 * Costo por producto que quedaría como precio del proveedor: el del ÚLTIMO
 * ítem de cada producto (orden de carga).
 */
function costoPorProducto(
  items: { productoId: string; costoUnitario: Prisma.Decimal; createdAt: Date; id: string }[],
): Map<string, Prisma.Decimal> {
  const orden = [...items].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
  );
  return new Map(orden.map((i) => [i.productoId, i.costoUnitario]));
}

async function calcularCambiosDePrecio(tx: Tx, compraId: string): Promise<CambioPrecioProveedor[]> {
  const compra = await tx.compra.findUnique({
    where: { id: compraId },
    select: {
      proveedorId: true,
      items: {
        select: {
          id: true,
          productoId: true,
          costoUnitario: true,
          createdAt: true,
          producto: { select: { nombreCompleto: true } },
        },
      },
    },
  });
  if (!compra) throw new NotFoundError("La compra no existe");
  if (!compra.proveedorId) return [];
  const porProducto = costoPorProducto(compra.items);
  const actuales = await tx.proveedorProducto.findMany({
    where: { proveedorId: compra.proveedorId, productoId: { in: [...porProducto.keys()] } },
    select: { productoId: true, precio: true, moneda: true },
  });
  const actualDe = new Map(actuales.map((a) => [a.productoId, a]));
  const nombreDe = new Map(compra.items.map((i) => [i.productoId, i.producto.nombreCompleto]));
  return [...porProducto.entries()]
    .flatMap(([productoId, costo]) => {
      const actual = actualDe.get(productoId);
      if (actual && actual.moneda === Moneda.ARS && actual.precio.equals(costo)) return [];
      return [
        {
          productoId,
          nombreCompleto: nombreDe.get(productoId) ?? "",
          antes: actual ? dec(actual.precio) : null,
          monedaAntes: actual?.moneda ?? null,
          despues: dec(costo),
        },
      ];
    })
    .sort((a, b) => a.nombreCompleto.localeCompare(b.nombreCompleto));
}

/** Para el Dialog de "Recibir": productos cuyo precio del proveedor cambiaría (de $X a $Y). */
export async function preciosQueCambian(
  ctx: Ctx,
  compraId: string,
): Promise<CambioPrecioProveedor[]> {
  return calcularCambiosDePrecio(dbPara(ctx.panelId), compraId);
}

/**
 * Recibe la mercadería: un INGRESO_COMPRA por ítem (con su costo y la
 * referencia a la compra) en el galpón de la compra, y `ultimoCosto` de cada
 * sabor = costo de esta compra. Con `actualizarPrecioProveedor`, el precio
 * del proveedor para cada producto pasa a ser el costo pagado (ver arriba:
 * último ítem de cada producto). Transacción Serializable; si ya está
 * recibida → DomainError (no duplica stock).
 */
export async function recibirCompra(
  ctx: Ctx,
  id: string,
  opciones: { actualizarPrecioProveedor: boolean },
): Promise<{ numero: number; unidades: number; preciosActualizados: number }> {
  return transaccion(
    ctx,
    async (tx) => {
      await bloquearCompra(tx, ctx, id);
      const compra = await tx.compra.findUnique({
        where: { id },
        include: { items: true, deposito: true },
      });
      if (!compra) throw new NotFoundError("La compra no existe");
      const idVisible = formatearIdCompra(await slugDelPanel(tx, ctx.panelId), compra.numero);
      if (compra.estado === EstadoCompra.RECIBIDA)
        throw new DomainError(`La compra ${idVisible} ya fue recibida.`);
      if (compra.estado === EstadoCompra.ANULADA)
        throw new DomainError(`La compra ${idVisible} está anulada.`);
      if (!compra.depositoId)
        throw new DomainError("Elegí el galpón donde entra la mercadería antes de recibirla.");
      if (!compra.deposito.activo)
        throw new DomainError(`El galpón "${compra.deposito.nombre}" está inactivo`);
      if (compra.items.length === 0) throw new DomainError("La compra no tiene productos.");

      const cambios =
        opciones.actualizarPrecioProveedor && compra.proveedorId
          ? await calcularCambiosDePrecio(tx, id)
          : [];

      // Orden fijo por variante: mismo orden de bloqueo que el resto del sistema.
      for (const item of [...compra.items].sort((a, b) =>
        a.varianteId.localeCompare(b.varianteId),
      )) {
        await registrarMovimiento(tx, {
          tipo: TipoMovimiento.INGRESO_COMPRA,
          varianteId: item.varianteId,
          depositoId: compra.depositoId,
          cantidad: item.cantidad,
          costoUnitario: item.costoUnitario,
          motivo: `Compra ${idVisible}`,
          referenciaTipo: "COMPRA",
          referenciaId: compra.id,
          usuarioId: ctx.usuarioId,
        });
        await tx.variante.update({
          where: { id: item.varianteId },
          data: { ultimoCosto: item.costoUnitario },
        });
      }

      if (compra.proveedorId) {
        for (const c of cambios) {
          await asignarProducto(
            ctx,
            compra.proveedorId,
            { productoId: c.productoId, precio: Number(c.despues), moneda: Moneda.ARS },
            tx,
          );
        }
      }

      await tx.compra.update({ where: { id }, data: { estado: EstadoCompra.RECIBIDA } });
      await registrarAuditoria(tx, {
        usuarioId: ctx.usuarioId,
        accion: AccionAuditoria.UPDATE,
        entidad: "Compra",
        entidadId: id,
        datosAntes: { estado: "BORRADOR" },
        datosDespues: {
          estado: "RECIBIDA",
          actualizarPrecioProveedor: opciones.actualizarPrecioProveedor,
          preciosActualizados: cambios.length,
        },
        meta: ctx.meta,
      });
      return {
        numero: compra.numero,
        unidades: compra.items.reduce((a, i) => a + i.cantidad, 0),
        preciosActualizados: cambios.length,
      };
    },
    { timeout: 60_000, maxRetries: 2 },
  );
}

/**
 * Anula la compra. Si estaba RECIBIDA, devuelve la mercadería al proveedor
 * (DEVOLUCION_PROVEEDOR por ítem): si ya no hay stock suficiente en el
 * galpón, falla completa con el detalle y la compra queda como estaba.
 * No revierte `ultimoCosto` ni precios de proveedor.
 */
export async function anularCompra(
  ctx: Ctx,
  id: string,
  motivo: string,
): Promise<{ numero: number; devoluciones: number }> {
  return transaccion(
    ctx,
    async (tx) => {
      await bloquearCompra(tx, ctx, id);
      const compra = await tx.compra.findUnique({
        where: { id },
        include: {
          deposito: { select: { nombre: true } },
          items: {
            include: {
              variante: {
                select: { nombre: true, producto: { select: { nombreCompleto: true } } },
              },
            },
          },
        },
      });
      if (!compra) throw new NotFoundError("La compra no existe");
      const idVisible = formatearIdCompra(await slugDelPanel(tx, ctx.panelId), compra.numero);
      if (compra.estado === EstadoCompra.ANULADA)
        throw new DomainError(`La compra ${idVisible} ya está anulada.`);

      let devoluciones = 0;
      if (compra.estado === EstadoCompra.RECIBIDA) {
        // Chequeo previo para informar todos los faltantes juntos.
        const stocks = await tx.stock.findMany({
          where: {
            depositoId: compra.depositoId,
            varianteId: { in: compra.items.map((i) => i.varianteId) },
          },
          select: { varianteId: true, cantidad: true },
        });
        const disp = new Map(stocks.map((s) => [s.varianteId, s.cantidad]));
        const faltan = compra.items
          .filter((i) => (disp.get(i.varianteId) ?? 0) < i.cantidad)
          .map(
            (i) =>
              `${nombreItem(i.variante)}: hay ${disp.get(i.varianteId) ?? 0}, se devuelven ${i.cantidad}`,
          );
        if (faltan.length) {
          throw new DomainError(
            `No se puede anular la compra ${idVisible}: ya no está todo el stock en ${compra.deposito.nombre}. ${faltan.join(" · ")}`,
            "STOCK_INSUFICIENTE",
            409,
          );
        }
        try {
          for (const item of [...compra.items].sort((a, b) =>
            a.varianteId.localeCompare(b.varianteId),
          )) {
            await registrarMovimiento(tx, {
              tipo: TipoMovimiento.DEVOLUCION_PROVEEDOR,
              varianteId: item.varianteId,
              depositoId: compra.depositoId,
              cantidad: item.cantidad,
              costoUnitario: item.costoUnitario,
              motivo: `Anulación compra ${idVisible}: ${motivo}`,
              referenciaTipo: "COMPRA",
              referenciaId: compra.id,
              usuarioId: ctx.usuarioId,
            });
            devoluciones++;
          }
        } catch (e) {
          if (e instanceof StockInsuficienteError) {
            throw new DomainError(
              `No se puede anular la compra ${idVisible}: ${e.message}`,
              "STOCK_INSUFICIENTE",
              409,
            );
          }
          throw e;
        }
      }

      const notas = [compra.notas, `[Anulada] ${motivo}`].filter(Boolean).join("\n");
      await tx.compra.update({ where: { id }, data: { estado: EstadoCompra.ANULADA, notas } });
      await registrarAuditoria(tx, {
        usuarioId: ctx.usuarioId,
        accion: AccionAuditoria.UPDATE,
        entidad: "Compra",
        entidadId: id,
        datosAntes: { estado: compra.estado },
        datosDespues: { estado: "ANULADA", motivo, devoluciones },
        meta: ctx.meta,
      });
      return { numero: compra.numero, devoluciones };
    },
    { timeout: 60_000, maxRetries: 2 },
  );
}

/** "Elf Bar BC 5000 — Mango Ice"; el sabor "Único" no se muestra. */
function nombreItem(v: { nombre: string; producto: { nombreCompleto: string } }): string {
  return esSaborUnico(v.nombre)
    ? v.producto.nombreCompleto
    : `${v.producto.nombreCompleto} — ${v.nombre}`;
}

const esSaborUnico = (nombre: string) => nombre.trim().toLowerCase() === "único";

// =============================================================================
// Lectura
// =============================================================================

export interface CompraListada {
  id: string;
  numero: number;
  fecha: Date;
  estado: EstadoCompra;
  proveedor: string | null;
  proveedorId: string | null;
  deposito: string;
  items: number;
  unidades: number;
  total: string;
  usuario: string;
}

export async function listarCompras(
  ctx: Ctx,
  f: FiltrosCompras,
): Promise<{ compras: CompraListada[]; total: number; page: number; pageSize: number }> {
  const where: Prisma.CompraWhereInput = {};
  if (f.estado) where.estado = f.estado;
  if (f.proveedorId) where.proveedorId = f.proveedorId;
  if (f.desde || f.hasta) {
    where.fecha = {
      ...(f.desde ? { gte: inicioDelDia(f.desde) } : {}),
      ...(f.hasta ? { lte: finDelDia(f.hasta) } : {}),
    };
  }
  const db = dbPara(ctx.panelId);
  const [total, filas] = await Promise.all([
    db.compra.count({ where }),
    db.compra.findMany({
      where,
      orderBy: { numero: "desc" },
      skip: (f.page - 1) * f.pageSize,
      take: f.pageSize,
      include: {
        proveedor: { select: { nombre: true, nombreTienda: true } },
        deposito: { select: { nombre: true } },
        usuario: { select: { nombre: true } },
        items: { select: { cantidad: true } },
      },
    }),
  ]);
  return {
    compras: filas.map((c) => ({
      id: c.id,
      numero: c.numero,
      fecha: c.fecha,
      estado: c.estado,
      proveedor: c.proveedor ? `${c.proveedor.nombre} (${c.proveedor.nombreTienda})` : null,
      proveedorId: c.proveedorId,
      deposito: c.deposito.nombre,
      items: c.items.length,
      unidades: c.items.reduce((a, i) => a + i.cantidad, 0),
      total: dec(c.total),
      usuario: c.usuario.nombre,
    })),
    total,
    page: f.page,
    pageSize: f.pageSize,
  };
}

export interface ItemCompraDetalle {
  varianteId: string;
  productoId: string;
  nombreCompleto: string;
  /** null = sabor "Único" (no se muestra). */
  sabor: string | null;
  sku: string;
  codigoBarras: string | null;
  cantidad: number;
  costoUnitario: string;
  subtotal: string;
}

export interface CompraDetalle extends Omit<CompraListada, "items"> {
  depositoId: string;
  proveedorNombre: string | null;
  proveedorTienda: string | null;
  subtotal: string;
  notas: string | null;
  items: ItemCompraDetalle[];
  movimientos: number;
}

export async function obtenerCompra(ctx: Ctx, id: string): Promise<CompraDetalle> {
  const db = dbPara(ctx.panelId);
  const c = await db.compra.findUnique({
    where: { id },
    include: {
      proveedor: { select: { nombre: true, nombreTienda: true } },
      deposito: { select: { nombre: true } },
      usuario: { select: { nombre: true } },
      items: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        include: {
          variante: {
            select: {
              nombre: true,
              sku: true,
              codigoBarras: true,
              producto: { select: { nombreCompleto: true } },
            },
          },
        },
      },
    },
  });
  if (!c) throw new NotFoundError("La compra no existe");
  const movimientos = await db.movimientoStock.count({
    where: { referenciaTipo: "COMPRA", referenciaId: id },
  });
  return {
    id: c.id,
    numero: c.numero,
    fecha: c.fecha,
    estado: c.estado,
    proveedor: c.proveedor ? `${c.proveedor.nombre} (${c.proveedor.nombreTienda})` : null,
    proveedorId: c.proveedorId,
    proveedorNombre: c.proveedor?.nombre ?? null,
    proveedorTienda: c.proveedor?.nombreTienda ?? null,
    deposito: c.deposito.nombre,
    depositoId: c.depositoId,
    usuario: c.usuario.nombre,
    unidades: c.items.reduce((a, i) => a + i.cantidad, 0),
    subtotal: dec(c.subtotal),
    total: dec(c.total),
    notas: c.notas,
    movimientos,
    items: c.items.map((i) => ({
      varianteId: i.varianteId,
      productoId: i.productoId,
      nombreCompleto: i.variante.producto.nombreCompleto,
      sabor: esSaborUnico(i.variante.nombre) ? null : i.variante.nombre,
      sku: i.variante.sku,
      codigoBarras: i.variante.codigoBarras,
      cantidad: i.cantidad,
      costoUnitario: dec(i.costoUnitario),
      subtotal: dec(i.subtotal),
    })),
  };
}
