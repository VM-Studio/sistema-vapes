import { AccionAuditoria } from "@prisma/client";

import { prisma, withTransaction, type Tx } from "@/lib/db";
import { configVentasSchema, type ConfigVentas } from "@/lib/validations/venta";
import {
  CONFIG_ESCANER_DEFAULT,
  parsearConfigEscaner,
  type ConfigEscaner,
} from "@/features/scanner/config";
import type { Actor } from "@/server/services/actor";
import { registrarAuditoria } from "@/server/services/audit.service";

/** Parámetros del escáner (clave "escaner"): sufijos, prefijo, intervalo, largo mínimo, sonidos. */
export async function obtenerConfigEscaner(): Promise<ConfigEscaner> {
  const fila = await prisma.configuracion.findUnique({ where: { clave: "escaner" } });
  return fila ? parsearConfigEscaner(fila.valor) : CONFIG_ESCANER_DEFAULT;
}

export async function guardarConfigEscaner(
  config: ConfigEscaner,
  actor: Actor,
): Promise<ConfigEscaner> {
  return withTransaction(async (tx) => {
    const antes = await tx.configuracion.findUnique({ where: { clave: "escaner" } });
    const valor = { ...config, sufijos: [...config.sufijos] };
    await tx.configuracion.upsert({
      where: { clave: "escaner" },
      create: { clave: "escaner", valor },
      update: { valor },
    });
    await registrarAuditoria(tx, {
      usuarioId: actor.id,
      accion: AccionAuditoria.UPDATE,
      entidad: "Configuracion",
      entidadId: "escaner",
      datosAntes: antes ? (antes.valor as object) : null,
      datosDespues: valor,
      meta: actor.meta,
    });
    return config;
  });
}

// =============================================================================
// Ventas y comprobante (clave "ventas")
// =============================================================================

/**
 * Datos del negocio para el comprobante, numeración y redondeo. Si todavía no
 * se guardó, arranca con los defaults (y el nombre del negocio del seed).
 */
export async function obtenerConfigVentas(tx: Tx = prisma): Promise<ConfigVentas> {
  const [fila, nombre] = await Promise.all([
    tx.configuracion.findUnique({ where: { clave: "ventas" } }),
    tx.configuracion.findUnique({ where: { clave: "nombreNegocio" } }),
  ]);
  const base = typeof nombre?.valor === "string" ? { nombreNegocio: nombre.valor } : {};
  const r = configVentasSchema.safeParse({ ...base, ...((fila?.valor as object | null) ?? {}) });
  return r.success ? r.data : configVentasSchema.parse(base);
}

export async function guardarConfigVentas(
  config: ConfigVentas,
  actor: Actor,
): Promise<ConfigVentas> {
  return withTransaction(async (tx) => {
    const antes = await tx.configuracion.findUnique({ where: { clave: "ventas" } });
    const valor = { ...config };
    await tx.configuracion.upsert({
      where: { clave: "ventas" },
      create: { clave: "ventas", valor },
      update: { valor },
    });
    // El nombre también es el del resto de la app (barra superior, etc.).
    await tx.configuracion.upsert({
      where: { clave: "nombreNegocio" },
      create: { clave: "nombreNegocio", valor: config.nombreNegocio },
      update: { valor: config.nombreNegocio },
    });
    await registrarAuditoria(tx, {
      usuarioId: actor.id,
      accion: AccionAuditoria.UPDATE,
      entidad: "Configuracion",
      entidadId: "ventas",
      datosAntes: antes ? (antes.valor as object) : null,
      datosDespues: valor,
      meta: actor.meta,
    });
    return config;
  });
}
