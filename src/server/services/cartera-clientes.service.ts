import { AccionAuditoria, EstadoVenta, Prisma, RolUsuario } from "@prisma/client";

import { finDelDia, fechasDeRango, inicioDelDia } from "@/lib/fechas";
import { normalizarTelefono } from "@/lib/validations/cliente";
import { dbPara, transaccion, type Ctx, type Tx } from "@/server/db/panel-scoped";
import { DomainError, NotFoundError } from "@/server/errors";
import { registrarAuditoria } from "@/server/services/audit.service";
import {
  actualizarCliente,
  ClienteDuplicadoError,
  crearCliente,
  type ClienteBasico,
} from "@/server/services/cliente.service";

/**
 * CARTERA DE CLIENTES DE UN VENDEDOR («Mis clientes»).
 *
 * Para que la ganancia por cliente nuevo sea justa desde el primer día, el
 * vendedor «prepara» su perfil cargando los clientes que YA tenía antes de
 * usar el sistema: quedan en su cartera (Cliente.vendedorId) sin venta de
 * alta, y venderles NO cuenta como cliente nuevo. Recién al vender, si elige
 * «Cliente nuevo», el cliente se crea con esa venta (Venta.clienteNuevo,
 * Cliente.creadoEnVentaId) y se suma solo a su cartera: en el pago, los
 * dueños ven qué venta lo trajo y desde la ficha se llega a esa venta.
 *
 * Un teléfono que ya es de un cliente del negocio sin cartera se puede sumar
 * a la cartera (sigue sin ser nuevo); uno que está en la cartera de otro
 * vendedor, no.
 */

const dec = (d: Prisma.Decimal | null | undefined) => (d ? d.toFixed(2) : "0.00");

/**
 * Cartera en la que cae un cliente que da de alta `usuarioId` al vender: la
 * suya si es vendedor (EMPLEADO); los dueños no tienen cartera (null).
 */
export async function carteraDeVendedor(
  db: Pick<Tx, "usuario">,
  usuarioId: string,
): Promise<string | null> {
  const u = await db.usuario.findUnique({ where: { id: usuarioId }, select: { rol: true } });
  return u && u.rol !== RolUsuario.OWNER ? usuarioId : null;
}

/** Teléfono ya cargado: dice de quién es para ofrecer sumarlo (o no). */
export class ClienteEnOtraCarteraError extends DomainError {
  constructor(cliente: ClienteBasico, vendedor: string) {
    const mensaje = `${cliente.nombre} ya está en la cartera de ${vendedor}.`;
    super(mensaje, "CLIENTE_DE_OTRO_VENDEDOR", 409, { telefono: [mensaje] });
    this.name = "ClienteEnOtraCarteraError";
  }
}

export interface ClienteCartera {
  id: string;
  nombre: string;
  telefono: string;
  notas: string | null;
  activo: boolean;
  /** Cuándo entró a la cartera (alta o cuando se sumó). */
  createdAt: Date;
  /** La venta con la que se dio de alta (cliente NUEVO); null = ya lo tenía. */
  ventaAlta: { id: string; codigo: string; fecha: Date; total: string } | null;
  /** Ventas confirmadas de este vendedor al cliente. */
  compras: number;
  ultimaCompra: Date | null;
}

export type FiltroCartera = "todos" | "previos" | "nuevos";

const selectCartera = {
  id: true,
  nombre: true,
  telefono: true,
  notas: true,
  activo: true,
  createdAt: true,
  creadoEnVenta: { select: { id: true, codigo: true, fecha: true, total: true, vendedorId: true } },
} satisfies Prisma.ClienteSelect;

type FilaCartera = Prisma.ClienteGetPayload<{ select: typeof selectCartera }>;

async function conCompras(
  ctx: Ctx,
  vendedorId: string,
  filas: FilaCartera[],
): Promise<ClienteCartera[]> {
  const ids = filas.map((c) => c.id);
  const resumen = ids.length
    ? await dbPara(ctx.panelId).venta.groupBy({
        by: ["clienteId"],
        where: { clienteId: { in: ids }, vendedorId, estado: EstadoVenta.CONFIRMADA },
        _count: { _all: true },
        _max: { fecha: true },
      })
    : [];
  const de = new Map(resumen.map((r) => [r.clienteId, r]));
  return filas.map((c) => ({
    id: c.id,
    nombre: c.nombre,
    telefono: c.telefono,
    notas: c.notas,
    activo: c.activo,
    createdAt: c.createdAt,
    ventaAlta:
      c.creadoEnVenta && c.creadoEnVenta.vendedorId === vendedorId
        ? {
            id: c.creadoEnVenta.id,
            codigo: c.creadoEnVenta.codigo,
            fecha: c.creadoEnVenta.fecha,
            total: dec(c.creadoEnVenta.total),
          }
        : null,
    compras: de.get(c.id)?._count._all ?? 0,
    ultimaCompra: de.get(c.id)?._max.fecha ?? null,
  }));
}

