import { AccionAuditoria, Escaneo, EstadoVenta, type Prisma } from "@prisma/client";

import { NOMBRE_ESCANEO } from "@/lib/escaneo-remoto";
import { ahora } from "@/lib/reloj";
import { nombreConSabor } from "@/lib/ventas-ui";
import { dbPara, transaccion, type Ctx } from "@/server/db/panel-scoped";
import { DomainError, ForbiddenError, NotFoundError } from "@/server/errors";
import { registrarAuditoria } from "@/server/services/audit.service";

/**
 * «RETIRADO» — el cliente se llevó la mercadería de una venta.
 *
 * - La venta descontó el stock al generarse (VENTA en el ledger). El retiro NO
 *   mueve stock: separa lo vendido que todavía está físicamente en el galpón
 *   (pendiente de retiro; si Charly lo escaneó, «escaneado» = reservado) de lo
 *   que ya salió («retirado»). Ver las tarjetas de Stock (inventario.service).
 * - Solo ventas CONFIRMADAS, una sola vez (no se deshace: trigger en la DB).
 * - Con el escaneo de Charly PENDIENTE no se puede (CHECK en la DB): primero
 *   tiene que escanearla.
 * - Quién: con VENTAS «crear» (vendedores y dueños), o el usuario de escaneo
 *   (ESCANEO «ver») si la venta ya está escaneada: es quien la entrega en el galpón.
 */

export interface PermisosRetiro {
  /** VENTAS «crear». */
  porVentas: boolean;
  /** ESCANEO «ver» (Charly): solo ventas ya escaneadas. */
  porEscaneo: boolean;
}

export interface EstadoRetiro {
  /** null = pendiente de retiro. */
  retiradaAt: Date | null;
  retiradaPor: string | null;
}

/** Por qué una venta no se puede marcar como retirada (null = se puede). */
export function motivoNoRetirable(v: {
  codigo?: string;
  estado: EstadoVenta;
  retiradaAt: Date | null;
  escaneoRemoto: Escaneo | null;
}): string | null {
  const cual = v.codigo ? `La venta ${v.codigo}` : "La venta";
  if (v.estado !== EstadoVenta.CONFIRMADA) return `${cual} está anulada.`;
  if (v.retiradaAt) return `${cual} ya está retirada.`;
  if (v.escaneoRemoto === Escaneo.PENDIENTE)
    return `Falta que ${NOMBRE_ESCANEO} la escanee: cuando la escanee se puede marcar como retirada.`;
  return null;
}

export async function marcarRetirada(
  ctx: Ctx,
  ventaId: string,
  permisos: PermisosRetiro,
): Promise<{ id: string; codigo: string; retiradaAt: Date }> {
  if (!permisos.porVentas && !permisos.porEscaneo)
    throw new ForbiddenError("No tenés permiso para marcar ventas como retiradas.");
  return transaccion(
    ctx,
    async (tx) => {
      await tx.$queryRaw`
        SELECT "id" FROM "Venta" WHERE "id" = ${ventaId} AND "panelId" = ${ctx.panelId} FOR UPDATE
      `;
      const v = await tx.venta.findUnique({
        where: { id: ventaId },
        select: {
          id: true,
          codigo: true,
          estado: true,
          retiradaAt: true,
          escaneoRemoto: true,
          depositoId: true,
          items: { select: { cantidad: true } },
        },
      });
      if (!v) throw new NotFoundError("La venta no existe");
      if (!permisos.porVentas && v.escaneoRemoto !== Escaneo.ESCANEADA)
        throw new ForbiddenError(
          `Solo podés marcar como retiradas las ventas que ya escaneaste (${v.codigo}).`,
        );
      const motivo = motivoNoRetirable(v);
      if (motivo) throw new DomainError(motivo, "VENTA_NO_RETIRABLE");
      const cuando = ahora();
      await tx.venta.update({
        where: { id: ventaId },
        data: { retiradaAt: cuando, retiradaPorId: ctx.usuarioId },
      });
      await registrarAuditoria(tx, {
        usuarioId: ctx.usuarioId,
        accion: AccionAuditoria.UPDATE,
        entidad: "Venta",
        entidadId: ventaId,
        datosAntes: { retiradaAt: null },
        datosDespues: {
          codigo: v.codigo,
          retirada: true,
          retiradaAt: cuando.toISOString(),
          unidades: v.items.reduce((a, i) => a + i.cantidad, 0),
        },
        meta: ctx.meta,
      });
      return { id: v.id, codigo: v.codigo, retiradaAt: cuando };
    },
    { maxRetries: 5, timeout: 30_000 },
  );
}

// =============================================================================
// Listado: ventas escaneadas que esperan el retiro (pantalla de Charly / inicio)
// =============================================================================

export interface VentaParaRetirar {
  id: string;
  codigo: string;
  fecha: Date;
  cliente: string;
  vendedor: string;
  deposito: string;
  escaneadaAt: Date | null;
  escaneadaPor: string | null;
  unidades: number;
  items: { titulo: string; cantidad: number }[];
}

/**
 * Ventas confirmadas, escaneadas por Charly y todavía no retiradas (las más
 * viejas primero). `soloPropias`: las del vendedor del ctx.
 */
export async function listarEscaneadasSinRetirar(
  ctx: Ctx,
  opciones: { soloPropias?: boolean; limite?: number } = {},
): Promise<VentaParaRetirar[]> {
  const where: Prisma.VentaWhereInput = {
    estado: EstadoVenta.CONFIRMADA,
    escaneoRemoto: Escaneo.ESCANEADA,
    retiradaAt: null,
    ...(opciones.soloPropias ? { vendedorId: ctx.usuarioId } : {}),
  };
  const filas = await dbPara(ctx.panelId).venta.findMany({
    where,
    orderBy: [{ escaneadaAt: "asc" }, { numero: "asc" }],
    take: opciones.limite ?? 50,
    select: {
      id: true,
      codigo: true,
      fecha: true,
      escaneadaAt: true,
      cliente: { select: { nombre: true } },
      vendedor: { select: { nombre: true } },
      deposito: { select: { nombre: true } },
      escaneadaPor: { select: { nombre: true } },
      items: {
        orderBy: { createdAt: "asc" },
        select: {
          cantidad: true,
          variante: { select: { nombre: true, producto: { select: { nombreCompleto: true } } } },
        },
      },
    },
  });
  return filas.map((v) => ({
    id: v.id,
    codigo: v.codigo,
    fecha: v.fecha,
    cliente: v.cliente.nombre,
    vendedor: v.vendedor.nombre,
    deposito: v.deposito.nombre,
    escaneadaAt: v.escaneadaAt,
    escaneadaPor: v.escaneadaPor?.nombre ?? null,
    unidades: v.items.reduce((a, i) => a + i.cantidad, 0),
    items: v.items.map((i) => ({
      titulo: nombreConSabor(i.variante.producto.nombreCompleto, i.variante.nombre),
      cantidad: i.cantidad,
    })),
  }));
}
