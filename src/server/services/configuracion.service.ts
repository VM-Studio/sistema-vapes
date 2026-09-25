import { AccionAuditoria, Prisma } from "@prisma/client";

import { prisma, withTransaction, type Tx } from "@/lib/db";
import {
  CLAVES_CONFIG_FINANZAS,
  configFinanzasSchema,
  type ConfigFinanzas,
} from "@/lib/validations/finanzas";
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

// =============================================================================
// Caja y reportes (claves sueltas: timezone, exigirCajaAbierta, toleranciaArqueo,
// diasCobertura, rotacion)
// =============================================================================

let cacheFinanzas: { valor: ConfigFinanzas; vence: number } | null = null;

/**
 * Se lee en cada venta (caja, ResumenDiario): 30 s de caché en memoria. Al
 * guardar se invalida; otra instancia lo ve como mucho 30 s después.
 */
export async function obtenerConfigFinanzas(tx: Tx = prisma): Promise<ConfigFinanzas> {
  if (cacheFinanzas && cacheFinanzas.vence > Date.now()) return cacheFinanzas.valor;
  const filas = await tx.configuracion.findMany({
    where: { clave: { in: [...CLAVES_CONFIG_FINANZAS] } },
  });
  const crudo = Object.fromEntries(filas.map((f) => [f.clave, f.valor]));
  const r = configFinanzasSchema.safeParse(crudo);
  const valor = r.success ? r.data : configFinanzasSchema.parse({});
  cacheFinanzas = { valor, vence: Date.now() + 30_000 };
  return valor;
}

export async function obtenerZonaHoraria(tx: Tx = prisma): Promise<string> {
  return (await obtenerConfigFinanzas(tx)).timezone;
}

export async function guardarConfigFinanzas(
  config: ConfigFinanzas,
  actor: Actor,
): Promise<ConfigFinanzas> {
  const guardado = await withTransaction(async (tx) => {
    const antes = await tx.configuracion.findMany({
      where: { clave: { in: [...CLAVES_CONFIG_FINANZAS] } },
    });
    for (const clave of CLAVES_CONFIG_FINANZAS) {
      const valor = config[clave] as Prisma.InputJsonValue;
      await tx.configuracion.upsert({
        where: { clave },
        create: { clave, valor },
        update: { valor },
      });
    }
    await registrarAuditoria(tx, {
      usuarioId: actor.id,
      accion: AccionAuditoria.UPDATE,
      entidad: "Configuracion",
      entidadId: "finanzas",
      datosAntes: Object.fromEntries(antes.map((f) => [f.clave, f.valor])),
      datosDespues: config,
      meta: actor.meta,
    });
    return config;
  });
  cacheFinanzas = null;
  return guardado;
}

/** Solo para tests / seed: fuerza a releer la configuración. */
export function invalidarCacheConfigFinanzas(): void {
  cacheFinanzas = null;
}
