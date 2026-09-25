import { AccionAuditoria, EstadoVenta, MedioPago, Prisma, type EstadoPago } from "@prisma/client";

import { prisma, withTransaction } from "@/lib/db";
import type { ActualizarCliente, CrearCliente } from "@/lib/validations/cliente";
import { ConflictError, DomainError, ForbiddenError, NotFoundError } from "@/server/errors";
import type { Actor } from "@/server/services/actor";
import { registrarAuditoria } from "@/server/services/audit.service";

/**
 * CLIENTES. saldoDeudor y saldoAFavor son cachés que solo tocan las
 * transacciones de ventas/pagos/devoluciones (la DB verifica saldoDeudor).
 * El límite de crédito (fiado) lo define solo el OWNER.
 */

const dec = (d: Prisma.Decimal | null | undefined) => (d ? d.toFixed(2) : "0.00");
const nombreDe = (c: { nombre: string; apellido: string | null }) =>
  [c.nombre, c.apellido].filter(Boolean).join(" ");

function buscar(q?: string): Prisma.ClienteWhereInput {
  const t = q?.trim();
  if (!t) return {};
  const digitos = t.replace(/\D/g, "");
  return {
    OR: [
      { nombre: { contains: t, mode: "insensitive" } },
      { apellido: { contains: t, mode: "insensitive" } },
      ...(digitos.length >= 3
        ? [{ documento: { contains: digitos } }, { telefono: { contains: digitos } }]
        : []),
      { telefono: { contains: t } },
    ],
  };
}

export interface ClienteListado {
  id: string;
  nombre: string;
  documento: string | null;
  telefono: string | null;
  activo: boolean;
  saldoDeudor: string;
  saldoAFavor: string;
  limiteCredito: string | null;
  ultimaCompra: Date | null;
}

export async function listarClientes(f: {
  q?: string;
  conDeuda?: boolean;
  page: number;
  pageSize: number;
}): Promise<{ clientes: ClienteListado[]; total: number; page: number; pageSize: number }> {
  const where: Prisma.ClienteWhereInput = {
    deletedAt: null,
    ...buscar(f.q),
    ...(f.conDeuda ? { saldoDeudor: { gt: 0 } } : {}),
  };
  const [total, filas] = await Promise.all([
    prisma.cliente.count({ where }),
    prisma.cliente.findMany({
      where,
      orderBy: f.conDeuda ? [{ saldoDeudor: "desc" }] : [{ nombre: "asc" }, { apellido: "asc" }],
      skip: (f.page - 1) * f.pageSize,
      take: f.pageSize,
    }),
  ]);
  const ultimas = filas.length
    ? await prisma.venta.groupBy({
        by: ["clienteId"],
        where: { clienteId: { in: filas.map((c) => c.id) }, estado: EstadoVenta.CONFIRMADA },
        _max: { fecha: true },
      })
    : [];
  const ultima = new Map(ultimas.map((u) => [u.clienteId, u._max.fecha]));
  return {
    clientes: filas.map((c) => ({
      id: c.id,
      nombre: nombreDe(c),
      documento: c.documento,
      telefono: c.telefono,
      activo: c.activo,
      saldoDeudor: dec(c.saldoDeudor),
      saldoAFavor: dec(c.saldoAFavor),
      limiteCredito: c.limiteCredito ? dec(c.limiteCredito) : null,
      ultimaCompra: ultima.get(c.id) ?? null,
    })),
    total,
    page: f.page,
    pageSize: f.pageSize,
  };
}

export interface ClientePos {
  id: string;
  nombre: string;
  telefono: string | null;
  documento: string | null;
  limiteCredito: string | null;
  saldoDeudor: string;
  saldoAFavor: string;
}

const aClientePos = (c: {
  id: string;
  nombre: string;
  apellido: string | null;
  telefono: string | null;
  documento: string | null;
  limiteCredito: Prisma.Decimal | null;
  saldoDeudor: Prisma.Decimal;
  saldoAFavor: Prisma.Decimal;
}): ClientePos => ({
  id: c.id,
  nombre: nombreDe(c),
  telefono: c.telefono,
  documento: c.documento,
  limiteCredito: c.limiteCredito ? dec(c.limiteCredito) : null,
  saldoDeudor: dec(c.saldoDeudor),
  saldoAFavor: dec(c.saldoAFavor),
});

