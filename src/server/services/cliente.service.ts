import { AccionAuditoria, Modulo, Prisma, RolUsuario } from "@prisma/client";

import { finDelDia, fechasDeRango, inicioDelDia } from "@/lib/fechas";
import { MONTOS_CERO, type Montos } from "@/lib/moneda";
import { nombreConSabor } from "@/lib/ventas-ui";
import {
  MENSAJE_TELEFONO_INVALIDO,
  normalizarTelefono,
  TELEFONO_NORMALIZADO,
  telefonoValido,
} from "@/lib/validations/cliente";
import { dbPara, enTransaccion, transaccion, type Ctx, type Tx } from "@/server/db/panel-scoped";
import { DomainError, NotFoundError, ValidationError } from "@/server/errors";
import { SQL_USD_TOTAL, totalDeVenta } from "@/server/moneda/montos-venta";
import { registrarAuditoria } from "@/server/services/audit.service";
import { bloquearCliente, deudaDeClientes } from "@/server/services/fiado.service";

/**
 * CLIENTES (por panel). Nombre + teléfono obligatorio, normalizado ("+54" +
 * dígitos, ver normalizarTelefono) y único dentro del panel entre clientes no
 * borrados (índice único parcial cliente_telefono_unico). Se desactivan (dejan
 * de aparecer en los buscadores) o, solo los dueños, se eliminan (borrado
 * lógico: deletedAt; desaparece de todo el sistema, pero sus ventas y
 * devoluciones se conservan con su nombre y el teléfono queda libre).
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
// «¿De quién viene este cliente?» (Cliente.origenId)
// =============================================================================

export interface OrigenCliente {
  id: string;
  nombre: string;
}

export const MENSAJE_FALTA_ORIGEN = "Elegí de quién viene el cliente";

/**
 * Quiénes pueden haber traído un cliente al panel: los dueños y los que
 * venden en él (VENTAS crear), activos. Es la lista del «¿De quién viene?».
 */
export async function listarOrigenesCliente(ctx: Pick<Ctx, "panelId">): Promise<OrigenCliente[]> {
  return dbPara(ctx.panelId).usuario.findMany({
    where: {
      deletedAt: null,
      activo: true,
      OR: [
        { rol: RolUsuario.OWNER },
        {
          permisos: {
            some: { panelId: ctx.panelId, modulo: Modulo.VENTAS, puedeCrear: true },
          },
        },
      ],
    },
    orderBy: [{ nombre: "asc" }],
    select: { id: true, nombre: true },
  });
}

/** El origen elegido tiene que ser una de las opciones del panel. */
async function exigirOrigen(ctx: Ctx, origenId: string | null | undefined): Promise<string> {
  const o = origenId?.trim();
  if (!o) throw new ValidationError(MENSAJE_FALTA_ORIGEN, { origenId: [MENSAJE_FALTA_ORIGEN] });
  const opciones = await listarOrigenesCliente(ctx);
  if (!opciones.some((x) => x.id === o))
    throw new ValidationError("Esa persona no puede figurar como origen del cliente", {
      origenId: ["Elegí una de las opciones"],
    });
  return o;
}

// =============================================================================
// Escritura
// =============================================================================

export interface CrearClienteInput {
  nombre: string;
  telefono: string;
  notas?: string | null;
  /** De quién viene (obligatorio; ver `opciones.sinOrigen`). */
  origenId?: string | null;
}

/**
 * Alta de cliente. Acepta el `tx` de otra operación (ej: generarVenta crea el
 * cliente nuevo en la misma transacción que la venta). Teléfono repetido en el
 * panel → ClienteDuplicadoError con el cliente existente. `vendedorId`: la
 * cartera en la que queda (ver cartera-clientes.service).
 */
