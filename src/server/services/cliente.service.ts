import { AccionAuditoria, EstadoVenta, Prisma, type MedioPago } from "@prisma/client";

import { finDelDia, fechasDeRango, inicioDelDia } from "@/lib/fechas";
import { nombreConSabor } from "@/lib/ventas-ui";
import {
  MENSAJE_TELEFONO_INVALIDO,
  normalizarTelefono,
  TELEFONO_NORMALIZADO,
  telefonoValido,
} from "@/lib/validations/cliente";
import { dbPara, enTransaccion, transaccion, type Ctx, type Tx } from "@/server/db/panel-scoped";
import { DomainError, NotFoundError, ValidationError } from "@/server/errors";
import { registrarAuditoria } from "@/server/services/audit.service";

/**
 * CLIENTES (por panel). Nombre + teléfono obligatorio, normalizado ("+54" +
 * dígitos, ver normalizarTelefono) y único dentro del panel entre clientes no
 * borrados (índice único parcial cliente_telefono_unico). Nunca se borran: se
 * desactivan (sus ventas y devoluciones se conservan).
 */

const dec = (d: Prisma.Decimal | null | undefined) => (d ? d.toFixed(2) : "0.00");

export interface ClienteBasico {
  id: string;
  nombre: string;
  telefono: string;
}

/** Teléfono repetido dentro del panel: trae el cliente que ya lo tiene. */
export class ClienteDuplicadoError extends DomainError {
  constructor(public readonly clienteExistente: ClienteBasico) {
    const mensaje = `Ya existe un cliente con ese teléfono: ${clienteExistente.nombre}`;
    super(mensaje, "CLIENTE_DUPLICADO", 409, { telefono: [mensaje] });
    this.name = "ClienteDuplicadoError";
  }
}

function exigirTelefono(telefono: string): string {
  const t = normalizarTelefono(telefono);
  if (!t) throw new ValidationError("Ingresá el teléfono", { telefono: ["Ingresá el teléfono"] });
  if (!TELEFONO_NORMALIZADO.test(t))
    throw new ValidationError(MENSAJE_TELEFONO_INVALIDO, { telefono: [MENSAJE_TELEFONO_INVALIDO] });
  return t;
}

function exigirNombre(nombre: string): string {
  const n = nombre.trim().replace(/\s+/g, " ");
  if (!n) throw new ValidationError("Ingresá el nombre", { nombre: ["Ingresá el nombre"] });
  if (n.length > 100)
    throw new ValidationError("Nombre demasiado largo", { nombre: ["Máximo 100 caracteres"] });
  return n;
}

const esUnicidad = (e: unknown) => {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    return (
      e.code === "P2002" || /23505|unique/i.test(`${JSON.stringify(e.meta ?? {})} ${e.message}`)
    );
  }
  return e instanceof Prisma.PrismaClientUnknownRequestError && /23505|unique/i.test(e.message);
};

async function duplicadoDe(
  db: Pick<Tx, "cliente">,
  telefono: string,
  excluirId?: string,
): Promise<ClienteBasico | null> {
  return db.cliente.findFirst({
    where: { telefono, deletedAt: null, ...(excluirId ? { id: { not: excluirId } } : {}) },
    select: { id: true, nombre: true, telefono: true },
  });
}

/**
 * Carrera entre dos altas simultáneas: la unicidad la frena la DB. El
 * existente se busca por fuera de la transacción (que quedó abortada): la
 * otra ya confirmó, así que se ve.
 */
async function traducirUnicidad(
  ctx: Ctx,
  error: unknown,
  telefono: string,
  excluirId?: string,
): Promise<never> {
  if (esUnicidad(error)) {
    const otro = await duplicadoDe(dbPara(ctx.panelId), telefono, excluirId);
    if (otro) throw new ClienteDuplicadoError(otro);
  }
  throw error;
}

// =============================================================================
// Escritura
// =============================================================================

