import "server-only";

import { AccionAuditoria, MonedaCambio, Prisma, TipoCotizacionCambio } from "@prisma/client";
import { after } from "next/server";

import {
  convertirConCotizacion,
  formatearDual,
  FRECUENCIA_MINUTOS_MAX,
  FRECUENCIA_MINUTOS_MIN,
  MONEDAS_CAMBIO,
  type CotizacionVigente,
  type MonedaCambioClave,
  type TipoCotizacionCambioClave,
} from "@/lib/cambio";
import { prisma, withTransaction } from "@/lib/db";
import { ahora } from "@/lib/reloj";
import { FUENTES, resolverCotizacion, type IntentoFuente } from "@/server/cambio/fuentes";
import {
  CLAVE_FRECUENCIA,
  CLAVE_LEASE,
  claveOverride,
  elegirVigente,
  necesitaActualizar,
  parsearFrecuencia,
  parsearOverride,
  type OverrideCambio,
} from "@/server/cambio/vigente";
import { ValidationError } from "@/server/errors";
import { log } from "@/server/log";
import type { Actor } from "@/server/services/actor";
import { registrarAuditoria } from "@/server/services/audit.service";

/**
 * Cotizaciones de moneda GLOBALES (no por panel): dólar blue (precios
 * mayoristas) y USDT (proveedores). Se consultan SOLO desde el servidor:
 * - cron /api/cron/cambio (cada 15 min donde el plan lo permita), y
 * - actualización perezosa: una lectura con la cotización más vieja que
 *   "cambio.actualizacionMinutos" dispara la actualización en segundo plano,
 *   sin bloquear la respuesta (se devuelve la última válida).
 * Un override manual pisa al automático mientras esté cargado. Si todas las
 * fuentes fallan, queda la última cotización válida y la app sigue andando.
 */

const TIMEOUT_MS = 5_000;
/** Mínimo entre intentos perezosos (aunque el anterior haya fallado), por instancia y entre instancias. */
const ESPERA_ENTRE_INTENTOS_MS = 60_000;

// -----------------------------------------------------------------------------
// Lectura
// -----------------------------------------------------------------------------

async function leerGlobal(claves: string[]): Promise<Map<string, Prisma.JsonValue>> {
  const filas = await prisma.configuracionGlobal.findMany({ where: { clave: { in: claves } } });
  return new Map(filas.map((f) => [f.clave, f.valor]));
}

async function ultimaFila(moneda: MonedaCambioClave, tipo: TipoCotizacionCambioClave) {
  return prisma.tipoCambio.findFirst({
    where: { moneda: MonedaCambio[moneda], tipo: TipoCotizacionCambio[tipo] },
    orderBy: { obtenidoAt: "desc" },
    select: { valor: true, fuente: true, obtenidoAt: true },
  });
}

export async function frecuenciaMinutos(): Promise<number> {
  const m = await leerGlobal([CLAVE_FRECUENCIA]);
  return parsearFrecuencia(m.get(CLAVE_FRECUENCIA));
}

/**
 * Cotización vigente de una moneda: override manual o la última automática.
 * `null` solo si nunca se pudo obtener ninguna y no hay override. Si la
 * automática está vieja, dispara la actualización perezosa (no la espera).
 */
export async function obtenerCotizacion(
  moneda: MonedaCambioClave,
  tipo: TipoCotizacionCambioClave = "VENTA",
): Promise<CotizacionVigente | null> {
  const [config, ultima] = await Promise.all([
    leerGlobal([claveOverride(moneda), CLAVE_FRECUENCIA]),
    ultimaFila(moneda, tipo),
  ]);
  const t = ahora();
  if (
    necesitaActualizar(
      ultima?.obtenidoAt ?? null,
      parsearFrecuencia(config.get(CLAVE_FRECUENCIA)),
      t,
    )
  )
    actualizarEnSegundoPlano();
  return elegirVigente(
    moneda,
    tipo,
    parsearOverride(config.get(claveOverride(moneda))),
    ultima
      ? { valor: Number(ultima.valor), fuente: ultima.fuente, obtenidoAt: ultima.obtenidoAt }
      : null,
    t,
  );
}