/** Se sumó a la cartera con una venta SUYA (cliente nuevo). */
const nuevoDe = (vendedorId: string): Prisma.ClienteWhereInput => ({
  creadoEnVenta: { vendedorId },
});
/** Ya lo tenía: sin venta de alta, o dado de alta por otro (un dueño) y sumado después. */
const previoDe = (vendedorId: string): Prisma.ClienteWhereInput => ({
  OR: [{ creadoEnVentaId: null }, { creadoEnVenta: { vendedorId: { not: vendedorId } } }],
});

function whereCartera(vendedorId: string, q?: string, filtro: FiltroCartera = "todos") {
  const and: Prisma.ClienteWhereInput[] = [];
  if (filtro === "previos") and.push(previoDe(vendedorId));
  if (filtro === "nuevos") and.push(nuevoDe(vendedorId));
  const where: Prisma.ClienteWhereInput = { vendedorId, deletedAt: null, AND: and };
  const t = q?.trim();
  if (t) {
    const digitos = t.replace(/\D/g, "").replace(/^0+/, "");
    and.push({
      OR: [
        { nombre: { contains: t, mode: "insensitive" } },
        ...(digitos.length >= 3 ? [{ telefono: { contains: digitos } }] : []),
      ],
    });
  }
  return where;
}

export async function listarCartera(
  ctx: Ctx,
  vendedorId: string,
  f: { q?: string; filtro?: FiltroCartera; page: number; pageSize?: number },
): Promise<{ clientes: ClienteCartera[]; total: number; page: number; pageSize: number }> {
  const db = dbPara(ctx.panelId);
  const pageSize = f.pageSize ?? 30;
  const where = whereCartera(vendedorId, f.q, f.filtro);
  const [total, filas] = await Promise.all([
    db.cliente.count({ where }),
    db.cliente.findMany({
      where,
      orderBy: [{ activo: "desc" }, { nombre: "asc" }],
      skip: (f.page - 1) * pageSize,
      take: pageSize,
      select: selectCartera,
    }),
  ]);
  return { clientes: await conCompras(ctx, vendedorId, filas), total, page: f.page, pageSize };
}

export interface ResumenCartera {
  total: number;
  /** Los que ya tenía (cargados sin venta de alta). */
  previos: number;
  /** Los que se sumaron con una venta suya. */
  nuevos: number;
  nuevosDelMes: number;
}

export async function resumenCartera(ctx: Ctx, vendedorId: string): Promise<ResumenCartera> {
  const db = dbPara(ctx.panelId);
  const { desde, hasta } = fechasDeRango("mes");
  const base = { vendedorId, deletedAt: null };
  const [total, nuevos, nuevosDelMes] = await Promise.all([
    db.cliente.count({ where: base }),
    db.cliente.count({ where: { ...base, ...nuevoDe(vendedorId) } }),
    db.cliente.count({
      where: {
        ...base,
        creadoEnVenta: { vendedorId, fecha: { gte: inicioDelDia(desde), lte: finDelDia(hasta) } },
      },
    }),
  ]);
  return { total, previos: total - nuevos, nuevos, nuevosDelMes };
}

/** Ficha de un cliente de la cartera: datos, la venta que lo trajo y las ventas del vendedor. */
export async function obtenerClienteDeCartera(ctx: Ctx, vendedorId: string, id: string) {
  const db = dbPara(ctx.panelId);
  const c = await db.cliente.findFirst({
    where: { id, vendedorId, deletedAt: null },
    select: selectCartera,
  });
  if (!c) throw new NotFoundError("El cliente no está en tu cartera.");
  const [[cliente], ventas] = await Promise.all([
    conCompras(ctx, vendedorId, [c]),
    db.venta.findMany({
      where: { clienteId: id, vendedorId },
      orderBy: { fecha: "desc" },
      take: 100,
      select: {
        id: true,
        codigo: true,
        fecha: true,
        estado: true,
        tipo: true,
        total: true,
        clienteNuevo: true,
        items: { select: { cantidad: true } },
      },
    }),
  ]);
  return {
    cliente: cliente!,
    ventas: ventas.map((v) => ({
      id: v.id,
      codigo: v.codigo,
      fecha: v.fecha,
      estado: v.estado,
      tipo: v.tipo,
      total: dec(v.total),
      clienteNuevo: v.clienteNuevo,
      unidades: v.items.reduce((a, i) => a + i.cantidad, 0),
    })),
  };
}

