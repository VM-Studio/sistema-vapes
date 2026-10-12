import {
  AccionAuditoria,
  EstadoComisionPasista,
  EstadoCompra,
  MedioPago,
  Prisma,
  RolUsuario,
  TipoComisionPasista,
} from "@prisma/client";
import { z } from "zod";

import { formatearIdCompra } from "@/lib/paneles";
import { esOwner, type SujetoPermisos } from "@/lib/permisos";
import { dbPara, transaccion, type Ctx, type Tx } from "@/server/db/panel-scoped";
import { DomainError, ForbiddenError, NotFoundError } from "@/server/errors";
import { registrarAuditoria } from "@/server/services/audit.service";

/**
 * PASISTA: comisión del pasista por compra y su acumulado mensual.
 *
 * - Cada compra con el tick de comisión tiene UNA fila ORIGINAL en
 *   ComisionPasista con el monto de `Compra.comisionPasistaMonto`. La
 *   mantiene `sincronizarComisionPasista`, dentro de la MISMA transacción
 *   que cambia la compra (crear/editar, tick, recálculo, anulación).
 * - Mientras está PENDIENTE se actualiza (o se borra si se destilda). PAGADA
 *   no se toca (trigger): destildar da DomainError y un cambio de monto (o la
 *   anulación de la compra) genera una fila AJUSTE con la diferencia (±),
 *   que se paga junto con el resto del mes.
 * - El mes es una columna generada en la DB (mes argentino de la fecha de la
 *   compra). Marcar pagadas y deshacer pagos: solo dueños.
 */

const dec = (d: Prisma.Decimal | string | number) => new Prisma.Decimal(d).toFixed(2);

/** "2026-10" → 2026-10-01 (DATE de Postgres llega como medianoche UTC). */
export const fechaDeMes = (mes: string) => new Date(`${mes}-01T00:00:00.000Z`);
export const mesDeFecha = (d: Date) => d.toISOString().slice(0, 7);

/** Mes argentino actual ("YYYY-MM"). */
export function mesActualAR(ahora = new Date()): string {
  return new Date(ahora.getTime() - 3 * 3_600_000).toISOString().slice(0, 7);
}

async function exigirOwner(ctx: Ctx & { usuario?: Pick<SujetoPermisos, "rol"> }, que: string) {
  const owner = ctx.usuario
    ? esOwner(ctx.usuario)
    : (
        await dbPara(ctx.panelId).usuario.findUnique({
          where: { id: ctx.usuarioId },
          select: { rol: true },
        })
      )?.rol === RolUsuario.OWNER;
  if (!owner) throw new ForbiddenError(`${que}: solo los dueños.`);
}

async function slugDelPanel(tx: Tx, panelId: string): Promise<string> {
  const panel = await tx.panel.findUnique({ where: { id: panelId }, select: { slug: true } });
  if (!panel) throw new NotFoundError("El panel no existe");
  return panel.slug;
}

// =============================================================================
// Sincronización con la compra (la llama compra.service)
// =============================================================================

/**
 * Deja ComisionPasista coherente con la compra (bloqueada por quien llama):
 * devengado = comisión de la compra (0 si está anulada o sin tick).
 */
