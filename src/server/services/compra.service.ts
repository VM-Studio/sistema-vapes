import { AccionAuditoria, EstadoCompra, Prisma, TipoMovimiento } from "@prisma/client";

import { finDelDia, hoyAR, inicioDelDia } from "@/lib/fechas";
import { prisma, withTransaction, type Tx } from "@/lib/db";
import type { Compra, FiltrosCompras } from "@/lib/validations/compra";
import { DomainError, NotFoundError, StockInsuficienteError } from "@/server/errors";
import type { Actor } from "@/server/services/actor";
import { registrarAuditoria } from "@/server/services/audit.service";
import { actualizarPrecios, nombreCompleto } from "@/server/services/producto.service";
import { registrarMovimiento } from "@/server/services/stock.service";

/**
 * COMPRAS a proveedores.
 * - Los totales se calculan SIEMPRE acá (nunca se confía en los del cliente);
 *   la DB además verifica subtotal = Σ ítems y total = subtotal − descuento.
 * - El stock entra solo al RECIBIR (INGRESO_COMPRA, vía el motor de stock) y
 *   sale solo al ANULAR una recibida (DEVOLUCION_PROVEEDOR).
 * - Una compra recibida no se edita (lo garantiza la DB): se anula.
 */

const dec = (d: Prisma.Decimal | string | number) => new Prisma.Decimal(d).toFixed(2);

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
  descuento: Prisma.Decimal;
  total: Prisma.Decimal;
}

/** subtotal ítem = cantidad × costo · subtotal = Σ ítems · total = subtotal − descuento. */
export function calcularTotalesCompra(datos: Pick<Compra, "items" | "descuento">): TotalesCompra {
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
  const descuento = new Prisma.Decimal(datos.descuento).toDecimalPlaces(2);
  if (descuento.greaterThan(subtotal)) {
    throw new DomainError("El descuento no puede superar el subtotal", "VALIDATION_ERROR", 400, {
      descuento: [`Máximo ${dec(subtotal)}`],
    });
  }
  return { items, subtotal, descuento, total: subtotal.minus(descuento) };
}

async function validarReferencias(tx: Tx, datos: Compra) {
  const [deposito, proveedor, variantes] = await Promise.all([
    tx.deposito.findUnique({
      where: { id: datos.depositoId },
      select: { activo: true, nombre: true },
    }),
    datos.proveedorId
      ? tx.proveedor.findFirst({
          where: { id: datos.proveedorId, deletedAt: null },
          select: { activo: true, nombre: true },
        })
      : Promise.resolve(null),
    tx.variante.count({
      where: { id: { in: datos.items.map((i) => i.varianteId) }, deletedAt: null },
    }),
  ]);
  if (!deposito) throw new NotFoundError("El depósito no existe");
  if (!deposito.activo) throw new DomainError(`El depósito "${deposito.nombre}" está inactivo`);
  if (datos.proveedorId && !proveedor)
    throw new NotFoundError("El proveedor no existe o fue dado de baja");
  if (proveedor && !proveedor.activo)
    throw new DomainError(`El proveedor "${proveedor.nombre}" está inactivo`);
  if (variantes !== datos.items.length)
    throw new NotFoundError("Alguno de los productos no existe o fue dado de baja");
}

function snapshot(datos: Compra, t: TotalesCompra): Prisma.InputJsonObject {
  return {
    proveedorId: datos.proveedorId ?? null,
    depositoId: datos.depositoId,
    descuento: dec(t.descuento),
    total: dec(t.total),
    items: t.items.map((i) => ({
      varianteId: i.varianteId,
      cantidad: i.cantidad,
      costoUnitario: dec(i.costoUnitario),
    })),
  };
}

// =============================================================================
// Escritura
// =============================================================================

/** Crea la compra en BORRADOR (no mueve stock). */
export async function crearCompra(
  datos: Compra,
  actor: Actor,
): Promise<{ id: string; numero: number }> {
  return withTransaction(async (tx) => {
    await validarReferencias(tx, datos);
    const t = calcularTotalesCompra(datos);
    const compra = await tx.compra.create({
      data: {
        proveedorId: datos.proveedorId ?? null,
        depositoId: datos.depositoId,
        fecha: datos.fecha ?? new Date(),
        estado: EstadoCompra.BORRADOR,
        subtotal: t.subtotal,
        descuento: t.descuento,
        total: t.total,
        notas: datos.notas ?? null,
        usuarioId: actor.id,
        items: { create: t.items.map((i) => ({ ...i })) },
      },
    });
    await registrarAuditoria(tx, {
      usuarioId: actor.id,
      accion: AccionAuditoria.CREATE,
      entidad: "Compra",
      entidadId: compra.id,
      datosDespues: { numero: compra.numero, ...snapshot(datos, t) },
      meta: actor.meta,
    });
    return { id: compra.id, numero: compra.numero };
  });
}

