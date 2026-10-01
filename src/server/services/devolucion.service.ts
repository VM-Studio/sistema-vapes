import {
  AccionAuditoria,
  EstadoDevolucion,
  EstadoVenta,
  Prisma,
  TipoMovimiento,
} from "@prisma/client";

import { finDelDia, inicioDelDia } from "@/lib/fechas";
import { nombreConSabor } from "@/lib/ventas-ui";
import { formatearIdDevolucion, type RegistrarDevolucion } from "@/lib/validations/devolucion";
import { dbPara, transaccion, type Ctx } from "@/server/db/panel-scoped";
import { siguienteNumero } from "@/server/db/secuencia";
import { DomainError, NotFoundError, StockInsuficienteError } from "@/server/errors";
import { registrarAuditoria } from "@/server/services/audit.service";
import type { VarianteEncontrada } from "@/features/scanner/tipos";
import { obtenerVariantesPorId, type CtxCatalogo } from "@/server/services/producto.service";
import { registrarMovimiento } from "@/server/services/stock.service";
import { ventasDeCliente } from "@/server/services/venta.service";

/**
 * DEVOLUCIONES POR GARANTÍA (por panel).
 *
 * El cliente trae un producto fallado (no vuelve al stock) y se le entrega una
 * unidad NUEVA, que se descuenta del galpón elegido (movimiento GARANTIA). La
 * unidad nueva puede ser:
 * - el mismo sabor (garantía pura, sin plata de por medio);
 * - otro sabor u otro modelo (no hay stock del mismo o el cliente prefiere
 *   otro): se compara el precio de lista actual de lo devuelto y lo entregado.
 *   Si lo entregado es más caro, el cliente paga la diferencia; si es más
 *   barato, se le devuelve. Se puede bonificar (cobrar o devolver menos),
 *   nunca más que la diferencia ni al revés.
 *
 * Vinculada a una venta: solo se pueden devolver sabores de esa venta y hasta
 * lo vendido menos lo ya devuelto (lo controla el servidor, no solo la UI).
 * La diferencia cobrada o devuelta entra en "Cobrado" y "Medios de pago" del
 * dashboard. Anular (solo dueños) repone la unidad entregada con
 * GARANTIA_ANULADA y saca la diferencia de lo cobrado.
 */

export interface DevolucionRegistrada {
  id: string;
  codigo: string;
  /** Advertencias que no bloquean. */
  avisos: string[];
}

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const r2 = (d: Prisma.Decimal) => d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

interface ItemConsolidado {
  varianteId: string;
  varianteEntregadaId: string;
  cantidad: number;
}

/**
 * Suma cantidades repetidas del mismo cambio (devuelto → entregado) y ordena
 * por el sabor entregado, que es el que se descuenta (orden de bloqueo del stock).
 */
function consolidar(items: RegistrarDevolucion["items"]): ItemConsolidado[] {
  const porCambio = new Map<string, ItemConsolidado>();
  for (const i of items) {
    const entregada = i.varianteEntregadaId ?? i.varianteId;
    const clave = `${i.varianteId}|${entregada}`;
    const previo = porCambio.get(clave);
    porCambio.set(clave, {
      varianteId: i.varianteId,
      varianteEntregadaId: entregada,
      cantidad: (previo?.cantidad ?? 0) + i.cantidad,
    });
  }
  return [...porCambio.values()].sort((a, b) =>
    a.varianteEntregadaId === b.varianteEntregadaId
      ? a.varianteId < b.varianteId
        ? -1
        : 1
      : a.varianteEntregadaId < b.varianteEntregadaId
        ? -1
        : 1,
  );
}

/** Cuánto se puede devolver todavía de cada sabor de una venta (vendido − ya devuelto). */
async function disponiblesDeVenta(
  tx: Prisma.TransactionClient,
  ventaId: string,
): Promise<Map<string, { vendido: number; devuelto: number }>> {
  const [items, previas] = await Promise.all([
    tx.ventaItem.findMany({ where: { ventaId }, select: { varianteId: true, cantidad: true } }),
    tx.devolucionItem.groupBy({
      by: ["varianteId"],
      where: { devolucion: { ventaId, estado: EstadoDevolucion.REGISTRADA } },
      _sum: { cantidad: true },
    }),
  ]);
  const r = new Map<string, { vendido: number; devuelto: number }>();
  for (const i of items) {
    const x = r.get(i.varianteId) ?? { vendido: 0, devuelto: 0 };
    r.set(i.varianteId, { ...x, vendido: x.vendido + i.cantidad });
  }
  for (const p of previas) {
    const x = r.get(p.varianteId) ?? { vendido: 0, devuelto: 0 };
    r.set(p.varianteId, { ...x, devuelto: p._sum.cantidad ?? 0 });
  }
  return r;
}

