import { AccionAuditoria, EstadoVenta, Prisma, type MedioPago } from "@prisma/client";

import { formatearIdVenta } from "@/lib/paneles";
import type { ActualizarCliente, CrearCliente } from "@/lib/validations/cliente";
import { dbPara, transaccion, type Ctx, type Tx } from "@/server/db/panel-scoped";
import { ConflictError, NotFoundError } from "@/server/errors";
import { registrarAuditoria } from "@/server/services/audit.service";

/**
 * CLIENTES (por panel). Sin cuenta corriente ni saldos: la venta se cobra
 * completa en el momento. El teléfono llega normalizado ("+54" + dígitos, ver
 * normalizarTelefono) y no se repite dentro del panel entre clientes no
 * borrados (índice único parcial cliente_telefono_unico); el documento tampoco.
 */

const dec = (d: Prisma.Decimal | null | undefined) => (d ? d.toFixed(2) : "0.00");
const nombreDe = (c: { nombre: string; apellido: string | null }) =>
  [c.nombre, c.apellido].filter(Boolean).join(" ");

function buscar(q?: string): Prisma.ClienteWhereInput {
  const t = q?.trim();
  if (!t) return {};
  const digitos = t.replace(/\D/g, "").replace(/^0+/, "");
  return {
    OR: [
      { nombre: { contains: t, mode: "insensitive" } },
      { apellido: { contains: t, mode: "insensitive" } },
      ...(digitos.length >= 3
        ? [{ documento: { contains: digitos } }, { telefono: { contains: digitos } }]
        : []),
    ],
  };
}

export interface ClienteListado {
  id: string;
  nombre: string;
  documento: string | null;
  telefono: string | null;
  activo: boolean;
  ultimaCompra: Date | null;
}