export async function sincronizarComisionPasista(
  tx: Tx,
  ctx: Ctx,
  compraId: string,
): Promise<void> {
  const compra = await tx.compra.findUnique({
    where: { id: compraId },
    select: {
      numero: true,
      estado: true,
      fecha: true,
      total: true,
      comisionPasistaPorcentaje: true,
      comisionPasistaMonto: true,
    },
  });
  if (!compra) throw new NotFoundError("La compra no existe");
  const filas = await tx.comisionPasista.findMany({ where: { compraId } });
  const original = filas.find((f) => f.tipo === TipoComisionPasista.ORIGINAL);
  const ajuste = filas.find((f) => f.tipo === TipoComisionPasista.AJUSTE);
  const anulada = compra.estado === EstadoCompra.ANULADA;
  const objetivo = anulada ? new Prisma.Decimal(0) : compra.comisionPasistaMonto;
  const datos = {
    porcentaje: compra.comisionPasistaPorcentaje,
    base: compra.total,
    fecha: compra.fecha,
  };

  if (!original) {
    if (objetivo.gt(0))
      await tx.comisionPasista.create({
        data: { compraId, tipo: TipoComisionPasista.ORIGINAL, monto: objetivo, ...datos },
      });
    return;
  }

  if (original.estado === EstadoComisionPasista.PENDIENTE) {
    // Sin pagar no hay ajustes (deshacerPago los vuelve a juntar).
    if (objetivo.lte(0)) await tx.comisionPasista.delete({ where: { id: original.id } });
    else if (
      !original.monto.equals(objetivo) ||
      original.fecha.getTime() !== compra.fecha.getTime() ||
      !original.base.equals(compra.total) ||
      String(original.porcentaje) !== String(compra.comisionPasistaPorcentaje)
    )
      await tx.comisionPasista.update({
        where: { id: original.id },
        data: { monto: objetivo, ...datos },
      });
    return;
  }

  // ORIGINAL pagada.
  const idVisible = formatearIdCompra(await slugDelPanel(tx, ctx.panelId), compra.numero);
  if (objetivo.lte(0) && !anulada)
    throw new DomainError(
      `La comisión del pasista de la compra ${idVisible} ya se pagó: no se puede quitar. Deshacé el pago primero en Pasista.`,
    );
  const diferencia = objetivo.minus(original.monto);
  if (ajuste?.estado === EstadoComisionPasista.PAGADA) {
    if (diferencia.equals(ajuste.monto)) return;
    throw new DomainError(
      `La comisión de la compra ${idVisible} y su ajuste ya se pagaron: deshacé el pago del ajuste en Pasista para volver a cambiarla.`,
    );
  }
  if (diferencia.isZero()) {
    if (ajuste) await tx.comisionPasista.delete({ where: { id: ajuste.id } });
    return;
  }
  if (ajuste)
    await tx.comisionPasista.update({
      where: { id: ajuste.id },
      data: { monto: diferencia, ...datos },
    });
  else
    await tx.comisionPasista.create({
      data: {
        compraId,
        tipo: TipoComisionPasista.AJUSTE,
        monto: diferencia,
        ...datos,
        observacion: anulada
          ? "Compra anulada después de pagar la comisión"
          : "La comisión cambió después de pagada",
      },
    });
}

// =============================================================================
// Lectura
// =============================================================================

export interface ResumenMesPasista {
  /** "YYYY-MM". */
  mes: string;
  devengado: string;
  pagado: string;
  pendiente: string;
  compras: number;
}

const resumenSchema = z.array(
  z.object({
    mes: z.date(),
    devengado: z.string(),
    pagado: z.string(),
    pendiente: z.string(),
    compras: z.number().int(),
  }),
);

/** Por mes (desde/hasta "YYYY-MM", inclusive): devengado, pagado, pendiente y compras. */
export async function resumenPorMes(
  ctx: Ctx,
  rango: { desde: string; hasta: string },
): Promise<ResumenMesPasista[]> {
  const filas = await dbPara(ctx.panelId).$queryRaw`
    SELECT cp."mes" AS "mes",
           COALESCE(SUM(cp."monto"), 0)::text AS "devengado",
           COALESCE(SUM(cp."monto") FILTER (WHERE cp."estado" = 'PAGADA'), 0)::text AS "pagado",
           COALESCE(SUM(cp."monto") FILTER (WHERE cp."estado" = 'PENDIENTE'), 0)::text AS "pendiente",
           COUNT(DISTINCT cp."compraId")::int AS "compras"
    FROM "ComisionPasista" cp
    WHERE cp."panelId" = ${ctx.panelId}
      -- El mes va como texto: un Date pasaría por la zona horaria de la sesión.
      AND cp."mes" >= ${`${rango.desde}-01`}::date AND cp."mes" <= ${`${rango.hasta}-01`}::date
    GROUP BY cp."mes"
    ORDER BY cp."mes" DESC`;
  return resumenSchema.parse(filas).map((f) => ({
    mes: mesDeFecha(f.mes),
    devengado: dec(f.devengado),
    pagado: dec(f.pagado),
    pendiente: dec(f.pendiente),
    compras: f.compras,
  }));
}

export interface TotalesPasista {
  /** Pendiente de pago de TODOS los meses. */
  pendienteTotal: string;
  devengadoMes: string;
  pagadoMes: string;
  pendienteMes: string;
  comprasMes: number;
}