export async function registrarDevolucion(
  ctx: Ctx,
  input: RegistrarDevolucion,
): Promise<DevolucionRegistrada> {
  const observacion = input.observacion.trim();
  const items = consolidar(input.items);
  if (items.length === 0) throw new DomainError("Agregá al menos un producto");

  return transaccion(ctx, async (tx) => {
    const [deposito, cliente, panel] = await Promise.all([
      tx.deposito.findFirst({
        where: { id: input.depositoId },
        select: { nombre: true, activo: true },
      }),
      tx.cliente.findFirst({
        where: { id: input.clienteId, deletedAt: null },
        select: { id: true, nombre: true },
      }),
      tx.panel.findUniqueOrThrow({ where: { id: ctx.panelId }, select: { slug: true } }),
    ]);
    if (!deposito) throw new NotFoundError("El galpón no existe");
    if (!deposito.activo) throw new DomainError(`El galpón ${deposito.nombre} está desactivado`);
    if (!cliente) throw new NotFoundError("El cliente no existe");

    const ids = [...new Set(items.flatMap((i) => [i.varianteId, i.varianteEntregadaId]))];
    const variantes = await tx.variante.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        productoId: true,
        nombre: true,
        precioVenta: true,
        activo: true,
        deletedAt: true,
        producto: {
          select: { nombreCompleto: true, precioVenta: true, activo: true, deletedAt: true },
        },
      },
    });
    const variante = new Map(variantes.map((v) => [v.id, v]));
    if (ids.some((id) => !variante.has(id)))
      throw new NotFoundError("Uno de los productos no existe en este panel");
    const titulo = (varianteId: string) => {
      const v = variante.get(varianteId)!;
      return nombreConSabor(v.producto.nombreCompleto, v.nombre);
    };
    /** Precio de lista vigente: el del sabor o, si no tiene, el del producto. */
    const precio = (varianteId: string) => {
      const v = variante.get(varianteId)!;
      return D(v.precioVenta ?? v.producto.precioVenta);
    };
    for (const i of items) {
      if (i.varianteEntregadaId === i.varianteId) continue;
      const e = variante.get(i.varianteEntregadaId)!;
      if (e.deletedAt || e.producto.deletedAt || !e.activo || !e.producto.activo)
        throw new DomainError(
          `${titulo(i.varianteEntregadaId)} está desactivado: elegí otro para entregar`,
        );
    }

    const avisos: string[] = [];
    let ventaCodigo: string | null = null;
    if (input.ventaId) {
      const venta = await tx.venta.findFirst({
        where: { id: input.ventaId },
        select: { codigo: true, clienteId: true, estado: true },
      });
      if (!venta) throw new NotFoundError("La venta vinculada no existe");
      if (venta.clienteId !== cliente.id)
        throw new DomainError(`La venta ${venta.codigo} no es de ${cliente.nombre}`);
      if (venta.estado === EstadoVenta.ANULADA)
        throw new DomainError(`La venta ${venta.codigo} está anulada: no se puede devolver`);
      ventaCodigo = venta.codigo;

      // Se puede devolver hasta lo vendido de cada sabor, menos lo ya devuelto.
      const disponibles = await disponiblesDeVenta(tx, input.ventaId);
      const pedido = new Map<string, number>();
      for (const i of items) pedido.set(i.varianteId, (pedido.get(i.varianteId) ?? 0) + i.cantidad);
      for (const [varianteId, cantidad] of pedido) {
        const d = disponibles.get(varianteId);
        if (!d || d.vendido === 0)
          throw new DomainError(`${titulo(varianteId)} no está en la venta ${venta.codigo}`);
        const quedan = d.vendido - d.devuelto;
        if (cantidad > quedan)
          throw new DomainError(
            `${titulo(varianteId)}: en la venta ${venta.codigo} se vendieron ${d.vendido}` +
              (d.devuelto > 0 ? ` y ya se devolvieron ${d.devuelto}` : "") +
              `; se pueden devolver hasta ${quedan}.`,
            "CANTIDAD_MAYOR_A_LO_VENDIDO",
          );
      }
    }

    // Diferencia de precio: Σ (entregado − devuelto) × cantidad, a precios de lista vigentes.
    const conPrecios = items.map((i) => {
      const precioDevuelto = precio(i.varianteId);
      // El mismo sabor nunca genera diferencia (aunque el precio haya cambiado).
      const precioEntregado =
        i.varianteEntregadaId === i.varianteId ? precioDevuelto : precio(i.varianteEntregadaId);
      return { ...i, precioDevuelto, precioEntregado };
    });
    const diferenciaCalculada = r2(
      conPrecios.reduce(
        (a, i) => a.add(i.precioEntregado.sub(i.precioDevuelto).mul(i.cantidad)),
        D(0),
      ),
    );
    if (
      input.diferenciaVista !== undefined &&
      !r2(D(input.diferenciaVista)).equals(diferenciaCalculada)
    ) {
      throw new DomainError(
        `Los precios cambiaron mientras registrabas la devolución: la diferencia ahora es ` +
          `$ ${diferenciaCalculada.abs().toFixed(2)}. Revisala y confirmá de nuevo.`,
        "PRECIOS_CAMBIARON",
        409,
      );
    }
    const maximo = diferenciaCalculada.abs();
    const monto = r2(D(input.montoDiferencia ?? maximo));
    if (monto.gt(maximo))
      throw new DomainError(
        `No se puede ${diferenciaCalculada.isPositive() ? "cobrar" : "devolver"} más que la diferencia ($ ${maximo.toFixed(2)})`,
      );
    const diferencia = diferenciaCalculada.isNegative() ? monto.neg() : monto;
    const medioPagoDiferencia = diferencia.isZero() ? null : (input.medioPagoDiferencia ?? null);
    if (!diferencia.isZero() && !medioPagoDiferencia)
      throw new DomainError(
        diferencia.isPositive()
          ? "Elegí con qué paga el cliente la diferencia"
          : "Elegí cómo se le devuelve la diferencia al cliente",
      );

    const numero = await siguienteNumero(tx, ctx.panelId, "DEVOLUCION");
    const codigo = formatearIdDevolucion(panel.slug, numero);
    const devolucion = await tx.devolucion.create({
      data: {
        numero,
        codigo,
        clienteId: cliente.id,
        ventaId: input.ventaId ?? null,
        depositoId: input.depositoId,
        observacion,
        usuarioId: ctx.usuarioId,
        diferenciaCalculada,
        diferencia,
        medioPagoDiferencia,
        items: {
          create: conPrecios.map((i) => ({
            varianteId: i.varianteId,
            productoId: variante.get(i.varianteId)!.productoId,
            cantidad: i.cantidad,
            varianteEntregadaId: i.varianteEntregadaId,
            productoEntregadoId: variante.get(i.varianteEntregadaId)!.productoId,
            precioDevuelto: i.precioDevuelto,
            precioEntregado: i.precioEntregado,
          })),
        },
      },
      select: { id: true },
    });

    for (const i of items) {
      try {
        await registrarMovimiento(tx, {
          tipo: TipoMovimiento.GARANTIA,
          varianteId: i.varianteEntregadaId,
          depositoId: input.depositoId,
          cantidad: i.cantidad,
          usuarioId: ctx.usuarioId,
          motivo:
            i.varianteEntregadaId === i.varianteId
              ? `Garantía ${codigo}`
              : `Garantía ${codigo}: cambio de ${titulo(i.varianteId)}`.slice(0, 500),
          referenciaTipo: "DEVOLUCION",
          referenciaId: devolucion.id,
        });
      } catch (e) {
        if (e instanceof StockInsuficienteError) {
          throw new DomainError(
            `No hay stock de ${titulo(i.varianteEntregadaId)} en ${deposito.nombre} para entregar la unidad nueva ` +
              `(hay ${e.disponible}, se necesitan ${e.solicitado}). Elegí otro sabor u otro modelo. ` +
              `No se registró la devolución.`,
            "STOCK_INSUFICIENTE",
            409,
          );
        }
        throw e;
      }
    }

    await registrarAuditoria(tx, {
      usuarioId: ctx.usuarioId,
      accion: AccionAuditoria.CREATE,
      entidad: "Devolucion",
      entidadId: devolucion.id,
      datosDespues: {
        codigo,
        clienteId: cliente.id,
        ventaId: input.ventaId ?? null,
        venta: ventaCodigo,
        depositoId: input.depositoId,
        observacion,
        items: conPrecios.map((i) => ({
          varianteId: i.varianteId,
          varianteEntregadaId: i.varianteEntregadaId,
          cantidad: i.cantidad,
          precioDevuelto: i.precioDevuelto.toFixed(2),
          precioEntregado: i.precioEntregado.toFixed(2),
        })),
        diferenciaCalculada: diferenciaCalculada.toFixed(2),
        diferencia: diferencia.toFixed(2),
        medioPagoDiferencia,
        avisos,
      },
      meta: ctx.meta,
    });

    return { id: devolucion.id, codigo, avisos };
  });
}