export async function listarClientes(
  ctx: Ctx,
  f: { q?: string; page: number; pageSize: number },
): Promise<{ clientes: ClienteListado[]; total: number; page: number; pageSize: number }> {
  const db = dbPara(ctx.panelId);
  const where: Prisma.ClienteWhereInput = { deletedAt: null, ...buscar(f.q) };
  const [total, filas] = await Promise.all([
    db.cliente.count({ where }),
    db.cliente.findMany({
      where,
      orderBy: [{ nombre: "asc" }, { apellido: "asc" }],
      skip: (f.page - 1) * f.pageSize,
      take: f.pageSize,
    }),
  ]);
  const ultimas = filas.length
    ? await db.venta.groupBy({
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
}

const aClientePos = (c: {
  id: string;
  nombre: string;
  apellido: string | null;
  telefono: string | null;
  documento: string | null;
}): ClientePos => ({
  id: c.id,
  nombre: nombreDe(c),
  telefono: c.telefono,
  documento: c.documento,
});

/** Buscador del POS (activos, máx. 10). */
export async function buscarClientesPos(ctx: Ctx, q: string): Promise<ClientePos[]> {
  const filas = await dbPara(ctx.panelId).cliente.findMany({
    where: { deletedAt: null, activo: true, ...buscar(q) },
    orderBy: [{ nombre: "asc" }],
    take: 10,
  });
  return filas.map(aClientePos);
}

export async function obtenerClientePos(ctx: Ctx, id: string): Promise<ClientePos | null> {
  const c = await dbPara(ctx.panelId).cliente.findFirst({ where: { id, deletedAt: null } });
  return c ? aClientePos(c) : null;
}

/** Ficha: datos + historial de compras (con su ID de venta). */
export async function obtenerCliente(ctx: Ctx, id: string) {
  const db = dbPara(ctx.panelId);
  const c = await db.cliente.findFirst({ where: { id, deletedAt: null } });
  if (!c) throw new NotFoundError("El cliente no existe o fue dado de baja");
  const [ventas, resumen, panel] = await Promise.all([
    db.venta.findMany({
      where: { clienteId: id, estado: { not: EstadoVenta.BORRADOR } },
      orderBy: { fecha: "desc" },
      take: 100,
      select: {
        id: true,
        numero: true,
        fecha: true,
        estado: true,
        total: true,
        medioPago: true,
        _count: { select: { items: true } },
      },
    }),
    db.venta.aggregate({
      where: { clienteId: id, estado: EstadoVenta.CONFIRMADA },
      _count: true,
      _sum: { total: true },
      _max: { fecha: true },
    }),
    db.panel.findUniqueOrThrow({ where: { id: ctx.panelId }, select: { slug: true } }),
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
    },
    compras: {
      cantidad: resumen._count,
      total: dec(resumen._sum.total),
      ultima: resumen._max.fecha,
    },
    ventas: ventas.map((v) => ({
      id: v.id,
      numero: v.numero,
      idVenta: formatearIdVenta(panel.slug, v.numero),
      fecha: v.fecha,
      estado: v.estado,
      total: dec(v.total),
      medioPago: v.medioPago as MedioPago | null,
      items: v._count.items,
    })),
  };
}

export type ClienteDetalle = Awaited<ReturnType<typeof obtenerCliente>>;

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

const mensajeTelefono = (nombre: string) => `Ya hay un cliente con ese teléfono: ${nombre}`;

/** Chequeo previo (mensaje claro con el nombre del otro cliente); la DB es la garantía final. */
async function verificarDuplicados(tx: Tx, input: CrearCliente, excluirId?: string) {
  const otro = { deletedAt: null, ...(excluirId ? { id: { not: excluirId } } : {}) };
  if (input.telefono) {
    const repetido = await tx.cliente.findFirst({
      where: { ...otro, telefono: input.telefono },
      select: { nombre: true, apellido: true },
    });
    if (repetido) {
      const m = mensajeTelefono(nombreDe(repetido));
      throw new ConflictError(m, { telefono: [m] });
    }
  }
  if (input.documento) {
    const repetido = await tx.cliente.findFirst({
      where: { ...otro, documento: input.documento },
      select: { nombre: true, apellido: true },
    });
    if (repetido) {
      const m = `Ya hay un cliente con ese documento: ${nombreDe(repetido)}`;
      throw new ConflictError(m, { documento: [m] });
    }
  }
}

/**
 * Carrera entre dos altas simultáneas: la unicidad la frena la DB (P2002 o
 * 23505 del índice parcial). Se traduce al mismo error de campo.
 */
async function traducirUnicidad(
  ctx: Ctx,
  error: unknown,
  input: CrearCliente,
  excluirId?: string,
): Promise<never> {
  const texto =
    error instanceof Prisma.PrismaClientKnownRequestError
      ? `${error.code} ${JSON.stringify(error.meta ?? {})} ${error.message}`
      : error instanceof Prisma.PrismaClientUnknownRequestError
        ? error.message
        : "";
  const esUnicidad = /P2002|23505|unique/i.test(texto);
  if (esUnicidad) {
    const campo = /telefono/i.test(texto)
      ? "telefono"
      : /documento/i.test(texto)
        ? "documento"
        : null;
    if (campo) {
      const db = dbPara(ctx.panelId);
      const otro = await db.cliente.findFirst({
        where: {
          deletedAt: null,
          ...(excluirId ? { id: { not: excluirId } } : {}),
          ...(campo === "telefono" ? { telefono: input.telefono } : { documento: input.documento }),
        },
        select: { nombre: true, apellido: true },
      });
      const nombre = otro ? nombreDe(otro) : "otro cliente";
      const m =
        campo === "telefono"
          ? mensajeTelefono(nombre)
          : `Ya hay un cliente con ese documento: ${nombre}`;
      throw new ConflictError(m, { [campo]: [m] });
    }
  }
  throw error;
}

export async function crearCliente(
  ctx: Ctx,
  input: CrearCliente,
): Promise<{ id: string; nombre: string }> {
  try {
    return await transaccion(ctx, async (tx) => {
      await verificarDuplicados(tx, input);
      const c = await tx.cliente.create({ data: datos(input) });
      await registrarAuditoria(tx, {
        usuarioId: ctx.usuarioId,
        accion: AccionAuditoria.CREATE,
        entidad: "Cliente",
        entidadId: c.id,
        datosDespues: datos(input),
        meta: ctx.meta,
      });
      return { id: c.id, nombre: nombreDe(c) };
    });
  } catch (e) {
    return traducirUnicidad(ctx, e, input);
  }
}

export async function actualizarCliente(
  ctx: Ctx,
  input: ActualizarCliente,
): Promise<{ id: string }> {
  try {
    return await transaccion(ctx, async (tx) => {
      await tx.$queryRaw`
        SELECT "id" FROM "Cliente" WHERE "id" = ${input.id} AND "panelId" = ${ctx.panelId} FOR UPDATE
      `;
      const antes = await tx.cliente.findFirst({ where: { id: input.id, deletedAt: null } });
      if (!antes) throw new NotFoundError("El cliente no existe o fue dado de baja");
      await verificarDuplicados(tx, input, input.id);
      await tx.cliente.update({ where: { id: input.id }, data: datos(input) });
      await registrarAuditoria(tx, {
        usuarioId: ctx.usuarioId,
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
        },
        datosDespues: datos(input),
        meta: ctx.meta,
      });
      return { id: input.id };
    });
  } catch (e) {
    return traducirUnicidad(ctx, e, input, input.id);
  }
}

/** Baja lógica: deja de aparecer en el listado y en el POS; sus compras se conservan. */
export async function darDeBajaCliente(ctx: Ctx, id: string): Promise<void> {
  await transaccion(ctx, async (tx) => {
    const c = await tx.cliente.findFirst({ where: { id, deletedAt: null } });
    if (!c) throw new NotFoundError("El cliente no existe o ya fue dado de baja");
    await tx.cliente.update({ where: { id }, data: { deletedAt: new Date(), activo: false } });
    await registrarAuditoria(tx, {
      usuarioId: ctx.usuarioId,
      accion: AccionAuditoria.DELETE,
      entidad: "Cliente",
      entidadId: id,
      datosAntes: { nombre: nombreDe(c), telefono: c.telefono, documento: c.documento },
      meta: ctx.meta,
    });
  });
}