export type CotizacionesVigentes = Record<MonedaCambioClave, CotizacionVigente | null>;

/** Las dos cotizaciones de VENTA (widget de la barra, cotizador, proveedores). */
export async function obtenerCotizaciones(): Promise<CotizacionesVigentes> {
  const [blue, usdt] = await Promise.all([
    obtenerCotizacion("USD_BLUE"),
    obtenerCotizacion("USDT"),
  ]);
  return { USD_BLUE: blue, USDT: usdt };
}

/** Versión que nunca lanza (barra superior: una base caída no puede romper el layout). */
export async function obtenerCotizacionesSeguro(): Promise<CotizacionesVigentes | null> {
  try {
    return await obtenerCotizaciones();
  } catch (e) {
    log.warn({ err: e }, "cambio: no se pudieron leer las cotizaciones");
    return null;
  }
}

/** Monto en la moneda → pesos enteros con la cotización de venta vigente (`null` sin cotización). */
export async function convertir(monto: number, moneda: MonedaCambioClave): Promise<number | null> {
  const c = await obtenerCotizacion(moneda);
  return c ? convertirConCotizacion(monto, c.valor) : null;
}

/** "U$D 1.200 · $ 1.560.000" con la cotización vigente. */
export async function formatearDualActual(
  monto: number,
  moneda: MonedaCambioClave,
): Promise<string> {
  return formatearDual(monto, moneda, (await obtenerCotizacion(moneda))?.valor);
}

export interface DetalleMoneda {
  moneda: MonedaCambioClave;
  venta: CotizacionVigente | null;
  compra: CotizacionVigente | null;
  /** Última automática (aunque haya override), para mostrarla al lado. */
  automatica: { valor: number; fuente: string; obtenidoAt: string } | null;
  override: OverrideCambio | null;
  historial: { valor: number; fuente: string; obtenidoAt: string }[];
}

/** Pantalla /configuracion/cambio. */
export async function detalleCotizaciones(): Promise<{
  frecuenciaMinutos: number;
  monedas: DetalleMoneda[];
}> {
  const [frecuencia, monedas] = await Promise.all([
    frecuenciaMinutos(),
    Promise.all(
      MONEDAS_CAMBIO.map(async (moneda): Promise<DetalleMoneda> => {
        const [venta, compra, override, historial] = await Promise.all([
          obtenerCotizacion(moneda, "VENTA"),
          obtenerCotizacion(moneda, "COMPRA"),
          leerGlobal([claveOverride(moneda)]).then((m) =>
            parsearOverride(m.get(claveOverride(moneda))),
          ),
          prisma.tipoCambio.findMany({
            where: { moneda: MonedaCambio[moneda], tipo: TipoCotizacionCambio.VENTA },
            orderBy: { obtenidoAt: "desc" },
            take: 8,
            select: { valor: true, fuente: true, obtenidoAt: true },
          }),
        ]);
        const h = historial.map((f) => ({
          valor: Number(f.valor),
          fuente: f.fuente,
          obtenidoAt: f.obtenidoAt.toISOString(),
        }));
        return { moneda, venta, compra, automatica: h[0] ?? null, override, historial: h };
      }),
    ),
  ]);
  return { frecuenciaMinutos: frecuencia, monedas };
}

// -----------------------------------------------------------------------------
// Actualización
// -----------------------------------------------------------------------------

export interface ResultadoMoneda {
  moneda: MonedaCambioClave;
  ok: boolean;
  fuente?: string;
  valor?: number;
  intentos: IntentoFuente[];
}