/**
 * Anula una devolución (solo dueños: lo controla la action): repone la unidad
 * entregada con GARANTIA_ANULADA. La diferencia de precio deja de contar en lo
 * cobrado (la pantalla avisa que hay que devolverla o recuperarla).
 */
export async function anularDevolucion(ctx: Ctx, id: string, motivo: string): Promise<void> {
  const m = motivo.trim();
  if (m.length < 5) throw new DomainError("Contá por qué se anula (mínimo 5 caracteres)");
  await transaccion(ctx, async (tx) => {
    // Dos anulaciones simultáneas: la segunda espera y ve el estado nuevo.
    await tx.$queryRaw`
      SELECT "id" FROM "Devolucion" WHERE "id" = ${id} AND "panelId" = ${ctx.panelId} FOR UPDATE
    `;
    const d = await tx.devolucion.findFirst({
      where: { id },
      select: {
        codigo: true,
        estado: true,
        depositoId: true,
        diferencia: true,
        items: {
          select: { varianteEntregadaId: true, cantidad: true },
          orderBy: { varianteEntregadaId: "asc" },
        },
      },
    });
    if (!d) throw new NotFoundError("La devolución no existe");
    if (d.estado === EstadoDevolucion.ANULADA)
      throw new DomainError(`La devolución ${d.codigo} ya está anulada`);

    for (const i of d.items) {
      await registrarMovimiento(tx, {
        tipo: TipoMovimiento.GARANTIA_ANULADA,
        varianteId: i.varianteEntregadaId,
        depositoId: d.depositoId,
        cantidad: i.cantidad,
        usuarioId: ctx.usuarioId,
        motivo: `Anulación de ${d.codigo}: ${m}`.slice(0, 500),
        referenciaTipo: "DEVOLUCION",
        referenciaId: id,
      });
    }
    await tx.devolucion.update({
      where: { id },
      data: {
        estado: EstadoDevolucion.ANULADA,
        anuladaPorId: ctx.usuarioId,
        motivoAnulacion: m,
        anuladaAt: new Date(),
      },
    });
    await registrarAuditoria(tx, {
      usuarioId: ctx.usuarioId,
      accion: AccionAuditoria.UPDATE,
      entidad: "Devolucion",
      entidadId: id,
      datosAntes: { estado: EstadoDevolucion.REGISTRADA, diferencia: d.diferencia.toFixed(2) },
      datosDespues: { estado: EstadoDevolucion.ANULADA, motivoAnulacion: m },
      meta: ctx.meta,
    });
  });
}