export async function totalesPasista(ctx: Ctx, mes: string): Promise<TotalesPasista> {
  const db = dbPara(ctx.panelId);
  const [pendiente, delMes] = await Promise.all([
    db.comisionPasista.aggregate({
      where: { estado: EstadoComisionPasista.PENDIENTE },
      _sum: { monto: true },
    }),
    resumenPorMes(ctx, { desde: mes, hasta: mes }),
  ]);
  const m = delMes[0];
  return {
    pendienteTotal: dec(pendiente._sum.monto ?? 0),
    devengadoMes: m?.devengado ?? "0.00",
    pagadoMes: m?.pagado ?? "0.00",
    pendienteMes: m?.pendiente ?? "0.00",
    comprasMes: m?.compras ?? 0,
  };
}

export interface ComisionListada {
  id: string;
  compraId: string;
  /** ID visible de la compra (VAP-C-000001). */
  compra: string;
  estadoCompra: EstadoCompra;
  tipo: TipoComisionPasista;
  fecha: Date;
  proveedor: string | null;
  unidades: number;
  base: string;
  porcentaje: string | null;
  monto: string;
  estado: EstadoComisionPasista;
  pagadaAt: Date | null;
  pagadaPor: string | null;
  medioPago: MedioPago | null;
  referencia: string | null;
  observacion: string | null;
}

export interface FiltrosPasista {
  mes: string;
  estado?: EstadoComisionPasista;
  page: number;
  pageSize: number;
}

const incluirListado = {
  compra: {
    select: {
      numero: true,
      estado: true,
      unidadesTotal: true,
      proveedor: { select: { nombre: true, nombreTienda: true } },
    },
  },
  pagadaPor: { select: { nombre: true } },
} satisfies Prisma.ComisionPasistaInclude;

type FilaListado = Prisma.ComisionPasistaGetPayload<{ include: typeof incluirListado }>;

function aListada(slug: string, c: FilaListado): ComisionListada {
  return {
    id: c.id,
    compraId: c.compraId,
    compra: formatearIdCompra(slug, c.compra.numero),
    estadoCompra: c.compra.estado,
    tipo: c.tipo,
    fecha: c.fecha,
    proveedor: c.compra.proveedor
      ? `${c.compra.proveedor.nombre} (${c.compra.proveedor.nombreTienda})`
      : null,
    unidades: c.compra.unidadesTotal,
    base: dec(c.base),
    porcentaje: c.porcentaje ? dec(c.porcentaje) : null,
    monto: dec(c.monto),
    estado: c.estado,
    pagadaAt: c.pagadaAt,
    pagadaPor: c.pagadaPor?.nombre ?? null,
    medioPago: c.medioPago,
    referencia: c.referencia,
    observacion: c.observacion,
  };
}

export async function listar(
  ctx: Ctx,
  f: FiltrosPasista,
): Promise<{ filas: ComisionListada[]; total: number; page: number; pageSize: number }> {
  const db = dbPara(ctx.panelId);
  const where: Prisma.ComisionPasistaWhereInput = {
    mes: fechaDeMes(f.mes),
    ...(f.estado ? { estado: f.estado } : {}),
  };
  const [total, filas, slug] = await Promise.all([
    db.comisionPasista.count({ where }),
    db.comisionPasista.findMany({
      where,
      orderBy: [{ fecha: "desc" }, { compraId: "asc" }, { tipo: "asc" }],
      skip: (f.page - 1) * f.pageSize,
      take: f.pageSize,
      include: incluirListado,
    }),
    slugDelPanel(db, ctx.panelId),
  ]);
  return { filas: filas.map((c) => aListada(slug, c)), total, page: f.page, pageSize: f.pageSize };
}

/** Todas las del mes (Excel). */
export async function listarMes(ctx: Ctx, mes: string): Promise<ComisionListada[]> {
  const db = dbPara(ctx.panelId);
  const [filas, slug] = await Promise.all([
    db.comisionPasista.findMany({
      where: { mes: fechaDeMes(mes) },
      orderBy: [{ fecha: "asc" }, { compraId: "asc" }, { tipo: "asc" }],
      include: incluirListado,
    }),
    slugDelPanel(db, ctx.panelId),
  ]);
  return filas.map((c) => aListada(slug, c));
}

export interface ItemCompraPasista {
  varianteId: string;
  producto: string;
  /** null = sabor "Único". */
  sabor: string | null;
  sku: string;
  cantidad: number;
  costoUnitario: string;
  costoUnitarioFinal: string;
  subtotal: string;
}

