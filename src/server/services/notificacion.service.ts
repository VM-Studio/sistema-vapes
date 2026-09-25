import "server-only";

import { Modulo, RolUsuario, TipoNotificacion, type Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { formatearPesos } from "@/lib/format";
import { puede } from "@/lib/permisos";
import { ahora } from "@/lib/reloj";
import {
  CANALES,
  type Destinatario,
  type NotificacionNueva,
} from "@/server/notificaciones/canales";
import { obtenerUsuarioSesion } from "@/server/services/sesion.service";
import { alertasStock, cuentasPorCobrar } from "@/server/services/reporte.service";

/**
 * NOTIFICACIONES: quién recibe qué y el job diario de alertas.
 * Destinatarios: los dueños siempre; los empleados, si pueden ver el módulo
 * del aviso (stock → INVENTARIO, transferencias → MOVIMIENTOS, deudas →
 * CLIENTES). Las diferencias de caja, solo los dueños.
 */

const MODULO_DE: Record<TipoNotificacion, Modulo | null> = {
  STOCK_BAJO: Modulo.INVENTARIO,
  SIN_STOCK: Modulo.INVENTARIO,
  TRANSFERENCIA_PENDIENTE: Modulo.MOVIMIENTOS,
  DEUDA_CLIENTE: Modulo.CLIENTES,
  CAJA_DIFERENCIA: null, // solo dueños
};

async function destinatariosDe(tipo: TipoNotificacion): Promise<Destinatario[]> {
  const usuarios = await prisma.usuario.findMany({
    where: { activo: true, deletedAt: null },
    select: { id: true, nombre: true, email: true, rol: true },
  });
  const modulo = MODULO_DE[tipo];
  const res: Destinatario[] = [];
  for (const u of usuarios) {
    if (u.rol === RolUsuario.OWNER) res.push(u);
    else if (modulo) {
      const s = await obtenerUsuarioSesion(u.id);
      if (s && puede(s, modulo, "ver")) res.push(u);
    }
  }
  return res;
}

/** Manda por todos los canales habilitados. Devuelve cuántas se crearon in-app. */
export async function notificar(n: NotificacionNueva): Promise<number> {
  const destinatarios = await destinatariosDe(n.tipo);
  let creadas = 0;
  for (const canal of CANALES) {
    if (!canal.habilitado) continue;
    try {
      const k = await canal.enviar(n, destinatarios);
      if (canal.nombre === "in-app") creadas = k;
    } catch (e) {
      // Un canal caído no frena a los demás ni a la operación que avisó.
      console.error(`[notificaciones] falló el canal ${canal.nombre}`, e);
    }
  }
  return creadas;
}

export async function contarNoLeidas(usuarioId: string): Promise<number> {
  return prisma.notificacion.count({ where: { usuarioId, leida: false } });
}

export async function listarNotificaciones(usuarioId: string, limite = 100) {
  const filas = await prisma.notificacion.findMany({
    where: { usuarioId },
    orderBy: { createdAt: "desc" },
    take: limite,
  });
  return filas.map((n) => ({
    id: n.id,
    tipo: n.tipo,
    titulo: n.titulo,
    mensaje: n.mensaje,
    leida: n.leida,
    fecha: n.createdAt,
    href:
      typeof (n.datos as Prisma.JsonObject | null)?.href === "string"
        ? ((n.datos as Prisma.JsonObject).href as string)
        : null,
  }));
}

export async function marcarLeida(id: string, usuarioId: string): Promise<void> {
  await prisma.notificacion.updateMany({ where: { id, usuarioId }, data: { leida: true } });
}

export async function marcarTodasLeidas(usuarioId: string): Promise<number> {
  return (
    await prisma.notificacion.updateMany({
      where: { usuarioId, leida: false },
      data: { leida: true },
    })
  ).count;
}

/** Aviso inmediato al cerrar una caja con diferencia fuera de tolerancia. */
export async function avisarCajaConDiferencia(cajaId: string): Promise<void> {
  const c = await prisma.caja.findUnique({
    where: { id: cajaId },
    include: { deposito: { select: { nombre: true } }, cerradaPor: { select: { nombre: true } } },
  });
  if (!c?.requiereRevision || !c.diferencia) return;
  await notificar({
    tipo: TipoNotificacion.CAJA_DIFERENCIA,
    titulo: `Caja de ${c.deposito.nombre} con diferencia`,
    mensaje: `${c.cerradaPor?.nombre ?? "Alguien"} cerró con ${formatearPesos(c.diferencia.toFixed(2))} de diferencia${c.observaciones ? `: «${c.observaciones}»` : "."}`,
    clave: `caja:${c.id}`,
    href: `/caja/${c.id}`,
  });
}

/**
 * Job diario (/api/cron/alertas): stock bajo / sin stock, cajas para revisar
 * de los últimos 7 días, transferencias pendientes hace más de 24 h y
 * deudas de más de 30 días. Guarda el resumen en Configuracion.ultimasAlertas.
 */
export async function generarAlertas() {
  const momento = ahora();
  const [stock, cajas, transferencias, deudas] = await Promise.all([
    alertasStock(),
    prisma.caja.findMany({
      where: {
        requiereRevision: true,
        cerradaAt: { gte: new Date(momento.getTime() - 7 * 86400_000) },
      },
      select: { id: true },
    }),
    prisma.transferencia.findMany({
      where: { estado: "PENDIENTE", fecha: { lt: new Date(momento.getTime() - 24 * 3600_000) } },
      include: {
        depositoOrigen: { select: { nombre: true } },
        depositoDestino: { select: { nombre: true } },
      },
    }),
    cuentasPorCobrar(),
  ]);
  let creadas = 0;
  const sinStock = stock.alertas.filter((a) => a.estado === "SIN_STOCK");
  const bajo = stock.alertas.filter((a) => a.estado === "BAJO_MINIMO");
  for (const a of sinStock) {
    creadas += await notificar({
      tipo: TipoNotificacion.SIN_STOCK,
      titulo: `Sin stock: ${a.nombre}`,
      mensaje:
        a.sugerencia > 0
          ? `Se venden ${a.promedioDiario}/día: reponer ${a.sugerencia} u. para ${stock.diasCobertura} días.`
          : `Mínimo ${a.stockMinimo} u.`,
      clave: `sin-stock:${a.varianteId}`,
      href: `/productos/${a.productoId}`,
    });
  }
  for (const a of bajo) {
    creadas += await notificar({
      tipo: TipoNotificacion.STOCK_BAJO,
      titulo: `Stock bajo: ${a.nombre}`,
      mensaje: `Quedan ${a.stockTotal} (mínimo ${a.stockMinimo})${a.sugerencia > 0 ? `. Sugerido reponer ${a.sugerencia} u.` : "."}`,
      clave: `stock-bajo:${a.varianteId}`,
      href: `/productos/${a.productoId}`,
    });
  }
  for (const c of cajas) {
    await avisarCajaConDiferencia(c.id);
  }
  for (const t of transferencias) {
    creadas += await notificar({
      tipo: TipoNotificacion.TRANSFERENCIA_PENDIENTE,
      titulo: `Transferencia #${t.numero} sin completar`,
      mensaje: `${t.depositoOrigen.nombre} → ${t.depositoDestino.nombre}, pendiente desde hace más de 24 h.`,
      clave: `transferencia:${t.id}`,
      href: `/movimientos/transferencias/${t.id}`,
    });
  }
  const morosos = deudas.clientes.filter((c) => Number(c.d31_60) + Number(c.d60) > 0);
  for (const c of morosos) {
    creadas += await notificar({
      tipo: TipoNotificacion.DEUDA_CLIENTE,
      titulo: `${c.nombre} debe hace más de 30 días`,
      mensaje: `Saldo ${formatearPesos(c.saldo)} (${formatearPesos((Number(c.d31_60) + Number(c.d60)).toFixed(2))} con más de 30 días).`,
      clave: `deuda:${c.clienteId}`,
      href: `/clientes/${c.clienteId}`,
    });
  }
  const resumen = {
    generadoEn: momento.toISOString(),
    sinStock: sinStock.length,
    stockBajo: bajo.length,
    sugerencias: stock.alertas.filter((a) => a.sugerencia > 0).length,
    cajasParaRevisar: cajas.length,
    transferenciasPendientes: transferencias.length,
    clientesMorosos: morosos.length,
    notificacionesCreadas: creadas,
  };
  await prisma.configuracion.upsert({
    where: { clave: "ultimasAlertas" },
    create: { clave: "ultimasAlertas", valor: resumen },
    update: { valor: resumen },
  });
  return resumen;
}