// =============================================================================
// Lectura
// =============================================================================

const selectListado = {
  id: true,
  codigo: true,
  fecha: true,
  estado: true,
  observacion: true,
  ventaId: true,
  cliente: { select: { id: true, nombre: true, telefono: true } },
  deposito: { select: { id: true, nombre: true } },
  usuario: { select: { nombre: true } },
  venta: { select: { id: true, codigo: true } },
  diferencia: true,
  diferenciaCalculada: true,
  medioPagoDiferencia: true,
  items: {
    select: {
      varianteId: true,
      cantidad: true,
      variante: { select: { nombre: true } },
      producto: { select: { nombreCompleto: true } },
      varianteEntregadaId: true,
      productoId: true,
      productoEntregadoId: true,
      varianteEntregada: { select: { nombre: true } },
      productoEntregado: { select: { nombreCompleto: true } },
      precioDevuelto: true,
      precioEntregado: true,
    },
  },
} satisfies Prisma.DevolucionSelect;

type FilaDevolucion = Prisma.DevolucionGetPayload<{ select: typeof selectListado }>;

function aListado(d: FilaDevolucion) {
  return {
    id: d.id,
    codigo: d.codigo,
    fecha: d.fecha,
    estado: d.estado,
    observacion: d.observacion,
    cliente: d.cliente,
    deposito: d.deposito,
    usuario: d.usuario.nombre,
    venta: d.venta,
    /** > 0: el cliente pagó la diferencia; < 0: se le devolvió. */
    diferencia: d.diferencia.toFixed(2),
    diferenciaCalculada: d.diferenciaCalculada.toFixed(2),
    medioPagoDiferencia: d.medioPagoDiferencia,
    items: d.items.map((i) => ({
      varianteId: i.varianteId,
      titulo: nombreConSabor(i.producto.nombreCompleto, i.variante.nombre),
      cantidad: i.cantidad,
      /** null = se entregó el mismo sabor. */
      cambio:
        i.varianteEntregadaId === i.varianteId
          ? null
          : {
              varianteId: i.varianteEntregadaId,
              titulo: nombreConSabor(
                i.productoEntregado.nombreCompleto,
                i.varianteEntregada.nombre,
              ),
              /** "sabor": mismo modelo; "modelo": otro producto. */
              tipo:
                i.productoEntregadoId === i.productoId ? ("sabor" as const) : ("modelo" as const),
            },
      precioDevuelto: i.precioDevuelto?.toFixed(2) ?? null,
      precioEntregado: i.precioEntregado?.toFixed(2) ?? null,
    })),
  };
}