export interface DetalleComisionPasista {
  comision: ComisionListada;
  /** Las otras filas de la misma compra (original / ajuste). */
  relacionadas: ComisionListada[];
  compra: {
    id: string;
    codigo: string;
    fecha: Date;
    estado: EstadoCompra;
    recibidaAt: Date | null;
    proveedor: string | null;
    deposito: string;
    cargadaPor: string;
    unidades: number;
    subtotal: string;
    total: string;
    comisionPasistaPorcentaje: string | null;
    comisionPasistaMonto: string;
    gastosExtrasTotal: string;
    costoFinalTotal: string;
    costoUnitarioFinalPromedio: string;
    items: ItemCompraPasista[];
  };
}

const esSaborUnico = (nombre: string) => nombre.trim().toLowerCase() === "único";

export async function detalle(ctx: Ctx, id: string): Promise<DetalleComisionPasista> {
  const db = dbPara(ctx.panelId);
  const c = await db.comisionPasista.findUnique({ where: { id }, include: incluirListado });
  if (!c) throw new NotFoundError("La comisión no existe");
  const [slug, otras, compra, recibida] = await Promise.all([
    slugDelPanel(db, ctx.panelId),
    db.comisionPasista.findMany({
      where: { compraId: c.compraId, id: { not: c.id } },
      include: incluirListado,
      orderBy: { tipo: "asc" },
    }),
    db.compra.findUniqueOrThrow({
      where: { id: c.compraId },
      include: {
        proveedor: { select: { nombre: true, nombreTienda: true } },
        deposito: { select: { nombre: true } },
        usuario: { select: { nombre: true } },
        items: {
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          include: {
            variante: {
              select: { nombre: true, sku: true, producto: { select: { nombreCompleto: true } } },
            },
          },
        },
      },
    }),
    db.movimientoStock.findFirst({
      where: { referenciaTipo: "COMPRA", referenciaId: c.compraId, tipo: "INGRESO_COMPRA" },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
  ]);
  return {
    comision: aListada(slug, c),
    relacionadas: otras.map((o) => aListada(slug, o)),
    compra: {
      id: compra.id,
      codigo: formatearIdCompra(slug, compra.numero),
      fecha: compra.fecha,
      estado: compra.estado,
      recibidaAt: recibida?.createdAt ?? null,
      proveedor: compra.proveedor
        ? `${compra.proveedor.nombre} (${compra.proveedor.nombreTienda})`
        : null,
      deposito: compra.deposito.nombre,
      cargadaPor: compra.usuario.nombre,
      unidades: compra.unidadesTotal,
      subtotal: dec(compra.subtotal),
      total: dec(compra.total),
      comisionPasistaPorcentaje: compra.comisionPasistaPorcentaje
        ? dec(compra.comisionPasistaPorcentaje)
        : null,
      comisionPasistaMonto: dec(compra.comisionPasistaMonto),
      gastosExtrasTotal: dec(compra.gastosExtrasTotal),
      costoFinalTotal: dec(compra.costoFinalTotal),
      costoUnitarioFinalPromedio: dec(compra.costoUnitarioFinalPromedio),
      items: compra.items.map((i) => ({
        varianteId: i.varianteId,
        producto: i.variante.producto.nombreCompleto,
        sabor: esSaborUnico(i.variante.nombre) ? null : i.variante.nombre,
        sku: i.variante.sku,
        cantidad: i.cantidad,
        costoUnitario: dec(i.costoUnitario),
        costoUnitarioFinal: dec(i.costoUnitarioFinal),
        subtotal: dec(i.subtotal),
      })),
    },
  };
}

// =============================================================================
// Pagos (solo dueños)
// =============================================================================

export interface DatosPagoPasista {
  medioPago: MedioPago;
  referencia?: string;
  /** Fecha del pago (el día que se le pagó al pasista). */
  fecha: Date;
}

/**
 * Marca pagadas las comisiones PENDIENTES indicadas (`ids`) o todas las del
 * `mes`. Devuelve cuántas y cuánto.
 */
export async function marcarPagadas(
  ctx: Ctx & { usuario?: Pick<SujetoPermisos, "rol"> },
  objetivo: { ids: string[] } | { mes: string },
  pago: DatosPagoPasista,
): Promise<{ cantidad: number; total: string }> {
  await exigirOwner(ctx, "Marcar comisiones del pasista como pagadas");
  return transaccion(ctx, async (tx) => {
    const where: Prisma.ComisionPasistaWhereInput =
      "ids" in objetivo ? { id: { in: objetivo.ids } } : { mes: fechaDeMes(objetivo.mes) };
    const filas = await tx.comisionPasista.findMany({
      where: { ...where, estado: EstadoComisionPasista.PENDIENTE },
      select: { id: true, monto: true },
    });
    if ("ids" in objetivo && filas.length !== objetivo.ids.length)
      throw new DomainError("Alguna de las comisiones ya está pagada o no existe");
    if (filas.length === 0) throw new DomainError("No hay comisiones pendientes para marcar");
    const total = filas.reduce((a, f) => a.plus(f.monto), new Prisma.Decimal(0));
    await tx.comisionPasista.updateMany({
      where: { id: { in: filas.map((f) => f.id) }, estado: EstadoComisionPasista.PENDIENTE },
      data: {
        estado: EstadoComisionPasista.PAGADA,
        pagadaAt: pago.fecha,
        pagadaPorId: ctx.usuarioId,
        medioPago: pago.medioPago,
        referencia: pago.referencia?.trim() || null,
      },
    });
    await registrarAuditoria(tx, {
      usuarioId: ctx.usuarioId,
      accion: AccionAuditoria.UPDATE,
      entidad: "ComisionPasista",
      entidadId: "ids" in objetivo ? (objetivo.ids.length === 1 ? objetivo.ids[0] : null) : null,
      datosAntes: { estado: "PENDIENTE" },
      datosDespues: {
        estado: "PAGADA",
        ...("mes" in objetivo ? { mes: objetivo.mes } : {}),
        ids: filas.map((f) => f.id),
        total: dec(total),
        medioPago: pago.medioPago,
        referencia: pago.referencia ?? null,
        fecha: pago.fecha.toISOString(),
      },
      meta: ctx.meta,
    });
    return { cantidad: filas.length, total: dec(total) };
  });
}

/**
 * Vuelve a PENDIENTE una comisión pagada (se cargó por error). Si es la
 * ORIGINAL y tiene un ajuste pendiente, los junta en una sola fila.
 */
export async function deshacerPago(
  ctx: Ctx & { usuario?: Pick<SujetoPermisos, "rol"> },
  id: string,
  motivo: string,
): Promise<void> {
  await exigirOwner(ctx, "Deshacer el pago de una comisión del pasista");
  await transaccion(ctx, async (tx) => {
    const c = await tx.comisionPasista.findUnique({ where: { id } });
    if (!c) throw new NotFoundError("La comisión no existe");
    await tx.$queryRaw`SELECT "id" FROM "Compra" WHERE "id" = ${c.compraId} AND "panelId" = ${ctx.panelId} FOR UPDATE`;
    if (c.estado !== EstadoComisionPasista.PAGADA)
      throw new DomainError("La comisión no está pagada");
    const otra = await tx.comisionPasista.findFirst({
      where: { compraId: c.compraId, id: { not: c.id } },
    });
    if (c.tipo === TipoComisionPasista.ORIGINAL && otra?.estado === EstadoComisionPasista.PAGADA)
      throw new DomainError("Primero deshacé el pago del ajuste de esta compra");
    await tx.comisionPasista.update({
      where: { id },
      data: {
        estado: EstadoComisionPasista.PENDIENTE,
        pagadaAt: null,
        pagadaPorId: null,
        medioPago: null,
        referencia: null,
        observacion: `Pago deshecho: ${motivo}`,
      },
    });
    if (c.tipo === TipoComisionPasista.ORIGINAL && otra) {
      const monto = c.monto.plus(otra.monto);
      await tx.comisionPasista.delete({ where: { id: otra.id } });
      if (monto.gt(0)) await tx.comisionPasista.update({ where: { id }, data: { monto } });
      else await tx.comisionPasista.delete({ where: { id } });
    }
    await registrarAuditoria(tx, {
      usuarioId: ctx.usuarioId,
      accion: AccionAuditoria.UPDATE,
      entidad: "ComisionPasista",
      entidadId: id,
      datosAntes: {
        estado: "PAGADA",
        monto: dec(c.monto),
        medioPago: c.medioPago,
        pagadaAt: c.pagadaAt?.toISOString() ?? null,
      },
      datosDespues: { estado: "PENDIENTE", motivo },
      meta: ctx.meta,
    });
  });
}
