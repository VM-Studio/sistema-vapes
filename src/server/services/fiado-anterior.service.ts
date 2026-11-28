import { AccionAuditoria, EstadoFiadoAnterior, RolUsuario, Prisma } from "@prisma/client";

import { hoyAR } from "@/lib/fechas";
import { formatearIdFiadoAnterior } from "@/lib/paneles";
import { ahora } from "@/lib/reloj";
import type { CargarFiadoAnterior } from "@/lib/validations/fiado";
import { transaccion, type Tx } from "@/server/db/panel-scoped";
import { siguienteNumero } from "@/server/db/secuencia";
import { DomainError, ForbiddenError, NotFoundError } from "@/server/errors";
import { registrarAuditoria } from "@/server/services/audit.service";
import { cotizacionesParaVenta } from "@/server/services/cambio.service";
import { carteraDeVendedor } from "@/server/services/cartera-clientes.service";
import { crearCliente } from "@/server/services/cliente.service";
import { bloquearCliente, puedeFiados, type CtxFiados } from "@/server/services/fiado.service";

/**
 * FIADOS ANTERIORES — «Cargar fiado anterior» (v2.14.0): lo que un cliente ya
 * debía ANTES de usar el sistema, cargado a mano para tener todas las cuentas
 * en Fiados. No es una venta (no mueve stock ni cuenta como vendido ni como
 * ganancia): suma a `Cliente.saldoDeudor` y desde ahí se cobra como cualquier
 * fiado (ver fiado.service: cobrar / anularCobro / cuentaCorriente).
 *
 * - Cargarlo: FIADOS "crear". Cliente existente o nuevo (como en una venta).
 * - Anularlo: solo dueños, y solo si no tiene cobros vigentes (anular antes
 *   los cobros). No se edita: se anula y se vuelve a cargar.
 */

const dec = (d: Prisma.Decimal) => d.toFixed(2);

/** "YYYY-MM-DD" (hora argentina) → instante; hoy = ahora, otro día = 12 hs de ese día. */
function fechaDelFiado(fecha: string | undefined): Date {
  const instante = ahora();
  if (!fecha || fecha === hoyAR(instante)) return instante;
  if (fecha > hoyAR(instante)) throw new DomainError("La fecha no puede ser futura.");
  return new Date(`${fecha}T12:00:00.000-03:00`);
}

async function slugDelPanel(tx: Tx, panelId: string): Promise<string> {
  const p = await tx.panel.findUniqueOrThrow({ where: { id: panelId }, select: { slug: true } });
  return p.slug;
}

export interface FiadoAnteriorCargado {
  id: string;
  codigo: string;
  cliente: { id: string; nombre: string };
  monto: string;
  saldoDeudor: string;
  clienteNuevo: boolean;
}