export async function crearCliente(
  ctx: Ctx,
  input: CrearClienteInput,
  tx?: Tx,
  opciones: {
    vendedorId?: string | null;
    /**
     * Solo para la cotización guardada antes de v2.13.0 (cliente sin
     * registrar y sin «de quién viene»): queda pendiente para los dueños.
     */
    sinOrigen?: boolean;
  } = {},
): Promise<ClienteBasico> {
  const nombre = exigirNombre(input.nombre);
  const telefono = exigirTelefono(input.telefono);
  const notas = input.notas?.trim() || null;
  const origenId =
    opciones.sinOrigen && !input.origenId ? null : await exigirOrigen(ctx, input.origenId);
  try {
    return await enTransaccion(ctx, tx, async (t) => {
      const otro = await duplicadoDe(t, telefono);
      if (otro) throw new ClienteDuplicadoError(otro);
      const c = await t.cliente.create({
        data: {
          nombre,
          telefono,
          notas,
          creadoPorId: ctx.usuarioId,
          vendedorId: opciones.vendedorId ?? null,
          origenId,
        },
        select: { id: true, nombre: true, telefono: true },
      });
      await registrarAuditoria(t, {
        usuarioId: ctx.usuarioId,
        accion: AccionAuditoria.CREATE,
        entidad: "Cliente",
        entidadId: c.id,
        datosDespues: {
          nombre,
          telefono,
          notas,
          origenId,
          ...(opciones.vendedorId ? { vendedorId: opciones.vendedorId } : {}),
        },
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

/**
 * Edita nombre, teléfono y notas. «De quién viene» solo lo cambia un dueño
 * (`puedeCambiarOrigen`): define la ganancia de cliente nuevo del vendedor.
 * Sin permiso, el origen que venga se ignora.
 */
export async function actualizarCliente(
  ctx: Ctx,
  input: ActualizarClienteInput,
  opciones: { puedeCambiarOrigen?: boolean } = {},
): Promise<ClienteBasico> {
  const nombre = exigirNombre(input.nombre);
  const telefono = exigirTelefono(input.telefono);
  const notas = input.notas?.trim() || null;
  const origenId =
    opciones.puedeCambiarOrigen && input.origenId
      ? await exigirOrigen(ctx, input.origenId)
      : undefined;
  try {
    return await transaccion(ctx, async (tx) => {
      const antes = await tx.cliente.findFirst({ where: { id: input.id, deletedAt: null } });
      if (!antes) throw new NotFoundError("El cliente no existe");
      const otro = await duplicadoDe(tx, telefono, input.id);
      if (otro) throw new ClienteDuplicadoError(otro);
      const c = await tx.cliente.update({
        where: { id: input.id },
        data: { nombre, telefono, notas, ...(origenId ? { origenId } : {}) },
        select: { id: true, nombre: true, telefono: true },
      });
      await registrarAuditoria(tx, {
        usuarioId: ctx.usuarioId,
        accion: AccionAuditoria.UPDATE,
        entidad: "Cliente",
        entidadId: input.id,
        datosAntes: {
          nombre: antes.nombre,
          telefono: antes.telefono,
          notas: antes.notas,
          ...(origenId ? { origenId: antes.origenId } : {}),
        },
        datosDespues: { nombre, telefono, notas, ...(origenId ? { origenId } : {}) },
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

/**
 * Completar «de quién viene» de varios clientes a la vez (solo dueños: lo
 * exige la action). Pensado para los que se cargaron antes de v2.13.0, pero
 * sirve para corregir cualquiera. Devuelve cuántos cambiaron.
 */
export async function asignarOrigenes(
  ctx: Ctx,
  asignaciones: { clienteId: string; origenId: string }[],
): Promise<number> {
  if (asignaciones.length === 0) return 0;
  const opciones = new Set((await listarOrigenesCliente(ctx)).map((o) => o.id));
  for (const a of asignaciones)
    if (!opciones.has(a.origenId))
      throw new ValidationError("Esa persona no puede figurar como origen del cliente");
  return transaccion(ctx, async (tx) => {
    const antes = await tx.cliente.findMany({
      where: { id: { in: asignaciones.map((a) => a.clienteId) }, deletedAt: null },
      select: { id: true, origenId: true },
    });
    let cambiados = 0;
    for (const a of asignaciones) {
      const c = antes.find((x) => x.id === a.clienteId);
      if (!c || c.origenId === a.origenId) continue;
      await tx.cliente.update({ where: { id: c.id }, data: { origenId: a.origenId } });
      await registrarAuditoria(tx, {
        usuarioId: ctx.usuarioId,
        accion: AccionAuditoria.UPDATE,
        entidad: "Cliente",
        entidadId: c.id,
        datosAntes: { origenId: c.origenId },
        datosDespues: { origenId: a.origenId },
        meta: ctx.meta,
      });
      cambiados += 1;
    }
    return cambiados;
  });
}

/** Deja de aparecer en los buscadores. Nunca se borra: ventas y devoluciones se conservan. */
export const desactivarCliente = (ctx: Ctx, id: string) => cambiarActivo(ctx, id, false);
export const reactivarCliente = (ctx: Ctx, id: string) => cambiarActivo(ctx, id, true);

/**
 * Elimina el cliente (borrado lógico, solo dueños: lo exige la action). Sale de
 * listados, buscadores, carteras y reportes; sus ventas, devoluciones y
 * cotizaciones se conservan con su nombre. Con deuda de fiado no se puede
 * (primero hay que cobrarla). El teléfono queda libre para otro cliente.
 */
export async function eliminarCliente(ctx: Ctx, id: string): Promise<void> {
  await transaccion(ctx, async (tx) => {
    await bloquearCliente(tx, ctx, id);
    const c = await tx.cliente.findFirst({ where: { id, deletedAt: null } });
    if (!c) throw new NotFoundError("El cliente no existe");
    if (c.saldoDeudor.gt(0))
      throw new DomainError(
        `${c.nombre} tiene deuda de fiado sin cobrar: cobrala antes de eliminarlo (o desactivalo)`,
      );
    await tx.cliente.update({ where: { id }, data: { deletedAt: new Date() } });
    await registrarAuditoria(tx, {
      usuarioId: ctx.usuarioId,
      accion: AccionAuditoria.DELETE,
      entidad: "Cliente",
      entidadId: id,
      datosAntes: { nombre: c.nombre, telefono: c.telefono, notas: c.notas, activo: c.activo },
      meta: ctx.meta,
    });
  });
}

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
  /** Total comprado en USDT (principal), pesos y dólares: Σ de cada venta a su cotización. */
  total: Montos;
  ultima: Date | null;
}

async function resumenesDeCompras(
  ctx: Ctx,
  clienteIds: string[],
): Promise<Map<string, ResumenCompras>> {
  if (clienteIds.length === 0) return new Map();
  const filas = await dbPara(ctx.panelId).$queryRaw<
    {
      clienteId: string;
      cantidad: number;
      usdt: string;
      pesos: string;
      usd: string;
      ultima: Date | null;
    }[]
  >`
    SELECT v."clienteId", COUNT(*)::int AS "cantidad",
      COALESCE(SUM(v."totalUsdt"), 0)::text AS "usdt",
      COALESCE(SUM(v."total"), 0)::text AS "pesos",
      COALESCE(SUM(${SQL_USD_TOTAL}), 0)::text AS "usd",
      MAX(v."fecha") AS "ultima"
    FROM "Venta" v
    WHERE v."panelId" = ${ctx.panelId} AND v."estado" = 'CONFIRMADA'
      AND v."clienteId" IN (${Prisma.join(clienteIds)})
    GROUP BY v."clienteId"`;
  const d = (x: string) => new Prisma.Decimal(x).toFixed(2);
  return new Map(
    filas.map((f) => [
      f.clienteId,
      {
        cantidad: f.cantidad,
        total: { usdt: d(f.usdt), pesos: d(f.pesos), usd: d(f.usd) },
        ultima: f.ultima,
      },
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
  /** Solo para dueños (null si no). USDT principal, cada venta a su cotización. */
  totalComprado: Montos | null;
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
        totalComprado: opciones.verTotales ? (r?.total ?? MONTOS_CERO) : null,
        ultimaCompra: r?.ultima ?? null,
      };
    }),
    total,
    page: f.page,
    pageSize,
  };
}

/** Cuántos clientes (no borrados) todavía no tienen «de quién viene». */
export async function contarClientesSinOrigen(ctx: Ctx): Promise<number> {
  return dbPara(ctx.panelId).cliente.count({ where: { deletedAt: null, origenId: null } });
}

export interface ClienteSinOrigen extends ClienteBasico {
  activo: boolean;
  createdAt: Date;
  /** Quién lo cargó y en qué cartera está: pistas para responder. */
  creadoPor: string | null;
  cartera: string | null;
  compras: number;
  /** Sugerencia: quien lo cargó o su cartera, si es una de las opciones. */
  sugerido: string | null;
}

/** Los clientes que falta completar (para la pantalla de dueños), los más viejos primero. */
export async function listarClientesSinOrigen(ctx: Ctx): Promise<{
  clientes: ClienteSinOrigen[];
  origenes: OrigenCliente[];
}> {
  const [filas, origenes] = await Promise.all([
    dbPara(ctx.panelId).cliente.findMany({
      where: { deletedAt: null, origenId: null },
      orderBy: [{ createdAt: "asc" }, { nombre: "asc" }],
      take: 1000,
      select: {
        id: true,
        nombre: true,
        telefono: true,
        activo: true,
        createdAt: true,
        creadoPor: { select: { id: true, nombre: true } },
        vendedor: { select: { id: true, nombre: true } },
      },
    }),
    listarOrigenesCliente(ctx),
  ]);
  const resumen = await resumenesDeCompras(
    ctx,
    filas.map((c) => c.id),
  );
  const ids = new Set(origenes.map((o) => o.id));
  return {
    origenes,
    clientes: filas.map((c) => {
      const sugerido = [c.vendedor?.id, c.creadoPor?.id].find((x) => x && ids.has(x)) ?? null;
      return {
        id: c.id,
        nombre: c.nombre,
        telefono: c.telefono,
        activo: c.activo,
        createdAt: c.createdAt,
        creadoPor: c.creadoPor?.nombre ?? null,
        cartera: c.vendedor?.nombre ?? null,
        compras: resumen.get(c.id)?.cantidad ?? 0,
        sugerido,
      };
    }),
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
  const c = await db.cliente.findFirst({
    where: { id, deletedAt: null },
    include: {
      origen: { select: { id: true, nombre: true } },
      vendedor: { select: { id: true, nombre: true } },
      creadoEnVenta: { select: { id: true, codigo: true, fecha: true, vendedorId: true } },
    },
  });
  if (!c) throw new NotFoundError("El cliente no existe");
  const [ventas, resumen, devoluciones, deudas] = await Promise.all([
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
        totalUsdt: true,
        tipoCambioUsd: true,
        medioPago: true,
        estadoPago: true,
        saldoPendiente: true,
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
    deudaDeClientes(ctx, [id]),
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
      /** De quién viene (null = cargado antes de v2.13.0 y todavía sin responder). */
      origen: c.origen,
      /** Deuda de cuenta corriente (ventas fiadas sin cobrar). */
      saldoDeudor: dec(c.saldoDeudor),
      /** La deuda en USDT (principal), pesos y dólares: cada venta a su cotización. */
      deuda: deudas.get(id)?.deuda ?? MONTOS_CERO,
      /** Cartera del vendedor en la que está («Mis clientes»), si está en alguna. */
      cartera: c.vendedor
        ? {
            vendedorId: c.vendedor.id,
            vendedor: c.vendedor.nombre,
            /** La venta con la que se sumó como cliente nuevo; null = ya lo tenía. */
            ventaAlta:
              c.creadoEnVenta && c.creadoEnVenta.vendedorId === c.vendedor.id
                ? {
                    id: c.creadoEnVenta.id,
                    codigo: c.creadoEnVenta.codigo,
                    fecha: c.creadoEnVenta.fecha,
                  }
                : null,
          }
        : null,
    },
    compras: {
      cantidad: r?.cantidad ?? 0,
      total: opciones.verTotales ? (r?.total ?? MONTOS_CERO) : null,
      ultima: r?.ultima ?? null,
    },
    ventas: ventas.map((v) => ({
      id: v.id,
      codigo: v.codigo,
      fecha: v.fecha,
      estado: v.estado,
      total: dec(v.total),
      totales: totalDeVenta(v),
      medioPago: v.medioPago,
      estadoPago: v.estadoPago,
      saldoPendiente: dec(v.saldoPendiente),
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