export interface CrearClienteInput {
  nombre: string;
  telefono: string;
  notas?: string | null;
}

/**
 * Alta de cliente. Acepta el `tx` de otra operación (ej: generarVenta crea el
 * cliente nuevo en la misma transacción que la venta). Teléfono repetido en el
 * panel → ClienteDuplicadoError con el cliente existente.
 */
export async function crearCliente(
  ctx: Ctx,
  input: CrearClienteInput,
  tx?: Tx,
): Promise<ClienteBasico> {
  const nombre = exigirNombre(input.nombre);
  const telefono = exigirTelefono(input.telefono);
  const notas = input.notas?.trim() || null;
  try {
    return await enTransaccion(ctx, tx, async (t) => {
      const otro = await duplicadoDe(t, telefono);
      if (otro) throw new ClienteDuplicadoError(otro);
      const c = await t.cliente.create({
        data: { nombre, telefono, notas },
        select: { id: true, nombre: true, telefono: true },
      });
      await registrarAuditoria(t, {
        usuarioId: ctx.usuarioId,
        accion: AccionAuditoria.CREATE,
        entidad: "Cliente",
        entidadId: c.id,
        datosDespues: { nombre, telefono, notas },
        meta: ctx.meta,
      });
      return c;
    });
  } catch (e) {
    return traducirUnicidad(ctx, e, telefono);
  }
}

export interface ActualizarClienteInput extends CrearClienteInput {
  id: string;
}

export async function actualizarCliente(
  ctx: Ctx,
  input: ActualizarClienteInput,
): Promise<ClienteBasico> {
  const nombre = exigirNombre(input.nombre);
  const telefono = exigirTelefono(input.telefono);
  const notas = input.notas?.trim() || null;
  try {
    return await transaccion(ctx, async (tx) => {
      const antes = await tx.cliente.findFirst({ where: { id: input.id, deletedAt: null } });
      if (!antes) throw new NotFoundError("El cliente no existe");
      const otro = await duplicadoDe(tx, telefono, input.id);
      if (otro) throw new ClienteDuplicadoError(otro);
      const c = await tx.cliente.update({
        where: { id: input.id },
        data: { nombre, telefono, notas },
        select: { id: true, nombre: true, telefono: true },
      });
      await registrarAuditoria(tx, {
        usuarioId: ctx.usuarioId,
        accion: AccionAuditoria.UPDATE,
        entidad: "Cliente",
        entidadId: input.id,
        datosAntes: { nombre: antes.nombre, telefono: antes.telefono, notas: antes.notas },
        datosDespues: { nombre, telefono, notas },
        meta: ctx.meta,
      });
      return c;
    });
  } catch (e) {
    return traducirUnicidad(ctx, e, telefono, input.id);
  }
}

async function cambiarActivo(ctx: Ctx, id: string, activo: boolean): Promise<void> {
  await transaccion(ctx, async (tx) => {
    const c = await tx.cliente.findFirst({ where: { id, deletedAt: null } });
    if (!c) throw new NotFoundError("El cliente no existe");
    if (c.activo === activo) return;
    await tx.cliente.update({ where: { id }, data: { activo } });
    await registrarAuditoria(tx, {
      usuarioId: ctx.usuarioId,
      accion: AccionAuditoria.UPDATE,
      entidad: "Cliente",
      entidadId: id,
      datosAntes: { activo: c.activo },
      datosDespues: { activo },
      meta: ctx.meta,
    });
  });
}

/** Deja de aparecer en los buscadores. Nunca se borra: ventas y devoluciones se conservan. */
export const desactivarCliente = (ctx: Ctx, id: string) => cambiarActivo(ctx, id, false);
export const reactivarCliente = (ctx: Ctx, id: string) => cambiarActivo(ctx, id, true);

// =============================================================================
// Lectura
// =============================================================================