export type ClienteDeCartera = Awaited<ReturnType<typeof obtenerClienteDeCartera>>;

// =============================================================================
// Escritura (el propio vendedor)
// =============================================================================

async function asignar(tx: Tx, ctx: Ctx, clienteId: string, vendedorId: string | null) {
  await tx.cliente.update({ where: { id: clienteId }, data: { vendedorId } });
  await registrarAuditoria(tx, {
    usuarioId: ctx.usuarioId,
    accion: AccionAuditoria.UPDATE,
    entidad: "Cliente",
    entidadId: clienteId,
    datosDespues: { vendedorId, cartera: vendedorId ? "sumado" : "quitado" },
    meta: ctx.meta,
  });
}

/**
 * Suma a la cartera un cliente que ya existe con ese teléfono, si no es de
 * nadie. Devuelve null si el teléfono no es de ningún cliente.
 */
async function sumarPorTelefono(
  tx: Tx,
  ctx: Ctx,
  vendedorId: string,
  telefono: string,
): Promise<{ cliente: ClienteBasico; yaEstaba: boolean } | null> {
  const t = normalizarTelefono(telefono);
  if (!t) return null;
  const c = await tx.cliente.findFirst({
    where: { telefono: t, deletedAt: null },
    select: {
      id: true,
      nombre: true,
      telefono: true,
      vendedorId: true,
      vendedor: { select: { nombre: true } },
    },
  });
  if (!c) return null;
  const cliente = { id: c.id, nombre: c.nombre, telefono: c.telefono };
  if (c.vendedorId === vendedorId) return { cliente, yaEstaba: true };
  if (c.vendedorId)
    throw new ClienteEnOtraCarteraError(cliente, c.vendedor?.nombre ?? "otro vendedor");
  await asignar(tx, ctx, c.id, vendedorId);
  return { cliente, yaEstaba: false };
}

export type ResultadoAlta =
  | { tipo: "CREADO"; cliente: ClienteBasico }
  /** Ya era cliente del negocio (sin cartera): se sumó a la tuya. */
  | { tipo: "SUMADO"; cliente: ClienteBasico }
  | { tipo: "YA_ESTABA"; cliente: ClienteBasico };

/**
 * «Ya lo tenía»: alta en la cartera SIN venta (no cuenta como nuevo). Si el
 * teléfono ya es de un cliente sin cartera y `sumarExistente`, lo suma; si
 * no, ClienteDuplicadoError (la UI ofrece sumarlo).
 */
export async function agregarACartera(
  ctx: Ctx,
  vendedorId: string,
  input: { nombre: string; telefono: string; notas?: string | null },
  opciones: { sumarExistente?: boolean } = {},
): Promise<ResultadoAlta> {
  try {
    return await transaccion(ctx, async (tx) => {
      if (opciones.sumarExistente) {
        const r = await sumarPorTelefono(tx, ctx, vendedorId, input.telefono);
        if (r) return { tipo: r.yaEstaba ? "YA_ESTABA" : "SUMADO", cliente: r.cliente } as const;
      }
      const cliente = await crearCliente(ctx, input, tx, { vendedorId });
      return { tipo: "CREADO", cliente } as const;
    });
  } catch (e) {
    if (e instanceof ClienteDuplicadoError) {
      // Ya es de esta cartera: no es un error.
      const c = await dbPara(ctx.panelId).cliente.findFirst({
        where: { id: e.clienteExistente.id },
        select: { vendedorId: true, vendedor: { select: { nombre: true } } },
      });
      if (c?.vendedorId === vendedorId) return { tipo: "YA_ESTABA", cliente: e.clienteExistente };
      if (c?.vendedorId)
        throw new ClienteEnOtraCarteraError(
          e.clienteExistente,
          c.vendedor?.nombre ?? "otro vendedor",
        );
    }
    throw e;
  }
}

export interface FilaImportacion {
  linea: number;
  texto: string;
  resultado: "CREADO" | "SUMADO" | "YA_ESTABA" | "ERROR";
  mensaje: string;
}

/**
 * «Cargar varios»: una línea por cliente, "Nombre, teléfono" (también con
 * tabulador, punto y coma o guion). Cada una por separado: las que fallan
 * no frenan al resto. Los teléfonos de clientes sin cartera se suman.
 */
