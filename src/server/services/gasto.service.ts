import { AccionAuditoria, EstadoCaja, MedioPago, Prisma, TipoMovimientoCaja } from "@prisma/client";

import { prisma, withTransaction, type Tx } from "@/lib/db";
import { ahora } from "@/lib/reloj";
import type { FiltrosGastos, GastoInput } from "@/lib/validations/finanzas";
import {
  diaEn,
  inicioDia,
  limitesRango,
  sumarDias,
  type DiaISO,
  type Rango,
} from "@/lib/zona-horaria";
import { DomainError, NotFoundError, ValidationError } from "@/server/errors";
import type { Actor } from "@/server/services/actor";
import { registrarAuditoria } from "@/server/services/audit.service";
import {
  cajaAbiertaEnTx,
  registrarMovimientoCaja,
  verificarEfectivoDisponible,
} from "@/server/services/caja.service";
import { obtenerZonaHoraria } from "@/server/services/configuracion.service";
import { recalcularResumenes } from "@/server/services/resumen-diario.service";
import { claveAleatoria, extensionDeImagen, storage } from "@/server/storage";

/**
 * GASTOS (soft delete). Si se pagan en EFECTIVO, con depósito y con fecha de
 * hoy, salen de la caja abierta de ese depósito (MovimientoCaja GASTO en la
 * misma transacción). Cada alta/edición/baja recalcula el ResumenDiario del
 * día (y depósito) afectado.
 */

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const dec = (d: Prisma.Decimal) => d.toFixed(2);
const utc = (d: Date) => Prisma.sql`(${d}::timestamptz AT TIME ZONE 'UTC')`;

export const FOTO_MAX_BYTES = 5 * 1024 * 1024;

export interface FotoComprobante {
  datos: Uint8Array;
  tipo: string;
}

/** Guarda la foto del ticket (antes de la transacción: si la tx falla queda un archivo huérfano, no un gasto sin foto). */
async function guardarFoto(foto: FotoComprobante): Promise<string> {
  const ext = extensionDeImagen(foto.tipo);
  if (!ext)
    throw new ValidationError("La foto tiene que ser JPG, PNG o WebP", {
      comprobante: ["Formato no admitido"],
    });
  if (foto.datos.byteLength > FOTO_MAX_BYTES)
    throw new ValidationError("La foto supera los 5 MB", { comprobante: ["Máximo 5 MB"] });
  return storage.guardar(claveAleatoria("gastos", "ticket", ext), foto.datos, foto.tipo);
}

/** Día elegido → instante: hoy = ahora mismo; otro día = mediodía de ese día (bien adentro del día). */
function fechaDelGasto(dia: DiaISO, tz: string): { fecha: Date; esHoy: boolean } {
  const momento = ahora();
  if (dia === diaEn(momento, tz)) return { fecha: momento, esHoy: true };
  return { fecha: new Date(inicioDia(dia, tz).getTime() + 12 * 3600_000), esHoy: false };
}

async function validarReferencias(tx: Tx, datos: GastoInput) {
  const [categoria, deposito] = await Promise.all([
    tx.categoriaGasto.findUnique({ where: { id: datos.categoriaGastoId } }),
    datos.depositoId
      ? tx.deposito.findUnique({
          where: { id: datos.depositoId },
          select: { nombre: true, activo: true },
        })
      : Promise.resolve(null),
  ]);
  if (!categoria) throw new NotFoundError("La categoría no existe");
  if (!categoria.activo) throw new DomainError(`La categoría "${categoria.nombre}" está inactiva`);
  if (datos.depositoId && !deposito) throw new NotFoundError("El depósito no existe");
  return { categoria, deposito };
}