function filtroBusqueda(q?: string): Prisma.ClienteWhereInput {
  const t = q?.trim();
  if (!t) return {};
  const digitos = t.replace(/\D/g, "").replace(/^0+/, "");
  const soloTelefono = /^[\d\s()+-]+$/.test(t);
  return {
    OR: [
      ...(soloTelefono ? [] : [{ nombre: { contains: t, mode: "insensitive" as const } }]),
      ...(digitos.length >= 3 ? [{ telefono: { contains: digitos } }] : []),
      ...(soloTelefono && digitos.length < 3 ? [{ id: "" }] : []),
    ],
  };
}

interface ResumenCompras {
  cantidad: number;
  total: string;
  ultima: Date | null;
}

async function resumenesDeCompras(
  ctx: Ctx,
  clienteIds: string[],
): Promise<Map<string, ResumenCompras>> {
  if (clienteIds.length === 0) return new Map();
  const filas = await dbPara(ctx.panelId).venta.groupBy({
    by: ["clienteId"],
    where: { clienteId: { in: clienteIds }, estado: EstadoVenta.CONFIRMADA },
    _count: { _all: true },
    _sum: { total: true },
    _max: { fecha: true },
  });
  return new Map(
    filas.map((f) => [
      f.clienteId,
      { cantidad: f._count._all, total: dec(f._sum.total), ultima: f._max.fecha },
    ]),
  );
}

export interface ClienteBuscado extends ClienteBasico {
  ultimaCompra: Date | null;
}

/** Buscador (SelectorCliente, POS): activos, por nombre o teléfono (también dígitos parciales), máx. 20. */
export async function buscarClientes(ctx: Ctx, q: string): Promise<ClienteBuscado[]> {
  const t = q.trim();
  if (!t) return [];
  const filas = await dbPara(ctx.panelId).cliente.findMany({
    where: { deletedAt: null, activo: true, ...filtroBusqueda(t) },
    orderBy: [{ nombre: "asc" }],
    take: 20,
    select: { id: true, nombre: true, telefono: true },
  });
  const resumen = await resumenesDeCompras(
    ctx,
    filas.map((c) => c.id),
  );
  const minus = t.toLowerCase();
  return filas
    .map((c) => ({ ...c, ultimaCompra: resumen.get(c.id)?.ultima ?? null }))
    .sort(
      (a, b) =>
        Number(b.nombre.toLowerCase().startsWith(minus)) -
        Number(a.nombre.toLowerCase().startsWith(minus)),
    );
}

export interface ClienteDeTelefono extends ClienteBasico {
  activo: boolean;
}

/** Cliente (no borrado) con ese teléfono en el panel, o null (también si el teléfono no es válido). */
export async function clientePorTelefono(
  ctx: Ctx,
  telefono: string,
): Promise<ClienteDeTelefono | null> {
  const t = telefonoValido(telefono);
  if (!t) return null;
  return dbPara(ctx.panelId).cliente.findFirst({
    where: { telefono: t, deletedAt: null },
    select: { id: true, nombre: true, telefono: true, activo: true },
  });
}

/** Datos mínimos de un cliente (preselección en el POS o en devoluciones). */
export async function obtenerClienteBasico(ctx: Ctx, id: string): Promise<ClienteBasico | null> {
  return dbPara(ctx.panelId).cliente.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, nombre: true, telefono: true },
  });
}

export interface ClienteListado extends ClienteBasico {
  activo: boolean;
  compras: number;
  /** Solo para dueños (null si no). */
  totalComprado: string | null;
  ultimaCompra: Date | null;
}

export interface OpcionesCliente {
  /** Total comprado: solo dueños. */
  verTotales: boolean;
}