export async function cargarFiadoAnterior(
  ctx: CtxFiados,
  input: CargarFiadoAnterior,
): Promise<FiadoAnteriorCargado> {
  const monto = new Prisma.Decimal(input.monto).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  if (monto.lessThanOrEqualTo(0)) throw new DomainError("El monto tiene que ser mayor a 0.");
  const fecha = fechaDelFiado(input.fecha);
  const cambio = await cotizacionesParaVenta();
  return transaccion(
    ctx,
    async (tx) => {
      if (!(await puedeFiados(ctx, "crear", tx)))
        throw new ForbiddenError("No tenés permiso para cargar fiados.");

      let cliente: { id: string; nombre: string };
      let clienteNuevo = false;
      if ("nuevo" in input.cliente) {
        const c = await crearCliente(ctx, input.cliente.nuevo, tx, {
          vendedorId: await carteraDeVendedor(tx, ctx.usuarioId),
        });
        cliente = { id: c.id, nombre: c.nombre };
        clienteNuevo = true;
      } else {
        const c = await tx.cliente.findFirst({
          where: { id: input.cliente.id, deletedAt: null },
          select: { id: true, nombre: true, activo: true },
        });
        if (!c) throw new NotFoundError("El cliente no existe o fue dado de baja.");
        if (!c.activo) throw new DomainError(`El cliente "${c.nombre}" está inactivo.`);
        cliente = { id: c.id, nombre: c.nombre };
      }
      await bloquearCliente(tx, ctx, cliente.id);

      const numero = await siguienteNumero(tx, ctx.panelId, "FIADO_ANTERIOR");
      const codigo = formatearIdFiadoAnterior(await slugDelPanel(tx, ctx.panelId), numero);
      const concepto = input.concepto?.trim() || null;
      const fiado = await tx.fiadoAnterior.create({
        data: {
          numero,
          codigo,
          clienteId: cliente.id,
          fecha,
          concepto,
          monto,
          saldoPendiente: monto,
          tipoCambioUsdt: cambio.usdt,
          tipoCambioUsd: cambio.usd,
          usuarioId: ctx.usuarioId,
        },
        select: { id: true },
      });
      const c = await tx.cliente.update({
        where: { id: cliente.id },
        data: { saldoDeudor: { increment: monto } },
        select: { saldoDeudor: true },
      });
      await registrarAuditoria(tx, {
        usuarioId: ctx.usuarioId,
        accion: AccionAuditoria.CREATE,
        entidad: "FiadoAnterior",
        entidadId: fiado.id,
        datosDespues: {
          codigo,
          clienteId: cliente.id,
          monto: dec(monto),
          fecha: fecha.toISOString(),
          concepto,
          saldoDeudor: dec(c.saldoDeudor),
        },
        meta: ctx.meta,
      });
      return {
        id: fiado.id,
        codigo,
        cliente,
        monto: dec(monto),
        saldoDeudor: dec(c.saldoDeudor),
        clienteNuevo,
      };
    },
    { maxRetries: 10, timeout: 30_000 },
  );
}

/** Anula un fiado anterior cargado por error (solo dueños; sin cobros vigentes). */
export async function anularFiadoAnterior(
  ctx: CtxFiados,
  fiadoId: string,
  motivo: string,
): Promise<{ clienteId: string; codigo: string }> {
  const m = motivo.trim();
  if (!m) throw new DomainError("Contá por qué se anula el fiado.");
  return transaccion(
    ctx,
    async (tx) => {
      const u = await tx.usuario.findUnique({
        where: { id: ctx.usuarioId },
        select: { rol: true },
      });
      if (u?.rol !== RolUsuario.OWNER)
        throw new ForbiddenError("Solo un dueño puede anular fiados anteriores.");
      const previo = await tx.fiadoAnterior.findUnique({
        where: { id: fiadoId },
        select: { clienteId: true },
      });
      if (!previo) throw new NotFoundError("El fiado no existe.");
      await bloquearCliente(tx, ctx, previo.clienteId);
      const f = await tx.fiadoAnterior.findUniqueOrThrow({
        where: { id: fiadoId },
        select: {
          codigo: true,
          estado: true,
          monto: true,
          saldoPendiente: true,
          _count: { select: { pagos: { where: { anulado: false } } } },
        },
      });
      if (f.estado === EstadoFiadoAnterior.ANULADO)
        throw new DomainError(`El fiado ${f.codigo} ya está anulado.`);
      if (f._count.pagos > 0)
        throw new DomainError(
          `El fiado ${f.codigo} tiene cobros: anulá primero los cobros en la cuenta corriente.`,
        );
      await tx.fiadoAnterior.update({
        where: { id: fiadoId },
        data: {
          estado: EstadoFiadoAnterior.ANULADO,
          montoPagado: 0,
          saldoPendiente: 0,
          anuladoPorId: ctx.usuarioId,
          anuladoAt: ahora(),
          motivoAnulacion: m,
        },
      });
      const c = await tx.cliente.update({
        where: { id: previo.clienteId },
        data: { saldoDeudor: { decrement: f.saldoPendiente } },
        select: { saldoDeudor: true },
      });
      await registrarAuditoria(tx, {
        usuarioId: ctx.usuarioId,
        accion: AccionAuditoria.UPDATE,
        entidad: "FiadoAnterior",
        entidadId: fiadoId,
        datosAntes: { estado: f.estado, saldoPendiente: dec(f.saldoPendiente) },
        datosDespues: { estado: "ANULADO", motivo: m, saldoDeudor: dec(c.saldoDeudor) },
        meta: ctx.meta,
      });
      return { clienteId: previo.clienteId, codigo: f.codigo };
    },
    { maxRetries: 10, timeout: 30_000 },
  );
}