export type DevolucionListada = ReturnType<typeof aListado>;

export interface FiltrosDevoluciones {
  /** "YYYY-MM-DD" (hora argentina). */
  desde?: string;
  hasta?: string;
  clienteId?: string;
  page: number;
  pageSize?: number;
}

export async function listarDevoluciones(
  ctx: Ctx,
  f: FiltrosDevoluciones,
): Promise<{ devoluciones: DevolucionListada[]; total: number; page: number; pageSize: number }> {
  const db = dbPara(ctx.panelId);
  const pageSize = f.pageSize ?? 30;
  const fecha: Prisma.DateTimeFilter = {};
  if (f.desde) fecha.gte = inicioDelDia(f.desde);
  if (f.hasta) fecha.lte = finDelDia(f.hasta);
  const where: Prisma.DevolucionWhereInput = {
    ...(f.clienteId ? { clienteId: f.clienteId } : {}),
    ...(f.desde || f.hasta ? { fecha } : {}),
  };
  const [total, filas] = await Promise.all([
    db.devolucion.count({ where }),
    db.devolucion.findMany({
      where,
      orderBy: { fecha: "desc" },
      skip: (f.page - 1) * pageSize,
      take: pageSize,
      select: selectListado,
    }),
  ]);
  return { devoluciones: filas.map(aListado), total, page: f.page, pageSize };
}

export async function obtenerDevolucion(ctx: Ctx, id: string) {
  const d = await dbPara(ctx.panelId).devolucion.findFirst({
    where: { id },
    select: {
      ...selectListado,
      motivoAnulacion: true,
      anuladaAt: true,
      anuladaPor: { select: { nombre: true } },
    },
  });
  if (!d) throw new NotFoundError("La devolución no existe");
  return {
    ...aListado(d),
    motivoAnulacion: d.motivoAnulacion,
    anuladaAt: d.anuladaAt,
    anuladaPor: d.anuladaPor?.nombre ?? null,
  };
}

export type DevolucionDetalle = Awaited<ReturnType<typeof obtenerDevolucion>>;