/** Buscador del POS (activos, máx. 10). */
export async function buscarClientesPos(q: string): Promise<ClientePos[]> {
  const filas = await prisma.cliente.findMany({
    where: { deletedAt: null, activo: true, ...buscar(q) },
    orderBy: [{ nombre: "asc" }],
    take: 10,
  });
  return filas.map(aClientePos);
}

export async function obtenerClientePos(id: string): Promise<ClientePos | null> {
  const c = await prisma.cliente.findFirst({ where: { id, deletedAt: null } });
  return c ? aClientePos(c) : null;
}

export async function obtenerCliente(id: string) {
  const c = await prisma.cliente.findFirst({ where: { id, deletedAt: null } });
  if (!c) throw new NotFoundError("El cliente no existe o fue dado de baja");
  const [ventas, resumen] = await Promise.all([
    prisma.venta.findMany({
      where: { clienteId: id, estado: { not: EstadoVenta.BORRADOR } },
      orderBy: { fecha: "desc" },
      take: 50,
      select: {
        id: true,
        numero: true,
        fecha: true,
        estado: true,
        estadoPago: true,
        total: true,
        saldoPendiente: true,
        _count: { select: { devoluciones: true } },
      },
    }),
    prisma.venta.aggregate({
      where: { clienteId: id, estado: EstadoVenta.CONFIRMADA },
      _count: true,
      _sum: { total: true },
      _max: { fecha: true },
    }),
  ]);
  return {
    cliente: {
      id: c.id,
      nombre: c.nombre,
      apellido: c.apellido,
      nombreCompleto: nombreDe(c),
      documento: c.documento,
      telefono: c.telefono,
      email: c.email,
      direccion: c.direccion,
      notas: c.notas,
      activo: c.activo,
      limiteCredito: c.limiteCredito ? dec(c.limiteCredito) : null,
      saldoDeudor: dec(c.saldoDeudor),
      saldoAFavor: dec(c.saldoAFavor),
    },
    compras: {
      cantidad: resumen._count,
      total: dec(resumen._sum.total),
      ultima: resumen._max.fecha,
    },
    ventas: ventas.map((v) => ({
      id: v.id,
      numero: v.numero,
      fecha: v.fecha,
      estado: v.estado,
      estadoPago: v.estadoPago as EstadoPago,
      total: dec(v.total),
      saldoPendiente: dec(v.saldoPendiente),
      devoluciones: v._count.devoluciones,
    })),
  };
}

export type ClienteDetalle = Awaited<ReturnType<typeof obtenerCliente>>;

export interface MovimientoCuenta {
  fecha: Date;
  tipo: "VENTA" | "PAGO" | "DEVOLUCION";
  descripcion: string;
  ventaId: string;
  /** Aumenta la deuda. */
  debe: string;
  /** La cancela. */
  haber: string;
  /** Saldo deudor acumulado después de este movimiento. */
  saldo: string;
}

/**
 * Cuenta corriente: ventas confirmadas (debe), pagos vigentes (haber, incluye
 * lo acreditado por devoluciones) y devoluciones en dinero (informativas).
 * El saldo final coincide con Cliente.saldoDeudor.
 */