/** Reemplaza los datos e ítems de una compra en BORRADOR. */
export async function actualizarCompra(
  id: string,
  datos: Compra,
  actor: Actor,
): Promise<{ id: string; numero: number }> {
  return withTransaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Compra" WHERE "id" = ${id} FOR UPDATE`;
    const antes = await tx.compra.findUnique({ where: { id }, include: { items: true } });
    if (!antes) throw new NotFoundError("La compra no existe");
    if (antes.estado !== EstadoCompra.BORRADOR) {
      throw new DomainError(
        `La compra #${antes.numero} está ${antes.estado.toLowerCase()}: solo se editan los borradores.`,
      );
    }
    await validarReferencias(tx, datos);
    const t = calcularTotalesCompra(datos);
    await tx.compraItem.deleteMany({ where: { compraId: id } });
    await tx.compra.update({
      where: { id },
      data: {
        proveedorId: datos.proveedorId ?? null,
        depositoId: datos.depositoId,
        // Mismo día que ya tenía → conserva la hora original.
        fecha: datos.fecha && hoyAR(datos.fecha) !== hoyAR(antes.fecha) ? datos.fecha : antes.fecha,
        subtotal: t.subtotal,
        descuento: t.descuento,
        total: t.total,
        notas: datos.notas ?? null,
        items: { create: t.items.map((i) => ({ ...i })) },
      },
    });
    await registrarAuditoria(tx, {
      usuarioId: actor.id,
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
      meta: actor.meta,
    });
    return { id, numero: antes.numero };
  });
}

/**
 * Recibe la mercadería: un INGRESO_COMPRA por ítem (con su costo y la
 * referencia a la compra). Con `actualizarCostos`, el precioCosto de cada
 * variante pasa a ser el de esta compra (queda HistorialPrecio).
 * Transacción Serializable; si ya está recibida → DomainError (idempotente).
 */
export async function recibirCompra(
  id: string,
  actor: Actor,
  opciones: { actualizarCostos: boolean },
): Promise<{ numero: number; unidades: number; costosActualizados: number }> {
  return withTransaction(
    async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Compra" WHERE "id" = ${id} FOR UPDATE`;
      const compra = await tx.compra.findUnique({
        where: { id },
        include: { items: true, deposito: true },
      });
      if (!compra) throw new NotFoundError("La compra no existe");
      if (compra.estado === EstadoCompra.RECIBIDA)
        throw new DomainError(`La compra #${compra.numero} ya fue recibida.`);
      if (compra.estado === EstadoCompra.ANULADA)
        throw new DomainError(`La compra #${compra.numero} está anulada.`);
      if (!compra.deposito.activo)
        throw new DomainError(`El depósito "${compra.deposito.nombre}" está inactivo`);

      let costosActualizados = 0;
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
          motivo: `Compra #${compra.numero}`,
          referenciaTipo: "COMPRA",
          referenciaId: compra.id,
          usuarioId: actor.id,
        });
        if (opciones.actualizarCostos) {
          const r = await actualizarPrecios(
            item.varianteId,
            { precioCosto: Number(item.costoUnitario) },
            actor,
            `Compra #${compra.numero}`,
            tx,
          );
          costosActualizados += r.actualizadas;
        }
      }

      await tx.compra.update({ where: { id }, data: { estado: EstadoCompra.RECIBIDA } });
      await registrarAuditoria(tx, {
        usuarioId: actor.id,
        accion: AccionAuditoria.UPDATE,
        entidad: "Compra",
        entidadId: id,
        datosAntes: { estado: "BORRADOR" },
        datosDespues: {
          estado: "RECIBIDA",
          actualizarCostos: opciones.actualizarCostos,
          costosActualizados,
        },
        meta: actor.meta,
      });
      return {
        numero: compra.numero,
        unidades: compra.items.reduce((a, i) => a + i.cantidad, 0),
        costosActualizados,
      };
    },
    { timeout: 60_000, maxRetries: 2 },
  );
}

/**
 * Anula la compra. Si estaba RECIBIDA, devuelve la mercadería al proveedor
 * (DEVOLUCION_PROVEEDOR por ítem): si ya no hay stock suficiente en el
 * depósito, falla completa con el detalle y la compra queda como estaba.
 */
