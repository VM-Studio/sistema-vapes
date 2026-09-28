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
import { registrarMovimiento } from "@/server/services/stock.service";

/**
 * DEVOLUCIONES POR GARANTÍA (por panel).
 *
 * El cliente trae un producto fallado y se le entrega uno NUEVO: lo que se
 * descuenta del stock es la unidad nueva (movimiento GARANTIA, egreso) en el
 * galpón elegido. No hay dinero de por medio. Se puede vincular a la venta
 * original: si se devuelve más de lo que se vendió de un sabor, se avisa pero
 * no se bloquea. Anular (solo dueños) repone la unidad con GARANTIA_ANULADA.
 */

export interface DevolucionRegistrada {
  id: string;
  codigo: string;
  /** Advertencias que no bloquean (ej: cantidades mayores a lo vendido en la venta vinculada). */
  avisos: string[];
}

/** Suma cantidades repetidas del mismo sabor y ordena por varianteId (orden de bloqueo del stock). */
function consolidar(items: RegistrarDevolucion["items"]) {
  const porVariante = new Map<string, number>();
  for (const i of items)
    porVariante.set(i.varianteId, (porVariante.get(i.varianteId) ?? 0) + i.cantidad);
  return [...porVariante.entries()]
    .map(([varianteId, cantidad]) => ({ varianteId, cantidad }))
    .sort((a, b) => (a.varianteId < b.varianteId ? -1 : 1));
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

    const variantes = await tx.variante.findMany({
      where: { id: { in: items.map((i) => i.varianteId) } },
      select: {
        id: true,
        productoId: true,
        nombre: true,
        producto: { select: { nombreCompleto: true } },
      },
    });
    const variante = new Map(variantes.map((v) => [v.id, v]));
    const faltante = items.find((i) => !variante.has(i.varianteId));
    if (faltante) throw new NotFoundError("Uno de los productos no existe en este panel");
    const titulo = (varianteId: string) => {
      const v = variante.get(varianteId)!;
      return nombreConSabor(v.producto.nombreCompleto, v.nombre);
    };

    const avisos: string[] = [];
    let ventaCodigo: string | null = null;
    if (input.ventaId) {
      const venta = await tx.venta.findFirst({
        where: { id: input.ventaId },
        select: {
          codigo: true,
          clienteId: true,
          estado: true,
          items: { select: { varianteId: true, cantidad: true } },
        },
      });
      if (!venta) throw new NotFoundError("La venta vinculada no existe");
      if (venta.clienteId !== cliente.id)
        throw new DomainError(`La venta ${venta.codigo} no es de ${cliente.nombre}`);
      ventaCodigo = venta.codigo;
      if (venta.estado === EstadoVenta.ANULADA)
        avisos.push(`La venta ${venta.codigo} está anulada.`);

      const vendido = new Map<string, number>();
      for (const i of venta.items)
        vendido.set(i.varianteId, (vendido.get(i.varianteId) ?? 0) + i.cantidad);
      const previas = await tx.devolucionItem.groupBy({
        by: ["varianteId"],
        where: {
          devolucion: { ventaId: input.ventaId, estado: EstadoDevolucion.REGISTRADA },
          varianteId: { in: items.map((i) => i.varianteId) },
        },
        _sum: { cantidad: true },
      });
      const yaDevuelto = new Map(previas.map((p) => [p.varianteId, p._sum.cantidad ?? 0]));
      for (const i of items) {
        const v = vendido.get(i.varianteId) ?? 0;
        const antes = yaDevuelto.get(i.varianteId) ?? 0;
        if (v === 0) {
          avisos.push(`${titulo(i.varianteId)} no está en la venta ${venta.codigo}.`);
        } else if (antes + i.cantidad > v) {
          avisos.push(
            `${titulo(i.varianteId)}: en la venta ${venta.codigo} se vendieron ${v}` +
              (antes > 0 ? ` y ya se devolvieron ${antes}` : "") +
              `; ahora se devuelven ${i.cantidad}.`,
          );
        }
      }
    }

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
        items: {
          create: items.map((i) => ({
            varianteId: i.varianteId,
            productoId: variante.get(i.varianteId)!.productoId,
            cantidad: i.cantidad,
          })),
        },
      },
      select: { id: true },
    });

    for (const i of items) {
      try {
        await registrarMovimiento(tx, {
          tipo: TipoMovimiento.GARANTIA,
          varianteId: i.varianteId,
          depositoId: input.depositoId,
          cantidad: i.cantidad,
          usuarioId: ctx.usuarioId,
          motivo: `Garantía ${codigo}`,
          referenciaTipo: "DEVOLUCION",
          referenciaId: devolucion.id,
        });
      } catch (e) {
        if (e instanceof StockInsuficienteError) {
          throw new DomainError(
            `No hay stock de ${titulo(i.varianteId)} en ${deposito.nombre} para entregar la unidad nueva ` +
              `(hay ${e.disponible}, se necesitan ${e.solicitado}). No se registró la devolución.`,
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
        items,
        avisos,
      },
      meta: ctx.meta,
    });

    return { id: devolucion.id, codigo, avisos };
  });
}

/** Anula una devolución (solo dueños: lo controla la action): repone el stock con GARANTIA_ANULADA. */
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
        items: { select: { varianteId: true, cantidad: true }, orderBy: { varianteId: "asc" } },
      },
    });
    if (!d) throw new NotFoundError("La devolución no existe");
    if (d.estado === EstadoDevolucion.ANULADA)
      throw new DomainError(`La devolución ${d.codigo} ya está anulada`);

    for (const i of d.items) {
      await registrarMovimiento(tx, {
        tipo: TipoMovimiento.GARANTIA_ANULADA,
        varianteId: i.varianteId,
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
      datosAntes: { estado: EstadoDevolucion.REGISTRADA },
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
  items: {
    select: {
      varianteId: true,
      cantidad: true,
      variante: { select: { nombre: true } },
      producto: { select: { nombreCompleto: true } },
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
    items: d.items.map((i) => ({
      varianteId: i.varianteId,
      titulo: nombreConSabor(i.producto.nombreCompleto, i.variante.nombre),
      cantidad: i.cantidad,
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
      })),
    },
    cliente: { id: v.cliente.id, nombre: v.cliente.nombre, telefono: v.cliente.telefono },
  };
}