export async function listarClientes(
  ctx: Ctx,
  f: { q?: string; page: number; pageSize?: number },
  opciones: OpcionesCliente,
): Promise<{ clientes: ClienteListado[]; total: number; page: number; pageSize: number }> {
  const db = dbPara(ctx.panelId);
  const pageSize = f.pageSize ?? 30;
  const where: Prisma.ClienteWhereInput = { deletedAt: null, ...filtroBusqueda(f.q) };
  const [total, filas] = await Promise.all([
    db.cliente.count({ where }),
    db.cliente.findMany({
      where,
      orderBy: [{ activo: "desc" }, { nombre: "asc" }],
      skip: (f.page - 1) * pageSize,
      take: pageSize,
      select: { id: true, nombre: true, telefono: true, activo: true },
    }),
  ]);
  const resumen = await resumenesDeCompras(
    ctx,
    filas.map((c) => c.id),
  );
  return {
    clientes: filas.map((c) => {
      const r = resumen.get(c.id);
      return {
        ...c,
        compras: r?.cantidad ?? 0,
        totalComprado: opciones.verTotales ? (r?.total ?? "0.00") : null,
        ultimaCompra: r?.ultima ?? null,
      };
    }),
    total,
    page: f.page,
    pageSize,
  };
}

/** Clientes dados de alta en el mes calendario actual (hora argentina). */
export async function clientesNuevosDelMes(ctx: Ctx): Promise<number> {
  const { desde, hasta } = fechasDeRango("mes");
  return dbPara(ctx.panelId).cliente.count({
    where: { deletedAt: null, createdAt: { gte: inicioDelDia(desde), lte: finDelDia(hasta) } },
  });
}

/** Ficha: datos + historial de ventas y devoluciones. */
export async function obtenerCliente(ctx: Ctx, id: string, opciones: OpcionesCliente) {
  const db = dbPara(ctx.panelId);
  const c = await db.cliente.findFirst({ where: { id, deletedAt: null } });
  if (!c) throw new NotFoundError("El cliente no existe");
  const [ventas, resumen, devoluciones] = await Promise.all([
    db.venta.findMany({
      where: { clienteId: id },
      orderBy: { fecha: "desc" },
      take: 200,
      select: {
        id: true,
        codigo: true,
        fecha: true,
        estado: true,
        total: true,
        medioPago: true,
        _count: { select: { items: true } },
      },
    }),
    resumenesDeCompras(ctx, [id]),
    db.devolucion.findMany({
      where: { clienteId: id },
      orderBy: { fecha: "desc" },
      take: 100,
      select: {
        id: true,
        codigo: true,
        fecha: true,
        estado: true,
        observacion: true,
        deposito: { select: { nombre: true } },
        items: {
          select: {
            cantidad: true,
            variante: { select: { nombre: true } },
            producto: { select: { nombreCompleto: true } },
          },
        },
      },
    }),
  ]);
  const r = resumen.get(id);
  return {
    cliente: {
      id: c.id,
      nombre: c.nombre,
      telefono: c.telefono,
      notas: c.notas,
      activo: c.activo,
      createdAt: c.createdAt,
    },
    compras: {
      cantidad: r?.cantidad ?? 0,
      total: opciones.verTotales ? (r?.total ?? "0.00") : null,
      ultima: r?.ultima ?? null,
    },
    ventas: ventas.map((v) => ({
      id: v.id,
      codigo: v.codigo,
      fecha: v.fecha,
      estado: v.estado,
      total: dec(v.total),
      medioPago: v.medioPago as MedioPago,
      items: v._count.items,
    })),
    devoluciones: devoluciones.map((d) => ({
      id: d.id,
      codigo: d.codigo,
      fecha: d.fecha,
      estado: d.estado,
      observacion: d.observacion,
      deposito: d.deposito.nombre,
      productos: d.items.map((i) => ({
        titulo: nombreConSabor(i.producto.nombreCompleto, i.variante.nombre),
        cantidad: i.cantidad,
      })),
    })),
  };
}

export type ClienteDetalle = Awaited<ReturnType<typeof obtenerCliente>>;