export async function obtenerCuentaCorriente(clienteId: string): Promise<{
  movimientos: MovimientoCuenta[];
  saldoDeudor: string;
  saldoAFavor: string;
  pendientes: { id: string; numero: number; fecha: Date; total: string; saldoPendiente: string }[];
}> {
  const cliente = await prisma.cliente.findFirst({ where: { id: clienteId, deletedAt: null } });
  if (!cliente) throw new NotFoundError("El cliente no existe");
  const ventas = await prisma.venta.findMany({
    where: { clienteId, estado: EstadoVenta.CONFIRMADA },
    select: {
      id: true,
      numero: true,
      fecha: true,
      total: true,
      saldoPendiente: true,
      pagos: {
        where: { anulado: false },
        select: { fecha: true, monto: true, medioPago: true, referencia: true },
      },
      devoluciones: {
        where: { reintegroMonto: { gt: 0 } },
        select: { numero: true, fecha: true, reintegroMonto: true },
      },
    },
  });
  type Crudo = Omit<MovimientoCuenta, "saldo" | "debe" | "haber"> & {
    debe: Prisma.Decimal;
    haber: Prisma.Decimal;
    orden: number;
  };
  const crudos: Crudo[] = [];
  for (const v of ventas) {
    crudos.push({
      fecha: v.fecha,
      tipo: "VENTA",
      descripcion: `Venta #${v.numero}`,
      ventaId: v.id,
      debe: v.total,
      haber: new Prisma.Decimal(0),
      orden: 0,
    });
    for (const p of v.pagos) {
      const medio =
        p.medioPago === MedioPago.CREDITO_CLIENTE ? "crédito" : p.medioPago.toLowerCase();
      crudos.push({
        fecha: p.fecha,
        tipo: "PAGO",
        descripcion: `Pago venta #${v.numero} (${medio}${p.referencia ? ` · ${p.referencia}` : ""})`,
        ventaId: v.id,
        debe: new Prisma.Decimal(0),
        haber: p.monto,
        orden: 1,
      });
    }
    for (const d of v.devoluciones) {
      crudos.push({
        fecha: d.fecha,
        tipo: "DEVOLUCION",
        descripcion: `Devolución #${d.numero}: se le devolvieron ${d.reintegroMonto.toFixed(2)} (no cambia la deuda)`,
        ventaId: v.id,
        debe: new Prisma.Decimal(0),
        haber: new Prisma.Decimal(0),
        orden: 2,
      });
    }
  }
  crudos.sort((a, b) => a.fecha.getTime() - b.fecha.getTime() || a.orden - b.orden);
  let saldo = new Prisma.Decimal(0);
  const movimientos = crudos.map((m) => {
    saldo = saldo.plus(m.debe).minus(m.haber);
    return {
      fecha: m.fecha,
      tipo: m.tipo,
      descripcion: m.descripcion,
      ventaId: m.ventaId,
      debe: m.debe.toFixed(2),
      haber: m.haber.toFixed(2),
      saldo: saldo.toFixed(2),
    };
  });
  return {
    movimientos,
    saldoDeudor: dec(cliente.saldoDeudor),
    saldoAFavor: dec(cliente.saldoAFavor),
    pendientes: ventas
      .filter((v) => v.saldoPendiente.greaterThan(0))
      .sort((a, b) => a.fecha.getTime() - b.fecha.getTime())
      .map((v) => ({
        id: v.id,
        numero: v.numero,
        fecha: v.fecha,
        total: dec(v.total),
        saldoPendiente: dec(v.saldoPendiente),
      })),
  };
}

// =============================================================================
// Escritura
// =============================================================================

function datos(input: CrearCliente) {
  return {
    nombre: input.nombre,
    apellido: input.apellido ?? null,
    documento: input.documento ?? null,
    telefono: input.telefono ?? null,
    email: input.email ?? null,
    direccion: input.direccion ?? null,
    notas: input.notas ?? null,
    activo: input.activo,
  };
}

function conflictoDocumento(error: unknown): void {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    throw new ConflictError("Ya hay un cliente con ese documento", {
      documento: ["Ya hay un cliente con ese documento"],
    });
  }
}

export async function crearCliente(
  input: CrearCliente,
  actor: Actor,
  opciones: { puedeDefinirLimite: boolean },
): Promise<{ id: string; nombre: string }> {
  if (input.limiteCredito !== undefined && !opciones.puedeDefinirLimite) {
    throw new ForbiddenError("Solo el dueño define el límite de crédito.");
  }
  try {
    return await withTransaction(async (tx) => {
      const c = await tx.cliente.create({
        data: { ...datos(input), limiteCredito: input.limiteCredito ?? null },
      });
      await registrarAuditoria(tx, {
        usuarioId: actor.id,
        accion: AccionAuditoria.CREATE,
        entidad: "Cliente",
        entidadId: c.id,
        datosDespues: { ...datos(input), limiteCredito: input.limiteCredito ?? null },
        meta: actor.meta,
      });
      return { id: c.id, nombre: nombreDe(c) };
    });
  } catch (e) {
    conflictoDocumento(e);
    throw e;
  }
}