export async function crearGasto(
  datos: GastoInput,
  foto: FotoComprobante | null,
  actor: Actor,
): Promise<{ id: string; cajaId: string | null }> {
  const comprobanteUrl = foto ? await guardarFoto(foto) : null;
  return withTransaction(
    async (tx) => {
      const tz = await obtenerZonaHoraria(tx);
      const { categoria, deposito } = await validarReferencias(tx, datos);
      const { fecha, esHoy } = fechaDelGasto(datos.fecha, tz);
      const monto = D(datos.monto);
      // Solo el efectivo de HOY sale de la caja abierta (uno de la semana pasada ya salió).
      const caja =
        datos.medioPago === MedioPago.EFECTIVO && datos.depositoId && esHoy
          ? await cajaAbiertaEnTx(tx, datos.depositoId)
          : null;
      if (caja) await verificarEfectivoDisponible(tx, caja.id, monto, "pagar este gasto");
      const gasto = await tx.gasto.create({
        data: {
          fecha,
          categoriaGastoId: datos.categoriaGastoId,
          descripcion: datos.descripcion,
          monto,
          medioPago: datos.medioPago,
          depositoId: datos.depositoId ?? null,
          cajaId: caja?.id ?? null,
          comprobanteUrl,
          recurrente: datos.recurrente,
          usuarioId: actor.id,
        },
      });
      if (caja) {
        await registrarMovimientoCaja(tx, {
          cajaId: caja.id,
          tipo: TipoMovimientoCaja.GASTO,
          monto: monto.neg(),
          referenciaTipo: "GASTO",
          referenciaId: gasto.id,
          descripcion: `${categoria.nombre}: ${datos.descripcion}`,
          usuarioId: actor.id,
        });
      }
      await registrarAuditoria(tx, {
        usuarioId: actor.id,
        accion: AccionAuditoria.CREATE,
        entidad: "Gasto",
        entidadId: gasto.id,
        datosDespues: {
          fecha: datos.fecha,
          categoria: categoria.nombre,
          descripcion: datos.descripcion,
          monto: dec(monto),
          medioPago: datos.medioPago,
          deposito: deposito?.nombre ?? null,
          cajaId: caja?.id ?? null,
          recurrente: datos.recurrente,
        },
        meta: actor.meta,
      });
      await recalcularResumenes(tx, [{ fecha, depositoId: datos.depositoId ?? null }]);
      return { id: gasto.id, cajaId: caja?.id ?? null };
    },
    { maxRetries: 3 },
  );
}

/**
 * Edición. Un gasto que salió de una caja ya no cambia de monto, medio,
 * depósito ni fecha (la plata ya salió de esa caja): solo descripción,
 * categoría, recurrente y foto.
 */
export async function actualizarGasto(
  id: string,
  datos: GastoInput,
  foto: FotoComprobante | null,
  actor: Actor,
): Promise<{ id: string }> {
  const comprobanteUrl = foto ? await guardarFoto(foto) : undefined;
  return withTransaction(
    async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Gasto" WHERE "id" = ${id} FOR UPDATE`;
      const antes = await tx.gasto.findFirst({ where: { id, deletedAt: null } });
      if (!antes) throw new NotFoundError("El gasto no existe");
      const tz = await obtenerZonaHoraria(tx);
      await validarReferencias(tx, datos);
      const monto = D(datos.monto);
      const mismoDia = diaEn(antes.fecha, tz) === datos.fecha;
      if (antes.cajaId) {
        const cambiaPlata =
          !monto.equals(antes.monto) ||
          datos.medioPago !== antes.medioPago ||
          (datos.depositoId ?? null) !== antes.depositoId ||
          !mismoDia;
        if (cambiaPlata) {
          throw new DomainError(
            "Este gasto salió de la caja: no se cambian monto, medio, depósito ni fecha. Borralo y cargalo de nuevo.",
          );
        }
      }
      const fecha = mismoDia ? antes.fecha : fechaDelGasto(datos.fecha, tz).fecha;
      await tx.gasto.update({
        where: { id },
        data: {
          fecha,
          categoriaGastoId: datos.categoriaGastoId,
          descripcion: datos.descripcion,
          monto,
          medioPago: datos.medioPago,
          depositoId: datos.depositoId ?? null,
          recurrente: datos.recurrente,
          ...(comprobanteUrl ? { comprobanteUrl } : {}),
        },
      });
      await registrarAuditoria(tx, {
        usuarioId: actor.id,
        accion: AccionAuditoria.UPDATE,
        entidad: "Gasto",
        entidadId: id,
        datosAntes: {
          fecha: diaEn(antes.fecha, tz),
          monto: dec(antes.monto),
          medioPago: antes.medioPago,
          descripcion: antes.descripcion,
        },
        datosDespues: {
          fecha: datos.fecha,
          monto: dec(monto),
          medioPago: datos.medioPago,
          descripcion: datos.descripcion,
        },
        meta: actor.meta,
      });
      await recalcularResumenes(tx, [
        { fecha: antes.fecha, depositoId: antes.depositoId },
        { fecha, depositoId: datos.depositoId ?? null },
      ]);
      return { id };
    },
    { maxRetries: 3 },
  );
}

/**
 * Baja lógica. Si salió de una caja todavía abierta, la plata vuelve a esa
 * caja (INGRESO_EXTRA). Si esa caja ya cerró, no se borra: el arqueo ya lo contó.
 */