/** Descarga JSON con timeout y caché POR CORRIDA (criptoya/api/dolar sirve a las dos monedas). */
function descargadorConCache(): (url: string) => Promise<unknown> {
  const cache = new Map<string, Promise<unknown>>();
  return (url) => {
    let p = cache.get(url);
    if (!p) {
      p = (async () => {
        const res = await fetch(url, {
          signal: AbortSignal.timeout(TIMEOUT_MS),
          cache: "no-store",
          headers: { accept: "application/json" },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<unknown>;
      })();
      cache.set(url, p);
    }
    return p;
  };
}

/**
 * Consulta las fuentes públicas (en orden, con fallback) y guarda una fila por
 * punta obtenida. Nunca lanza por una API caída: devuelve qué pasó con cada moneda.
 */
export async function actualizarCotizaciones(): Promise<ResultadoMoneda[]> {
  const descargar = descargadorConCache();
  const obtenidoAt = ahora();
  const resultados: ResultadoMoneda[] = [];
  for (const moneda of MONEDAS_CAMBIO) {
    const anterior = await ultimaFila(moneda, "VENTA");
    const r = await resolverCotizacion(
      FUENTES[moneda],
      descargar,
      anterior ? Number(anterior.valor) : null,
    );
    for (const i of r.intentos)
      log.warn({ moneda, fuente: i.fuente, error: i.error }, "cambio: fuente descartada");
    if (!r.ok) {
      log.error(
        { moneda, intentos: r.intentos },
        "cambio: ninguna fuente respondió; queda vigente la última cotización válida",
      );
      resultados.push({ moneda, ok: false, intentos: r.intentos });
      continue;
    }
    const filas = (Object.entries(r.valores) as [TipoCotizacionCambioClave, number][]).map(
      ([tipo, valor]) => ({
        moneda: MonedaCambio[moneda],
        tipo: TipoCotizacionCambio[tipo],
        valor: new Prisma.Decimal(valor.toFixed(2)),
        fuente: r.fuente,
        obtenidoAt,
      }),
    );
    await prisma.tipoCambio.createMany({ data: filas });
    resultados.push({
      moneda,
      ok: true,
      fuente: r.fuente,
      valor: r.valores.VENTA,
      intentos: r.intentos,
    });
  }
  return resultados;
}

// --- Perezosa: no bloquea, no se superpone --------------------------------------

let enCurso: Promise<unknown> | null = null;
let ultimoIntentoLocal = 0;

/**
 * "Lease" entre instancias: la fila cambio.lease se actualiza solo si su
 * updatedAt es más viejo que la espera; quien la actualiza, corre.
 */
async function tomarLease(): Promise<boolean> {
  const t = ahora();
  await prisma.configuracionGlobal.createMany({
    data: [{ clave: CLAVE_LEASE, valor: t.toISOString(), updatedAt: new Date(0) }],
    skipDuplicates: true,
  });
  const r = await prisma.configuracionGlobal.updateMany({
    where: {
      clave: CLAVE_LEASE,
      updatedAt: { lt: new Date(t.getTime() - ESPERA_ENTRE_INTENTOS_MS) },
    },
    data: { valor: t.toISOString(), updatedAt: t },
  });
  return r.count === 1;
}

async function correrPerezosa(): Promise<void> {
  try {
    if (!(await tomarLease())) return;
    await actualizarCotizaciones();
  } catch (e) {
    log.error({ err: e }, "cambio: falló la actualización en segundo plano");
  }
}

/** Dispara la actualización sin esperarla (dentro de un request, vía after() para que termine). */
export function actualizarEnSegundoPlano(): void {
  const t = Date.now();
  if (enCurso || t - ultimoIntentoLocal < ESPERA_ENTRE_INTENTOS_MS) return;
  // E2E/CI: sin consultas externas (las cotizaciones las siembra el test).
  if (process.env.CAMBIO_SIN_RED === "1") return;
  ultimoIntentoLocal = t;
  const tarea = () => {
    enCurso = correrPerezosa().finally(() => {
      enCurso = null;
    });
    return enCurso;
  };
  try {
    // Dentro de un request: after() deja terminar la tarea después de responder.
    after(tarea);
  } catch {
    // Fuera de un request (scripts, cron sin contexto): corre suelta.
    void tarea();
  }
}

// -----------------------------------------------------------------------------
// Escrituras de dueños (con auditoría)
// -----------------------------------------------------------------------------

/** "Actualizar ahora": corre ya (sin lease) y espera el resultado. */
export async function actualizarAhora(actor: Actor): Promise<ResultadoMoneda[]> {
  const resultados = await actualizarCotizaciones();
  await withTransaction(async (tx) => {
    await registrarAuditoria(tx, {
      usuarioId: actor.id,
      accion: AccionAuditoria.UPDATE,
      entidad: "TipoCambio",
      entidadId: "actualizar",
      datosDespues: resultados.map((r) => ({
        moneda: r.moneda,
        ok: r.ok,
        fuente: r.fuente ?? null,
        valor: r.valor ?? null,
      })),
      meta: actor.meta,
    });
  });
  return resultados;
}

export async function guardarOverride(
  moneda: MonedaCambioClave,
  valor: number,
  actor: Actor,
): Promise<OverrideCambio> {
  if (!Number.isFinite(valor) || valor <= 0 || valor > 1e9)
    throw new ValidationError("Cotización inválida", { valor: ["Ingresá un valor mayor a 0"] });
  const usuario = await prisma.usuario.findUnique({
    where: { id: actor.id },
    select: { nombre: true },
  });
  const override: OverrideCambio = {
    valor: Math.round(valor * 100) / 100,
    usuarioId: actor.id,
    usuarioNombre: usuario?.nombre ?? null,
    cargadoAt: ahora().toISOString(),
  };
  const clave = claveOverride(moneda);
  await withTransaction(async (tx) => {
    const antes = await tx.configuracionGlobal.findUnique({ where: { clave } });
    const json = override as unknown as Prisma.InputJsonObject;
    await tx.configuracionGlobal.upsert({
      where: { clave },
      create: { clave, valor: json },
      update: { valor: json },
    });
    await registrarAuditoria(tx, {
      usuarioId: actor.id,
      accion: AccionAuditoria.UPDATE,
      entidad: "ConfiguracionGlobal",
      entidadId: clave,
      datosAntes: antes ? { [clave]: antes.valor as Prisma.InputJsonValue } : null,
      datosDespues: { [clave]: json },
      meta: actor.meta,
    });
  });
  return override;
}

export async function quitarOverride(moneda: MonedaCambioClave, actor: Actor): Promise<void> {
  const clave = claveOverride(moneda);
  await withTransaction(async (tx) => {
    const antes = await tx.configuracionGlobal.findUnique({ where: { clave } });
    if (!antes) return;
    await tx.configuracionGlobal.delete({ where: { clave } });
    await registrarAuditoria(tx, {
      usuarioId: actor.id,
      accion: AccionAuditoria.DELETE,
      entidad: "ConfiguracionGlobal",
      entidadId: clave,
      datosAntes: { [clave]: antes.valor as Prisma.InputJsonValue },
      meta: actor.meta,
    });
  });
}

export async function guardarFrecuencia(minutos: number, actor: Actor): Promise<number> {
  if (
    !Number.isInteger(minutos) ||
    minutos < FRECUENCIA_MINUTOS_MIN ||
    minutos > FRECUENCIA_MINUTOS_MAX
  )
    throw new ValidationError("Frecuencia inválida", {
      minutos: [`Entre ${FRECUENCIA_MINUTOS_MIN} y ${FRECUENCIA_MINUTOS_MAX} minutos`],
    });
  await withTransaction(async (tx) => {
    const antes = await tx.configuracionGlobal.findUnique({ where: { clave: CLAVE_FRECUENCIA } });
    await tx.configuracionGlobal.upsert({
      where: { clave: CLAVE_FRECUENCIA },
      create: { clave: CLAVE_FRECUENCIA, valor: minutos },
      update: { valor: minutos },
    });
    await registrarAuditoria(tx, {
      usuarioId: actor.id,
      accion: AccionAuditoria.UPDATE,
      entidad: "ConfiguracionGlobal",
      entidadId: CLAVE_FRECUENCIA,
      datosAntes: antes ? { [CLAVE_FRECUENCIA]: antes.valor as Prisma.InputJsonValue } : null,
      datosDespues: { [CLAVE_FRECUENCIA]: minutos },
      meta: actor.meta,
    });
  });
  return minutos;
}