export async function anularCompra(
  id: string,
  motivo: string,
  actor: Actor,
): Promise<{ numero: number; devoluciones: number }> {
  return withTransaction(
    async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Compra" WHERE "id" = ${id} FOR UPDATE`;
      const compra = await tx.compra.findUnique({
        where: { id },
        include: {
          deposito: { select: { nombre: true } },
          items: {
            include: {
              variante: {
                select: {
                  nombre: true,
                  producto: { select: { nombre: true, tieneVariantes: true } },
                },
              },
            },
          },
        },
      });
      if (!compra) throw new NotFoundError("La compra no existe");
      if (compra.estado === EstadoCompra.ANULADA)
        throw new DomainError(`La compra #${compra.numero} ya está anulada.`);

      let devoluciones = 0;
      if (compra.estado === EstadoCompra.RECIBIDA) {
        // Chequeo previo para informar TODOS los faltantes juntos.
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
              `${nombreCompleto(i.variante.producto.nombre, i.variante.nombre, i.variante.producto.tieneVariantes)}: hay ${disp.get(i.varianteId) ?? 0}, se devuelven ${i.cantidad}`,
          );
        if (faltan.length) {
          throw new DomainError(
            `No se puede anular la compra #${compra.numero}: ya no está todo el stock en ${compra.deposito.nombre}. ${faltan.join(" · ")}`,
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
              motivo: `Anulación compra #${compra.numero}: ${motivo}`,
              referenciaTipo: "COMPRA",
              referenciaId: compra.id,
              usuarioId: actor.id,
            });
            devoluciones++;
          }
        } catch (e) {
          if (e instanceof StockInsuficienteError) {
            throw new DomainError(
              `No se puede anular la compra #${compra.numero}: ${e.message}`,
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
        usuarioId: actor.id,
        accion: AccionAuditoria.UPDATE,
        entidad: "Compra",
        entidadId: id,
        datosAntes: { estado: compra.estado },
        datosDespues: { estado: "ANULADA", motivo, devoluciones },
        meta: actor.meta,
      });
      return { numero: compra.numero, devoluciones };
    },
    { timeout: 60_000, maxRetries: 2 },
  );
}

// =============================================================================
// Lectura
// =============================================================================

export interface CompraListada {
  id: string;
  numero: number;
  fecha: Date;
  estado: EstadoCompra;
  proveedor: string | null;
  deposito: string;
  items: number;
  unidades: number;
  total: string;
  usuario: string;
}

export async function listarCompras(
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
  const [total, filas] = await Promise.all([
    prisma.compra.count({ where }),
    prisma.compra.findMany({
      where,
      orderBy: { numero: "desc" },
      skip: (f.page - 1) * f.pageSize,
      take: f.pageSize,
      include: {
        proveedor: { select: { nombre: true } },
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
      proveedor: c.proveedor?.nombre ?? null,
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
  nombre: string;
  sku: string;
  codigoBarras: string | null;
  cantidad: number;
  costoUnitario: string;
  subtotal: string;
  /** Costo actual de la variante (para mostrar qué cambia si se actualizan costos). */
  precioCostoActual: string;
}

export interface CompraDetalle extends Omit<CompraListada, "items" | "total"> {
  proveedorId: string | null;
  depositoId: string;
  subtotal: string;
  descuento: string;
  total: string;
  notas: string | null;
  items: ItemCompraDetalle[];
  movimientos: number;
}

export async function obtenerCompra(id: string): Promise<CompraDetalle> {
  const c = await prisma.compra.findUnique({
    where: { id },
    include: {
      proveedor: { select: { nombre: true } },
      deposito: { select: { nombre: true } },
      usuario: { select: { nombre: true } },
      items: {
        orderBy: { createdAt: "asc" },
        include: {
          variante: {
            select: {
              nombre: true,
              sku: true,
              codigoBarras: true,
              precioCosto: true,
              producto: { select: { nombre: true, tieneVariantes: true } },
            },
          },
        },
      },
    },
  });
  if (!c) throw new NotFoundError("La compra no existe");
  const movimientos = await prisma.movimientoStock.count({
    where: { referenciaTipo: "COMPRA", referenciaId: id },
  });
  return {
    id: c.id,
    numero: c.numero,
    fecha: c.fecha,
    estado: c.estado,
    proveedor: c.proveedor?.nombre ?? null,
    proveedorId: c.proveedorId,
    deposito: c.deposito.nombre,
    depositoId: c.depositoId,
    usuario: c.usuario.nombre,
    unidades: c.items.reduce((a, i) => a + i.cantidad, 0),
    subtotal: dec(c.subtotal),
    descuento: dec(c.descuento),
    total: dec(c.total),
    notas: c.notas,
    movimientos,
    items: c.items.map((i) => ({
      varianteId: i.varianteId,
      nombre: nombreCompleto(
        i.variante.producto.nombre,
        i.variante.nombre,
        i.variante.producto.tieneVariantes,
      ),
      sku: i.variante.sku,
      codigoBarras: i.variante.codigoBarras,
      cantidad: i.cantidad,
      costoUnitario: dec(i.costoUnitario),
      subtotal: dec(i.subtotal),
      precioCostoActual: dec(i.variante.precioCosto),
    })),
  };
}