export async function eliminarGasto(id: string, actor: Actor): Promise<void> {
  await withTransaction(
    async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Gasto" WHERE "id" = ${id} FOR UPDATE`;
      const g = await tx.gasto.findFirst({
        where: { id, deletedAt: null },
        include: { caja: { select: { estado: true } } },
      });
      if (!g) throw new NotFoundError("El gasto no existe");
      if (g.cajaId && g.caja) {
        if (g.caja.estado === EstadoCaja.CERRADA) {
          throw new DomainError(
            "Este gasto salió de una caja que ya cerró: no se borra. Si fue un error, registrá un ingreso extra en la caja de hoy.",
          );
        }
        await tx.$queryRaw`SELECT "id" FROM "Caja" WHERE "id" = ${g.cajaId} FOR SHARE`;
        await registrarMovimientoCaja(tx, {
          cajaId: g.cajaId,
          tipo: TipoMovimientoCaja.INGRESO_EXTRA,
          monto: g.monto,
          referenciaTipo: "GASTO",
          referenciaId: g.id,
          descripcion: `Gasto borrado: ${g.descripcion}`,
          usuarioId: actor.id,
        });
      }
      await tx.gasto.update({ where: { id }, data: { deletedAt: ahora() } });
      await registrarAuditoria(tx, {
        usuarioId: actor.id,
        accion: AccionAuditoria.DELETE,
        entidad: "Gasto",
        entidadId: id,
        datosAntes: { descripcion: g.descripcion, monto: dec(g.monto), medioPago: g.medioPago },
        meta: actor.meta,
      });
      await recalcularResumenes(tx, [{ fecha: g.fecha, depositoId: g.depositoId }]);
    },
    { maxRetries: 3 },
  );
}

// =============================================================================
// Lectura
// =============================================================================

export async function listarCategoriasGasto(soloActivas = true) {
  return prisma.categoriaGasto.findMany({
    where: soloActivas ? { activo: true } : {},
    orderBy: { nombre: "asc" },
  });
}

export interface GastoListado {
  id: string;
  fecha: Date;
  categoriaId: string;
  categoria: string;
  descripcion: string;
  monto: string;
  medioPago: MedioPago;
  depositoId: string | null;
  deposito: string | null;
  cajaId: string | null;
  comprobanteUrl: string | null;
  recurrente: boolean;
  usuario: string;
}

function whereGastos(
  f: Omit<FiltrosGastos, "page" | "pageSize">,
  tz: string,
): Prisma.GastoWhereInput {
  const where: Prisma.GastoWhereInput = { deletedAt: null };
  if (f.categoriaGastoId) where.categoriaGastoId = f.categoriaGastoId;
  if (f.depositoId) where.depositoId = f.depositoId;
  if (f.medioPago) where.medioPago = f.medioPago;
  if (f.desde || f.hasta) {
    const { inicio, fin } = limitesRango(f.desde ?? "2000-01-01", f.hasta ?? "2999-12-31", tz);
    where.fecha = { gte: inicio, lt: fin };
  }
  if (f.q) where.descripcion = { contains: f.q, mode: "insensitive" };
  return where;
}

export async function listarGastos(f: FiltrosGastos): Promise<{
  gastos: GastoListado[];
  total: number;
  page: number;
  pageSize: number;
  totalMonto: string;
}> {
  const tz = await obtenerZonaHoraria();
  const where = whereGastos(f, tz);
  const [total, filas, suma] = await Promise.all([
    prisma.gasto.count({ where }),
    prisma.gasto.findMany({
      where,
      orderBy: [{ fecha: "desc" }, { createdAt: "desc" }],
      skip: (f.page - 1) * f.pageSize,
      take: f.pageSize,
      include: {
        categoria: { select: { nombre: true } },
        deposito: { select: { nombre: true } },
        usuario: { select: { nombre: true } },
      },
    }),
    prisma.gasto.aggregate({ where, _sum: { monto: true } }),
  ]);
  return {
    gastos: filas.map((g) => ({
      id: g.id,
      fecha: g.fecha,
      categoriaId: g.categoriaGastoId,
      categoria: g.categoria.nombre,
      descripcion: g.descripcion,
      monto: dec(g.monto),
      medioPago: g.medioPago,
      depositoId: g.depositoId,
      deposito: g.deposito?.nombre ?? null,
      cajaId: g.cajaId,
      comprobanteUrl: g.comprobanteUrl,
      recurrente: g.recurrente,
      usuario: g.usuario.nombre,
    })),
    total,
    page: f.page,
    pageSize: f.pageSize,
    totalMonto: dec(suma._sum.monto ?? D(0)),
  };
}

export async function obtenerGasto(id: string): Promise<GastoListado & { diaISO: DiaISO }> {
  const tz = await obtenerZonaHoraria();
  const g = await prisma.gasto.findFirst({
    where: { id, deletedAt: null },
    include: {
      categoria: { select: { nombre: true } },
      deposito: { select: { nombre: true } },
      usuario: { select: { nombre: true } },
    },
  });
  if (!g) throw new NotFoundError("El gasto no existe");
  return {
    id: g.id,
    fecha: g.fecha,
    diaISO: diaEn(g.fecha, tz),
    categoriaId: g.categoriaGastoId,
    categoria: g.categoria.nombre,
    descripcion: g.descripcion,
    monto: dec(g.monto),
    medioPago: g.medioPago,
    depositoId: g.depositoId,
    deposito: g.deposito?.nombre ?? null,
    cajaId: g.cajaId,
    comprobanteUrl: g.comprobanteUrl,
    recurrente: g.recurrente,
    usuario: g.usuario.nombre,
  };
}