/**
 * Para abrir el modal desde una venta (`?nueva=1&ventaId=…`): su cliente y los
 * sabores vendidos. null si la venta no existe en el panel.
 */
export async function ventaParaDevolucion(ctx: Ctx, ventaId: string) {
  const v = await dbPara(ctx.panelId).venta.findFirst({
    where: { id: ventaId },
    select: {
      id: true,
      codigo: true,
      fecha: true,
      depositoId: true,
      cliente: { select: { id: true, nombre: true, telefono: true, deletedAt: true } },
      items: {
        orderBy: { createdAt: "asc" },
        select: {
          varianteId: true,
          cantidad: true,
          variante: { select: { nombre: true, producto: { select: { nombreCompleto: true } } } },
        },
      },
    },
  });
  if (!v || v.cliente.deletedAt) return null;
  const devuelto = await devueltoPorVenta(ctx, [v.id]);
  return {
    venta: {
      id: v.id,
      codigo: v.codigo,
      fecha: v.fecha,
      depositoId: v.depositoId,
      items: v.items.map((i) => ({
        varianteId: i.varianteId,
        titulo: nombreConSabor(i.variante.producto.nombreCompleto, i.variante.nombre),
        cantidad: i.cantidad,
        devuelto: devuelto.get(`${v.id}|${i.varianteId}`) ?? 0,
      })),
    },
    cliente: { id: v.cliente.id, nombre: v.cliente.nombre, telefono: v.cliente.telefono },
  };
}

/** Unidades ya devueltas (devoluciones REGISTRADAS) por venta y sabor: clave "ventaId|varianteId". */
async function devueltoPorVenta(ctx: Ctx, ventaIds: string[]): Promise<Map<string, number>> {
  if (ventaIds.length === 0) return new Map();
  const filas = await dbPara(ctx.panelId).devolucionItem.findMany({
    where: { devolucion: { ventaId: { in: ventaIds }, estado: EstadoDevolucion.REGISTRADA } },
    select: { varianteId: true, cantidad: true, devolucion: { select: { ventaId: true } } },
  });
  const r = new Map<string, number>();
  for (const f of filas) {
    const clave = `${f.devolucion.ventaId}|${f.varianteId}`;
    r.set(clave, (r.get(clave) ?? 0) + f.cantidad);
  }
  return r;
}

/**
 * "Vincular a una venta": las últimas ventas confirmadas del cliente, con lo
 * que ya se devolvió de cada sabor (para no dejar devolver de más).
 */
export async function ventasParaDevolverDeCliente(ctx: Ctx, clienteId: string, limite = 10) {
  const ventas = await ventasDeCliente(ctx, clienteId, limite);
  const devuelto = await devueltoPorVenta(
    ctx,
    ventas.map((v) => v.id),
  );
  return ventas.map((v) => ({
    id: v.id,
    codigo: v.codigo,
    fecha: v.fecha,
    items: v.items.map((i) => ({
      varianteId: i.varianteId,
      titulo: i.titulo,
      cantidad: i.cantidad,
      devuelto: devuelto.get(`${v.id}|${i.varianteId}`) ?? 0,
    })),
  }));
}

/**
 * Para cambiar un sabor sin stock: los otros sabores ACTIVOS del mismo modelo
 * con stock en el galpón, de más a menos stock.
 */
export async function otrosSaboresConStock(
  ctx: CtxCatalogo,
  varianteId: string,
  depositoId: string,
): Promise<VarianteEncontrada[]> {
  const db = dbPara(ctx.panelId);
  const v = await db.variante.findFirst({
    where: { id: varianteId },
    select: { productoId: true },
  });
  if (!v) return [];
  const conStock = await db.stock.findMany({
    where: {
      depositoId,
      cantidad: { gt: 0 },
      variante: {
        productoId: v.productoId,
        id: { not: varianteId },
        activo: true,
        deletedAt: null,
        producto: { activo: true, deletedAt: null },
      },
    },
    orderBy: { cantidad: "desc" },
    take: 30,
    select: { varianteId: true },
  });
  return obtenerVariantesPorId(
    ctx,
    conStock.map((s) => s.varianteId),
    depositoId,
  );
}