export async function actualizarCliente(
  input: ActualizarCliente,
  actor: Actor,
  opciones: { puedeDefinirLimite: boolean },
): Promise<{ id: string }> {
  try {
    return await withTransaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Cliente" WHERE "id" = ${input.id} FOR UPDATE`;
      const antes = await tx.cliente.findFirst({ where: { id: input.id, deletedAt: null } });
      if (!antes) throw new NotFoundError("El cliente no existe o fue dado de baja");
      const nuevoLimite =
        input.limiteCredito === undefined ? null : new Prisma.Decimal(input.limiteCredito);
      const cambiaLimite =
        (antes.limiteCredito?.toFixed(2) ?? null) !== (nuevoLimite?.toFixed(2) ?? null);
      if (cambiaLimite && !opciones.puedeDefinirLimite)
        throw new ForbiddenError("Solo el dueño cambia el límite de crédito.");
      if (cambiaLimite && nuevoLimite && nuevoLimite.lessThan(antes.saldoDeudor)) {
        throw new DomainError(
          `Debe ${antes.saldoDeudor.toFixed(2)}: el límite no puede ser menor a la deuda actual.`,
          "VALIDATION_ERROR",
          400,
          {
            limiteCredito: ["Menor a la deuda actual"],
          },
        );
      }
      await tx.cliente.update({
        where: { id: input.id },
        data: { ...datos(input), ...(cambiaLimite ? { limiteCredito: nuevoLimite } : {}) },
      });
      await registrarAuditoria(tx, {
        usuarioId: actor.id,
        accion: AccionAuditoria.UPDATE,
        entidad: "Cliente",
        entidadId: input.id,
        datosAntes: {
          nombre: antes.nombre,
          apellido: antes.apellido,
          documento: antes.documento,
          telefono: antes.telefono,
          email: antes.email,
          direccion: antes.direccion,
          notas: antes.notas,
          activo: antes.activo,
          limiteCredito: antes.limiteCredito?.toFixed(2) ?? null,
        },
        datosDespues: {
          ...datos(input),
          limiteCredito: cambiaLimite
            ? (nuevoLimite?.toFixed(2) ?? null)
            : (antes.limiteCredito?.toFixed(2) ?? null),
        },
        meta: actor.meta,
      });
      return { id: input.id };
    });
  } catch (e) {
    conflictoDocumento(e);
    throw e;
  }
}

/** Baja lógica. No se da de baja a quien debe plata o tiene saldo a favor. */
export async function darDeBajaCliente(id: string, actor: Actor): Promise<void> {
  await withTransaction(async (tx) => {
    const c = await tx.cliente.findFirst({ where: { id, deletedAt: null } });
    if (!c) throw new NotFoundError("El cliente no existe o ya fue dado de baja");
    if (c.saldoDeudor.greaterThan(0))
      throw new DomainError(
        `${nombreDe(c)} debe ${c.saldoDeudor.toFixed(2)}: cobrale antes de darlo de baja.`,
      );
    if (c.saldoAFavor.greaterThan(0))
      throw new DomainError(
        `${nombreDe(c)} tiene ${c.saldoAFavor.toFixed(2)} a favor: usalo o devolvéselo antes.`,
      );
    await tx.cliente.update({ where: { id }, data: { deletedAt: new Date(), activo: false } });
    await registrarAuditoria(tx, {
      usuarioId: actor.id,
      accion: AccionAuditoria.DELETE,
      entidad: "Cliente",
      entidadId: id,
      datosAntes: { nombre: nombreDe(c) },
      meta: actor.meta,
    });
  });
}