export async function gastosPorCategoria(r: Rango & { depositoId?: string }) {
  const tz = await obtenerZonaHoraria();
  const { inicio, fin } = limitesRango(r.desde, r.hasta, tz);
  const filas = await prisma.$queryRaw<
    { categoriaId: string; categoria: string; total: Prisma.Decimal; n: bigint }[]
  >`
    SELECT c."id" AS "categoriaId", c."nombre" AS categoria, SUM(g."monto") AS total, COUNT(*) AS n
    FROM "Gasto" g JOIN "CategoriaGasto" c ON c."id" = g."categoriaGastoId"
    WHERE g."deletedAt" IS NULL AND g."fecha" >= ${utc(inicio)} AND g."fecha" < ${utc(fin)}
      ${r.depositoId ? Prisma.sql`AND g."depositoId" = ${r.depositoId}` : Prisma.empty}
    GROUP BY c."id", c."nombre" ORDER BY total DESC
  `;
  return filas.map((f) => ({
    categoriaId: f.categoriaId,
    categoria: f.categoria,
    total: dec(D(f.total)),
    cantidad: Number(f.n),
  }));
}

export async function gastosPorMes(r: Rango & { depositoId?: string }) {
  const tz = await obtenerZonaHoraria();
  const { inicio, fin } = limitesRango(r.desde, r.hasta, tz);
  const filas = await prisma.$queryRaw<{ mes: string; categoria: string; total: Prisma.Decimal }[]>`
    SELECT to_char(g."fecha" AT TIME ZONE 'UTC' AT TIME ZONE ${tz}, 'YYYY-MM') AS mes,
           c."nombre" AS categoria, SUM(g."monto") AS total
    FROM "Gasto" g JOIN "CategoriaGasto" c ON c."id" = g."categoriaGastoId"
    WHERE g."deletedAt" IS NULL AND g."fecha" >= ${utc(inicio)} AND g."fecha" < ${utc(fin)}
      ${r.depositoId ? Prisma.sql`AND g."depositoId" = ${r.depositoId}` : Prisma.empty}
    GROUP BY 1, 2 ORDER BY 1, 2
  `;
  return filas.map((f) => ({ mes: f.mes, categoria: f.categoria, total: dec(D(f.total)) }));
}

/**
 * Recordatorio (no se cargan solos): gastos marcados recurrentes el mes
 * anterior que todavía no tienen un gasto de la misma categoría y
 * descripción este mes.
 */
export async function recurrentesPendientes(): Promise<
  {
    id: string;
    categoria: string;
    categoriaId: string;
    descripcion: string;
    monto: string;
    medioPago: MedioPago;
    depositoId: string | null;
  }[]
> {
  const tz = await obtenerZonaHoraria();
  const hoy = diaEn(ahora(), tz);
  const inicioMes = `${hoy.slice(0, 8)}01`;
  const finMesAnterior = sumarDias(inicioMes, -1);
  const mesAnterior = limitesRango(`${finMesAnterior.slice(0, 8)}01`, finMesAnterior, tz);
  const esteMes = limitesRango(inicioMes, hoy, tz);
  const filas = await prisma.$queryRaw<
    {
      id: string;
      categoria: string;
      categoriaId: string;
      descripcion: string;
      monto: Prisma.Decimal;
      medioPago: MedioPago;
      depositoId: string | null;
    }[]
  >`
    SELECT DISTINCT ON (g."categoriaGastoId", lower(btrim(g."descripcion")))
           g."id", c."nombre" AS categoria, c."id" AS "categoriaId", g."descripcion", g."monto",
           g."medioPago", g."depositoId"
    FROM "Gasto" g JOIN "CategoriaGasto" c ON c."id" = g."categoriaGastoId"
    WHERE g."deletedAt" IS NULL AND g."recurrente"
      AND g."fecha" >= ${utc(mesAnterior.inicio)} AND g."fecha" < ${utc(mesAnterior.fin)}
      AND NOT EXISTS (
        SELECT 1 FROM "Gasto" h
        WHERE h."deletedAt" IS NULL AND h."categoriaGastoId" = g."categoriaGastoId"
          AND lower(btrim(h."descripcion")) = lower(btrim(g."descripcion"))
          AND h."fecha" >= ${utc(esteMes.inicio)} AND h."fecha" < ${utc(esteMes.fin)}
      )
    ORDER BY g."categoriaGastoId", lower(btrim(g."descripcion")), g."fecha" DESC
  `;
  return filas.map((f) => ({ ...f, monto: dec(D(f.monto)) }));
}