export async function importarCartera(
  ctx: Ctx,
  vendedorId: string,
  texto: string,
): Promise<FilaImportacion[]> {
  const lineas = texto
    .split(/\r?\n/)
    .map((t, i) => ({ linea: i + 1, texto: t.trim() }))
    .filter((l) => l.texto);
  if (lineas.length === 0) throw new DomainError("Pegá al menos un cliente (nombre y teléfono).");
  if (lineas.length > 500) throw new DomainError("Máximo 500 clientes por vez.");
  const filas: FilaImportacion[] = [];
  for (const l of lineas) {
    const partido = separarLinea(l.texto);
    if (!partido) {
      filas.push({ ...l, resultado: "ERROR", mensaje: "Falta el nombre o el teléfono." });
      continue;
    }
    try {
      const r = await agregarACartera(ctx, vendedorId, partido, { sumarExistente: true });
      filas.push({
        ...l,
        resultado: r.tipo,
        mensaje:
          r.tipo === "CREADO"
            ? `${r.cliente.nombre}: cargado.`
            : r.tipo === "SUMADO"
              ? `${r.cliente.nombre}: ya era cliente, se sumó a tu cartera.`
              : `${r.cliente.nombre}: ya estaba en tu cartera.`,
      });
    } catch (e) {
      filas.push({
        ...l,
        resultado: "ERROR",
        mensaje: e instanceof Error ? e.message : "No se pudo cargar.",
      });
    }
  }
  return filas;
}

/** "Juan Pérez, 11 2345-6789" → { nombre, telefono } (el teléfono es lo último con dígitos). */
export function separarLinea(linea: string): { nombre: string; telefono: string } | null {
  const porSeparador = linea
    .split(/\t|;|,| - /)
    .map((p) => p.trim())
    .filter(Boolean);
  if (porSeparador.length >= 2) {
    const telefono = porSeparador[porSeparador.length - 1]!;
    const nombre = porSeparador.slice(0, -1).join(" ");
    if (/\d{6,}/.test(telefono.replace(/\D/g, "")) && /\p{L}/u.test(nombre))
      return { nombre, telefono };
  }
  // Sin separador: el teléfono es la cola numérica ("Juan Pérez 1123456789").
  const m = /^(.*?\p{L}.*?)\s+(\+?[\d\s()-]{6,})$/u.exec(linea);
  return m ? { nombre: m[1]!.trim(), telefono: m[2]!.trim() } : null;
}

/** Validación en vivo del teléfono en «Mis clientes»: ¿ya es de alguien? */
export async function telefonoEnCartera(
  ctx: Ctx,
  vendedorId: string,
  telefono: string,
): Promise<{
  cliente: ClienteBasico;
  de: "MIA" | "NADIE" | "OTRO";
  vendedor: string | null;
} | null> {
  const t = normalizarTelefono(telefono);
  if (!t) return null;
  const c = await dbPara(ctx.panelId).cliente.findFirst({
    where: { telefono: t, deletedAt: null },
    select: {
      id: true,
      nombre: true,
      telefono: true,
      vendedorId: true,
      vendedor: { select: { nombre: true } },
    },
  });
  if (!c) return null;
  return {
    cliente: { id: c.id, nombre: c.nombre, telefono: c.telefono },
    de: c.vendedorId === vendedorId ? "MIA" : c.vendedorId ? "OTRO" : "NADIE",
    vendedor: c.vendedor?.nombre ?? null,
  };
}

/** Datos (nombre, teléfono, notas) de un cliente de la cartera. */
export async function editarClienteDeCartera(
  ctx: Ctx,
  vendedorId: string,
  input: { id: string; nombre: string; telefono: string; notas?: string | null },
): Promise<ClienteBasico> {
  const c = await dbPara(ctx.panelId).cliente.findFirst({
    where: { id: input.id, vendedorId, deletedAt: null },
    select: { id: true },
  });
  if (!c) throw new NotFoundError("El cliente no está en tu cartera.");
  return actualizarCliente(ctx, input);
}

/**
 * Quitar de la cartera (cargado por error): solo los que ya tenía. Los que se
 * sumaron con una venta quedan: son el registro de esa venta de cliente nuevo.
 */
export async function quitarDeCartera(ctx: Ctx, vendedorId: string, id: string): Promise<void> {
  await transaccion(ctx, async (tx) => {
    const c = await tx.cliente.findFirst({
      where: { id, vendedorId, deletedAt: null },
      select: { id: true, nombre: true, creadoEnVenta: { select: { vendedorId: true } } },
    });
    if (!c) throw new NotFoundError("El cliente no está en tu cartera.");
    if (c.creadoEnVenta?.vendedorId === vendedorId)
      throw new DomainError(
        `${c.nombre} se sumó con una venta tuya como cliente nuevo: no se puede quitar.`,
      );
    await asignar(tx, ctx, c.id, null);
  });
}
