import ExcelJS from "exceljs";
import {
  EstadoCotizacion,
  EstadoPago,
  MedioPago,
  Modulo,
  Prisma,
  RolUsuario,
  TipoVenta,
} from "@prisma/client";
import { getDaysInMonth, getISODay, parseISO } from "date-fns";
import { z } from "zod";

import { TODOS_LOS_MEDIOS } from "@/lib/medios-pago";
import { MONTOS_CERO, type Montos } from "@/lib/moneda";
import { esOwner, type SujetoPermisos } from "@/lib/permisos";
import { ahora } from "@/lib/reloj";
import {
  ESTADO_PAGO_UI,
  ETIQUETA_MEDIO_PAGO,
  ETIQUETA_TIPO_VENTA,
  etiquetaMedioPrincipal,
  nombreConSabor,
} from "@/lib/ventas-ui";
import {
  diaEn,
  diasEntre,
  esDiaISO,
  horaEn,
  limitesRango,
  sumarDias,
  ZONA_DEFAULT,
  type DiaISO,
} from "@/lib/zona-horaria";
import { dbPara, type Ctx } from "@/server/db/panel-scoped";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import {
  SQL_USD_COSTO,
  SQL_USD_GANANCIA,
  SQL_USD_TOTAL,
  sumar,
  totalDeVenta,
} from "@/server/moneda/montos-venta";
import { obtenerConfigVentas } from "@/server/services/configuracion.service";
import { puedeFiados } from "@/server/services/fiado.service";
import { comisionesVendedores } from "@/server/services/ganancia-vendedor.service";

/**
 * ANALÍTICA del panel (dashboard, rendimiento del equipo, reportes).
 *
 * Todo se agrega en PostgreSQL (`$queryRaw` con `"panelId" = ctx.panelId`
 * explícito y el resultado validado con Zod): acá nunca se traen ventas
 * completas a memoria para sumarlas. Los días se cortan en la zona del
 * negocio (America/Argentina/Buenos_Aires) y la semana va de lunes a domingo.
 *
 * MONEDA: los montos salen en USDT (principal), pesos y dólares (`Montos`, ver
 * src/lib/moneda.ts). Cada venta suma lo suyo a SU cotización congelada
 * (`totalUsdt`, `gananciaUsdt`…; dólares = pesos ÷ su dólar blue): nunca se
 * divide una suma en pesos por la cotización de hoy. Los montos en pesos
 * atados a una venta (pagos, saldos, diferencias de devoluciones) se
 * convierten fila por fila con la cotización de su venta.
 *
 * Costos, ganancias y el rendimiento de otros usuarios: SOLO dueños. Las
 * funciones que son enteramente de dueño lanzan ForbiddenError; las mixtas
 * devuelven `null` en los campos de costo.
 */

const TZ = ZONA_DEFAULT;

// =============================================================================
// Períodos (puro)
// =============================================================================

export type ModoPeriodo = "DIARIO" | "SEMANAL" | "MENSUAL" | "PERSONALIZADO";

/**
 * `desde` / `hasta`: DÍAS calendario del negocio, ambos incluidos, como
 * `Date` a las 00:00 UTC de ese día (ej. 2026-09-01T00:00:00Z = "1 de
 * septiembre"). Así el cálculo de períodos es puro y no depende de la zona.
 */
export interface Periodo {
  modo: ModoPeriodo;
  desde: Date;
  hasta: Date;
}

export type PresetPeriodo = "7d" | "30d" | "trimestre" | "anio";

export const PRESETS_PERIODO: readonly { valor: PresetPeriodo; label: string }[] = [
  { valor: "7d", label: "Últimos 7 días" },
  { valor: "30d", label: "Últimos 30 días" },
  { valor: "trimestre", label: "Este trimestre" },
  { valor: "anio", label: "Este año" },
];

/** Máximo de días de un período personalizado (la serie es por día). */
const MAX_DIAS = 400;

export const diaDe = (d: Date): DiaISO => d.toISOString().slice(0, 10);
export const fechaDeDia = (dia: DiaISO): Date => new Date(`${dia}T00:00:00.000Z`);

const MODO_DE_PARAM: Record<string, ModoPeriodo> = {
  diario: "DIARIO",
  semanal: "SEMANAL",
  mensual: "MENSUAL",
  periodo: "PERSONALIZADO",
};
export const PARAM_DE_MODO: Record<ModoPeriodo, string> = {
  DIARIO: "diario",
  SEMANAL: "semanal",
  MENSUAL: "mensual",
  PERSONALIZADO: "periodo",
};

/** Lunes de la semana de `dia`. */
export function lunesDe(dia: DiaISO): DiaISO {
  return sumarDias(dia, 1 - getISODay(parseISO(dia)));
}

/** Rango [desde, hasta] de un preset del modo "Período" (hasta = hoy). */
export function rangoPreset(preset: PresetPeriodo, hoy: DiaISO): { desde: DiaISO; hasta: DiaISO } {
  switch (preset) {
    case "7d":
      return { desde: sumarDias(hoy, -6), hasta: hoy };
    case "30d":
      return { desde: sumarDias(hoy, -29), hasta: hoy };
    case "trimestre": {
      const mes = Number(hoy.slice(5, 7));
      const inicio = String(Math.floor((mes - 1) / 3) * 3 + 1).padStart(2, "0");
      return { desde: `${hoy.slice(0, 4)}-${inicio}-01`, hasta: hoy };
    }
    case "anio":
      return { desde: `${hoy.slice(0, 4)}-01-01`, hasta: hoy };
  }
}

type Params = Record<string, string | string[] | undefined>;
const param = (p: Params, k: string) => (typeof p[k] === "string" ? p[k] : undefined);

/**
 * Período desde la URL: `?modo=diario|semanal|mensual|periodo` y, para
 * "periodo", `desde`/`hasta` (YYYY-MM-DD) o `preset=7d|30d|trimestre|anio`.
 * Por defecto: Diario.
 */
export function periodoDesdeParams(params: Params, instante: Date = ahora()): Periodo {
  const hoy = diaEn(instante, TZ);
  const modo = MODO_DE_PARAM[param(params, "modo") ?? ""] ?? "DIARIO";
  const p = (desde: DiaISO, hasta: DiaISO): Periodo => ({
    modo,
    desde: fechaDeDia(desde),
    hasta: fechaDeDia(hasta),
  });
  switch (modo) {
    case "DIARIO":
      return p(hoy, hoy);
    case "SEMANAL":
      return p(lunesDe(hoy), hoy);
    case "MENSUAL":
      return p(`${hoy.slice(0, 8)}01`, hoy);
    case "PERSONALIZADO": {
      const preset = param(params, "preset");
      if (preset && PRESETS_PERIODO.some((x) => x.valor === preset)) {
        const r = rangoPreset(preset as PresetPeriodo, hoy);
        return p(r.desde, r.hasta);
      }
      const d = param(params, "desde");
      const h = param(params, "hasta");
      let desde = esDiaISO(d) ? d : sumarDias(hoy, -6);
      let hasta = esDiaISO(h) ? h : hoy;
      if (desde > hasta) [desde, hasta] = [hasta, desde];
      if (diasEntre(desde, hasta) > MAX_DIAS) desde = sumarDias(hasta, -(MAX_DIAS - 1));
      return p(desde, hasta);
    }
  }
}

/** "?modo=semanal" / "?modo=periodo&desde=…&hasta=…": solo los parámetros del período (para links). */
export function queryPeriodo(params: Params): string {
  const sp = new URLSearchParams();
  for (const k of ["modo", "desde", "hasta", "preset"]) {
    const v = param(params, k);
    if (v) sp.set(k, v);
  }
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

/**
 * El período contra el que se compara (puro):
 * DIARIO → ayer; SEMANAL → la semana anterior COMPLETA (lunes a domingo);
 * MENSUAL → el mes anterior COMPLETO; PERSONALIZADO → el rango
 * inmediatamente anterior de igual duración (1–15 sep → 17–31 ago).
 */
export function periodoAnterior(p: Periodo): Periodo {
  const desde = diaDe(p.desde);
  const hasta = diaDe(p.hasta);
  const r = (d: DiaISO, h: DiaISO): Periodo => ({
    modo: p.modo,
    desde: fechaDeDia(d),
    hasta: fechaDeDia(h),
  });
  switch (p.modo) {
    case "DIARIO":
      return r(sumarDias(desde, -1), sumarDias(desde, -1));
    case "SEMANAL": {
      const lunes = lunesDe(desde);
      return r(sumarDias(lunes, -7), sumarDias(lunes, -1));
    }
    case "MENSUAL": {
      const fin = sumarDias(`${desde.slice(0, 8)}01`, -1);
      return r(`${fin.slice(0, 8)}01`, fin);
    }
    case "PERSONALIZADO": {
      const n = diasEntre(desde, hasta);
      return r(sumarDias(desde, -n), sumarDias(desde, -1));
    }
  }
}

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const diaCorto = (dia: DiaISO) =>
  `${Number(dia.slice(8, 10))} ${MESES[Number(dia.slice(5, 7)) - 1]}`;

/** "1 sep – 15 sep 2026" (o "28 sep 2026" si es un solo día). */
export function etiquetaRango(p: Pick<Periodo, "desde" | "hasta">): string {
  const d = diaDe(p.desde);
  const h = diaDe(p.hasta);
  if (d === h) return `${diaCorto(d)} ${d.slice(0, 4)}`;
  const anio = d.slice(0, 4) === h.slice(0, 4) ? "" : ` ${d.slice(0, 4)}`;
  return `${diaCorto(d)}${anio} – ${diaCorto(h)} ${h.slice(0, 4)}`;
}

/** Textos del período para la UI. */
export function describirPeriodo(p: Periodo): {
  etiqueta: string;
  comparacion: string;
  tituloGrafico: string;
} {
  switch (p.modo) {
    case "DIARIO":
      return { etiqueta: "Hoy", comparacion: "vs. ayer", tituloGrafico: "Hoy vs. ayer" };
    case "SEMANAL":
      return {
        etiqueta: "Esta semana",
        comparacion: "vs. semana pasada",
        tituloGrafico: "Esta semana vs. la anterior",
      };
    case "MENSUAL":
      return {
        etiqueta: "Este mes",
        comparacion: "vs. mes pasado",
        tituloGrafico: "Este mes vs. el anterior",
      };
    case "PERSONALIZADO":
      return {
        etiqueta: etiquetaRango(p),
        comparacion: `vs. ${etiquetaRango(periodoAnterior(p))}`,
        tituloGrafico: "Este período vs. el anterior",
      };
  }
}

// =============================================================================
// Serie comparativa: alineación (puro)
// =============================================================================

export interface PuntoSerie {
  etiqueta: string;
  /** null = punto futuro del período actual (o fuera de él). */
  actual: number | null;
  /** null = el período anterior no tiene ese punto (mes más corto). */
  anterior: number | null;
  /** Día (o día y hora) de cada punto, para el tooltip. */
  fechaActual: string | null;
  fechaAnterior: string | null;
}

export interface FilaSerie {
  actual: boolean;
  /** Hora 0–23 (DIARIO) o días desde el inicio del período (resto). */
  idx: number;
  total: number;
}

const DIAS_SEMANA = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const ddmm = (dia: DiaISO) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
const diasDelMes = (dia: DiaISO) => getDaysInMonth(parseISO(dia));

/**
 * Arma los puntos de la serie (puro): eje por hora (DIARIO), Lun…Dom
 * (SEMANAL), 1…31 (MENSUAL) o Día 1…N (PERSONALIZADO). Actual y anterior
 * quedan alineados por posición; lo que en el actual todavía no pasó es null.
 */
export function armarSerie(
  p: Periodo,
  filas: readonly FilaSerie[],
  ahoraNegocio: { hoy: DiaISO; hora: number },
): PuntoSerie[] {
  const ant = periodoAnterior(p);
  const dA = diaDe(p.desde);
  const hA = diaDe(p.hasta);
  const dB = diaDe(ant.desde);
  const valor = (actual: boolean, idx: number) =>
    filas.filter((f) => f.actual === actual && f.idx === idx).reduce((a, f) => a + f.total, 0);

  if (p.modo === "DIARIO") {
    return Array.from({ length: 24 }, (_, h) => {
      const futuro = dA > ahoraNegocio.hoy || (dA === ahoraNegocio.hoy && h > ahoraNegocio.hora);
      const hh = String(h).padStart(2, "0");
      return {
        etiqueta: `${hh} h`,
        actual: futuro ? null : valor(true, h),
        anterior: valor(false, h),
        fechaActual: `${ddmm(dA)} ${hh}:00`,
        fechaAnterior: `${ddmm(dB)} ${hh}:00`,
      };
    });
  }

  const largoAnterior = diasEntre(dB, diaDe(ant.hasta));
  const largoNatural =
    p.modo === "SEMANAL" ? 7 : p.modo === "MENSUAL" ? diasDelMes(dA) : diasEntre(dA, hA);
  const n =
    p.modo === "SEMANAL"
      ? 7
      : p.modo === "MENSUAL"
        ? Math.max(largoNatural, largoAnterior)
        : largoNatural;

  return Array.from({ length: n }, (_, i) => {
    const fA = sumarDias(dA, i);
    const fB = sumarDias(dB, i);
    const actualFuera = i >= largoNatural || fA > hA || fA > ahoraNegocio.hoy;
    const anteriorFuera = i >= largoAnterior;
    return {
      etiqueta:
        p.modo === "SEMANAL"
          ? DIAS_SEMANA[i]!
          : p.modo === "MENSUAL"
            ? String(i + 1)
            : `Día ${i + 1}`,
      actual: actualFuera ? null : valor(true, i),
      anterior: anteriorFuera ? null : valor(false, i),
      fechaActual: i >= largoNatural ? null : ddmm(fA),
      fechaAnterior: anteriorFuera ? null : ddmm(fB),
    };
  });
}

// =============================================================================
// Infraestructura de consultas
// =============================================================================

interface Instantes {
  inicio: Date;
  fin: Date;
}

/** Instantes UTC [inicio, fin) de un período. */
export function instantesDe(p: Pick<Periodo, "desde" | "hasta">): Instantes {
  return limitesRango(diaDe(p.desde), diaDe(p.hasta), TZ);
}

/** Actual y anterior: el anterior termina donde empieza el actual (contiguos). */
function rangos(p: Periodo) {
  const ant = periodoAnterior(p);
  return { a: instantesDe(p), b: instantesDe(ant), anterior: ant };
}

async function consultar<T extends z.ZodType>(
  ctx: Ctx,
  schema: T,
  sql: Prisma.Sql,
): Promise<z.output<T>[]> {
  const filas = await dbPara(ctx.panelId).$queryRaw<unknown[]>(sql);
  return z.array(schema).parse(filas);
}

/**
 * Instante como `timestamp` UTC para comparar con las columnas de fecha
 * (timestamp sin zona, guardadas en UTC). Se pasa como texto ISO: un `Date`
 * llegaría como timestamptz y Postgres lo compararía en la zona de la sesión.
 */
const ts = (d: Date) => Prisma.sql`(${d.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;

const montoTexto = z.string().regex(/^-?\d+(\.\d+)?$/);
const D = (v: string | number) => new Prisma.Decimal(v);
const aMonto = (v: Prisma.Decimal | string | number) => D(v.toString()).toFixed(2);

// --- Montos en las tres monedas (USDT principal, pesos y dólares) -------------

/** Expresiones SQL de un monto en cada moneda (por fila). */
interface ExprMontos {
  usdt: Prisma.Sql;
  pesos: Prisma.Sql;
  usd: Prisma.Sql;
}

/** Montos de la venta `v`, cada uno a la cotización de esa venta. */
const DE_VENTA = {
  total: { usdt: Prisma.sql`v."totalUsdt"`, pesos: Prisma.sql`v."total"`, usd: SQL_USD_TOTAL },
  ganancia: {
    usdt: Prisma.sql`v."gananciaUsdt"`,
    pesos: Prisma.sql`v."gananciaBruta"`,
    usd: SQL_USD_GANANCIA,
  },
  costo: {
    usdt: Prisma.sql`v."costoTotalUsdt"`,
    pesos: Prisma.sql`v."costoTotal"`,
    usd: SQL_USD_COSTO,
  },
} satisfies Record<string, ExprMontos>;

/**
 * Un monto en PESOS de una fila convertido con las cotizaciones de esa fila
 * (pesos por USDT / por dólar), a centavos: lo mismo que se hace por venta.
 */
const convertido = (pesos: Prisma.Sql, tcUsdt: Prisma.Sql, tcUsd: Prisma.Sql): ExprMontos => ({
  usdt: Prisma.sql`ROUND(${pesos} / ${tcUsdt}, 2)`,
  pesos,
  usd: Prisma.sql`ROUND(${pesos} / ${tcUsd}, 2)`,
});

/** `COALESCE(SUM(x), 0)::text AS "{nombre}Usdt"`, idem Pesos y Usd. */
function sumaMontos(e: ExprMontos, nombre: string): Prisma.Sql {
  const col = (m: string) => Prisma.raw(`"${nombre}${m}"`);
  return Prisma.sql`COALESCE(SUM(${e.usdt}), 0)::text AS ${col("Usdt")},
    COALESCE(SUM(${e.pesos}), 0)::text AS ${col("Pesos")},
    COALESCE(SUM(${e.usd}), 0)::text AS ${col("Usd")}`;
}

type ClavesMontos<N extends string> = `${N}Usdt` | `${N}Pesos` | `${N}Usd`;

/** Campos Zod de las tres columnas de `sumaMontos(…, nombre)`. */
function camposMontos<N extends string>(nombre: N) {
  return {
    [`${nombre}Usdt`]: montoTexto,
    [`${nombre}Pesos`]: montoTexto,
    [`${nombre}Usd`]: montoTexto,
  } as Record<ClavesMontos<N>, typeof montoTexto>;
}

function leerMontos<N extends string>(f: Record<ClavesMontos<N>, string>, nombre: N): Montos {
  return {
    usdt: aMonto(f[`${nombre}Usdt`]),
    pesos: aMonto(f[`${nombre}Pesos`]),
    usd: aMonto(f[`${nombre}Usd`]),
  };
}

/**
 * Cotización (pesos por unidad, punta venta) vigente en `fecha`: la última
 * obtenida hasta ese momento o, si no había ninguna, la primera posterior.
 * Solo para filas sin venta propia (compras viejas sin snapshot).
 */
function cotizacionEn(moneda: "USDT" | "USD_BLUE", fecha: Prisma.Sql): Prisma.Sql {
  const m = Prisma.raw(`'${moneda}'`);
  return Prisma.sql`COALESCE(
    (SELECT tc."valor" FROM "TipoCambio" tc
      WHERE tc."moneda" = ${m} AND tc."tipo" = 'VENTA' AND tc."obtenidoAt" <= ${fecha}
      ORDER BY tc."obtenidoAt" DESC, tc."id" DESC LIMIT 1),
    (SELECT tc."valor" FROM "TipoCambio" tc
      WHERE tc."moneda" = ${m} AND tc."tipo" = 'VENTA'
      ORDER BY tc."obtenidoAt" ASC, tc."id" ASC LIMIT 1))`;
}

const mapMontos = (m: Montos, f: (v: Prisma.Decimal) => Prisma.Decimal): Montos => ({
  usdt: f(D(m.usdt)).toFixed(2),
  pesos: f(D(m.pesos)).toFixed(2),
  usd: f(D(m.usd)).toFixed(2),
});

const restarMontos = (a: Montos, b: Montos): Montos => ({
  usdt: D(a.usdt).minus(b.usdt).toFixed(2),
  pesos: D(a.pesos).minus(b.pesos).toFixed(2),
  usd: D(a.usd).minus(b.usd).toFixed(2),
});

/** Ticket promedio: cada moneda ÷ cantidad de ventas. */
const ticket = (total: Montos, cantidad: number): Montos =>
  cantidad === 0 ? MONTOS_CERO : mapMontos(total, (v) => v.div(cantidad));

/** ¿Es dueño quien llama? (CtxPanel trae el usuario; si no, se consulta.) */
async function esOwnerCtx(ctx: Ctx & { usuario?: Pick<SujetoPermisos, "rol"> }): Promise<boolean> {
  if (ctx.usuario) return esOwner(ctx.usuario);
  const u = await dbPara(ctx.panelId).usuario.findUnique({
    where: { id: ctx.usuarioId },
    select: { rol: true },
  });
  return u?.rol === RolUsuario.OWNER;
}

async function exigirOwner(ctx: Ctx, que: string): Promise<void> {
  if (!(await esOwnerCtx(ctx))) throw new ForbiddenError(`${que} es solo para dueños.`);
}

export interface Comparado<T extends string | number> {
  actual: T;
  anterior: T;
  delta: T;
  /** Variación porcentual; null si el anterior es 0. */
  deltaPct: number | null;
}

/** Un monto comparado en las tres monedas; `deltaPct` sale de los USDT. */
export interface ComparadoMontos {
  actual: Montos;
  anterior: Montos;
  delta: Montos;
  /** Variación porcentual en USDT; null si el anterior es 0. */
  deltaPct: number | null;
}

const pct = (a: number, b: number): number | null =>
  b === 0 ? null : Math.round(((a - b) / Math.abs(b)) * 1000) / 10;

export function compararNumero(actual: number, anterior: number): Comparado<number> {
  return { actual, anterior, delta: actual - anterior, deltaPct: pct(actual, anterior) };
}

export function compararMonto(actual: string, anterior: string): Comparado<string> {
  return {
    actual: aMonto(actual),
    anterior: aMonto(anterior),
    delta: D(actual).minus(D(anterior)).toFixed(2),
    deltaPct: pct(Number(actual), Number(anterior)),
  };
}

export function compararMontos(actual: Montos, anterior: Montos): ComparadoMontos {
  return {
    actual,
    anterior,
    delta: restarMontos(actual, anterior),
    deltaPct: pct(Number(actual.usdt), Number(anterior.usdt)),
  };
}

// =============================================================================
// KPIs
// =============================================================================

export interface KpisPeriodo {
  periodo: Periodo;
  anterior: Periodo;
  /** Σ total de las ventas (lo vendido, incluye lo fiado). */
  facturado: ComparadoMontos;
  /**
   * Σ pagos no anulados con fecha en el período (al vender y cobros de
   * fiados), cada uno a la cotización de su venta. Solo dueños o FIADOS
   * "ver" (null para el resto).
   */
  cobrado: ComparadoMontos | null;
  /**
   * Deuda total actual (Σ saldo pendiente de las ventas confirmadas, cada uno
   * a la cotización de su venta; no depende del período). Idem `cobrado`.
   */
  porCobrar: Montos | null;
  cantidadVentas: Comparado<number>;
  unidadesVendidas: Comparado<number>;
  /**
   * Ganancia TOTAL (bruta): lo vendido − lo que costó la mercadería. Incluye
   * lo que se lleva el vendedor por vape (Trinidad). Solo dueños.
   */
  ganancia: ComparadoMontos | null;
  /** Lo que se llevan los vendedores por vape en el período (Trinidad). Solo dueños. */
  comisiones: ComparadoMontos | null;
  /** Quiénes cobran esa comisión en el período actual ("Trinidad"). */
  comisionDe: string[];
  /** Ganancia NETA de los dueños = ganancia − comisiones. Solo dueños. */
  gananciaNeta: ComparadoMontos | null;
  /** Ganancia / facturado del período actual (en USDT), en %. Solo dueños. */
  margenPct: number | null;
  clientesNuevos: Comparado<number>;
  ticketPromedio: ComparadoMontos;
  /** Devoluciones por garantía REGISTRADAS (no anuladas). */
  devoluciones: Comparado<number>;
}

const filaVentasSchema = z.object({
  actual: z.boolean(),
  cantidad: z.number().int(),
  ...camposMontos("facturado"),
  ...camposMontos("ganancia"),
  ...camposMontos("costo"),
});

interface VentasDeRango {
  cantidad: number;
  facturado: Montos;
  ganancia: Montos;
  costo: Montos;
}

async function ventasActualAnterior(
  ctx: Ctx,
  p: Periodo,
): Promise<{ actual: VentasDeRango; anterior: VentasDeRango }> {
  const { a, b } = rangos(p);
  const filas = await consultar(
    ctx,
    filaVentasSchema,
    Prisma.sql`
      SELECT (v."fecha" >= ${ts(a.inicio)}) AS "actual",
             COUNT(*)::int AS "cantidad",
             ${sumaMontos(DE_VENTA.total, "facturado")},
             ${sumaMontos(DE_VENTA.ganancia, "ganancia")},
             ${sumaMontos(DE_VENTA.costo, "costo")}
      FROM "Venta" v
      WHERE v."panelId" = ${ctx.panelId}
        AND v."estado" = 'CONFIRMADA'
        AND v."fecha" >= ${ts(b.inicio)} AND v."fecha" < ${ts(a.fin)}
      GROUP BY 1`,
  );
  const de = (f: z.output<typeof filaVentasSchema> | undefined): VentasDeRango =>
    f
      ? {
          cantidad: f.cantidad,
          facturado: leerMontos(f, "facturado"),
          ganancia: leerMontos(f, "ganancia"),
          costo: leerMontos(f, "costo"),
        }
      : { cantidad: 0, facturado: MONTOS_CERO, ganancia: MONTOS_CERO, costo: MONTOS_CERO };
  return {
    actual: de(filas.find((f) => f.actual)),
    anterior: de(filas.find((f) => !f.actual)),
  };
}

/**
 * Movimientos de plata del panel: los pagos de ventas (no anulados), los
 * cobros de fiados anteriores al sistema y las
 * diferencias de precio de las devoluciones con cambio (registradas): > 0 la
 * pagó el cliente, < 0 se le devolvió. Columnas: fecha, monto (pesos),
 * medioPago y las cotizaciones de su venta ("tcUsdt", "tcUsd") para pasarlo
 * a USDT y a dólares fila por fila (una devolución sin venta: las de su fecha).
 */
function movimientosDePlata(ctx: Ctx) {
  return Prisma.sql`(
    SELECT pv."fecha", pv."monto", pv."medioPago",
           v."tipoCambioUsdt" AS "tcUsdt", v."tipoCambioUsd" AS "tcUsd"
    FROM "PagoVenta" pv
    JOIN "Venta" v ON v."id" = pv."ventaId"
    WHERE pv."panelId" = ${ctx.panelId} AND NOT pv."anulado"
    UNION ALL
    -- Cobros de fiados anteriores al sistema (deudas viejas cargadas a mano).
    SELECT pf."fecha", pf."monto", pf."medioPago",
           f."tipoCambioUsdt" AS "tcUsdt", f."tipoCambioUsd" AS "tcUsd"
    FROM "PagoFiadoAnterior" pf
    JOIN "FiadoAnterior" f ON f."id" = pf."fiadoId"
    WHERE pf."panelId" = ${ctx.panelId} AND NOT pf."anulado"
    UNION ALL
    SELECT d."fecha", d."diferencia", d."medioPagoDiferencia",
           COALESCE(v."tipoCambioUsdt", ${cotizacionEn("USDT", Prisma.sql`d."fecha"`)}),
           COALESCE(v."tipoCambioUsd", ${cotizacionEn("USD_BLUE", Prisma.sql`d."fecha"`)})
    FROM "Devolucion" d
    LEFT JOIN "Venta" v ON v."id" = d."ventaId"
    WHERE d."panelId" = ${ctx.panelId} AND d."estado" = 'REGISTRADA' AND d."diferencia" <> 0
  )`;
}

/** Monto de un movimiento de `movimientosDePlata` (alias `pv`) en las tres monedas. */
const MONTO_MOVIMIENTO = convertido(
  Prisma.sql`pv."monto"`,
  Prisma.sql`pv."tcUsdt"`,
  Prisma.sql`pv."tcUsd"`,
);

/** Cobrado del período actual y del anterior (con las diferencias de devoluciones), y la deuda de hoy. */
async function cobranzas(ctx: Ctx, p: Periodo) {
  const { a, b } = rangos(p);
  const filaCobrado = z.object({ actual: z.boolean(), ...camposMontos("total") });
  const [cobrado, [deuda]] = await Promise.all([
    consultar(
      ctx,
      filaCobrado,
      Prisma.sql`
        SELECT (pv."fecha" >= ${ts(a.inicio)}) AS "actual", ${sumaMontos(MONTO_MOVIMIENTO, "total")}
        FROM ${movimientosDePlata(ctx)} pv
        WHERE pv."fecha" >= ${ts(b.inicio)} AND pv."fecha" < ${ts(a.fin)}
        GROUP BY 1`,
    ),
    // La deuda: el saldo de cada venta confirmada a la cotización de esa venta.
    consultar(
      ctx,
      z.object(camposMontos("total")),
      Prisma.sql`
        SELECT ${sumaMontos(
          convertido(
            Prisma.sql`v."saldoPendiente"`,
            Prisma.sql`v."tipoCambioUsdt"`,
            Prisma.sql`v."tipoCambioUsd"`,
          ),
          "total",
        )}
        FROM (
          SELECT "saldoPendiente", "tipoCambioUsdt", "tipoCambioUsd" FROM "Venta"
          WHERE "panelId" = ${ctx.panelId} AND "estado" = 'CONFIRMADA' AND "saldoPendiente" > 0
          UNION ALL
          -- Fiados anteriores al sistema (deudas viejas cargadas a mano).
          SELECT "saldoPendiente", "tipoCambioUsdt", "tipoCambioUsd" FROM "FiadoAnterior"
          WHERE "panelId" = ${ctx.panelId} AND "estado" = 'VIGENTE' AND "saldoPendiente" > 0
        ) v`,
    ),
  ]);
  const de = (f: z.output<typeof filaCobrado> | undefined) =>
    f ? leerMontos(f, "total") : MONTOS_CERO;
  return {
    cobrado: compararMontos(de(cobrado.find((f) => f.actual)), de(cobrado.find((f) => !f.actual))),
    porCobrar: deuda ? leerMontos(deuda, "total") : MONTOS_CERO,
  };
}

export async function kpis(ctx: Ctx, p: Periodo): Promise<KpisPeriodo> {
  const { a, b, anterior } = rangos(p);
  const [owner, verCobranzas, ventas, unidades, [otros]] = await Promise.all([
    esOwnerCtx(ctx),
    // Lo cobrado y la deuda de los clientes: dueños o FIADOS "ver".
    puedeFiados(ctx, "ver"),
    ventasActualAnterior(ctx, p),
    consultar(
      ctx,
      z.object({ actual: z.boolean(), unidades: z.number().int() }),
      Prisma.sql`
        SELECT (v."fecha" >= ${ts(a.inicio)}) AS "actual", COALESCE(SUM(vi."cantidad"), 0)::int AS "unidades"
        FROM "Venta" v
        JOIN "VentaItem" vi ON vi."ventaId" = v."id"
        WHERE v."panelId" = ${ctx.panelId} AND vi."panelId" = ${ctx.panelId}
          AND v."estado" = 'CONFIRMADA'
          AND v."fecha" >= ${ts(b.inicio)} AND v."fecha" < ${ts(a.fin)}
        GROUP BY 1`,
    ),
    consultar(
      ctx,
      z.object({
        clientesA: z.number().int(),
        clientesB: z.number().int(),
        devolucionesA: z.number().int(),
        devolucionesB: z.number().int(),
      }),
      Prisma.sql`
        SELECT
          (SELECT COUNT(*) FILTER (WHERE c."createdAt" >= ${ts(a.inicio)})::int FROM "Cliente" c
            WHERE c."panelId" = ${ctx.panelId} AND c."createdAt" >= ${ts(b.inicio)} AND c."createdAt" < ${ts(a.fin)}) AS "clientesA",
          (SELECT COUNT(*) FILTER (WHERE c."createdAt" < ${ts(a.inicio)})::int FROM "Cliente" c
            WHERE c."panelId" = ${ctx.panelId} AND c."createdAt" >= ${ts(b.inicio)} AND c."createdAt" < ${ts(a.fin)}) AS "clientesB",
          (SELECT COUNT(*) FILTER (WHERE d."fecha" >= ${ts(a.inicio)})::int FROM "Devolucion" d
            WHERE d."panelId" = ${ctx.panelId} AND d."estado" = 'REGISTRADA'
              AND d."fecha" >= ${ts(b.inicio)} AND d."fecha" < ${ts(a.fin)}) AS "devolucionesA",
          (SELECT COUNT(*) FILTER (WHERE d."fecha" < ${ts(a.inicio)})::int FROM "Devolucion" d
            WHERE d."panelId" = ${ctx.panelId} AND d."estado" = 'REGISTRADA'
              AND d."fecha" >= ${ts(b.inicio)} AND d."fecha" < ${ts(a.fin)}) AS "devolucionesB"`,
    ),
  ]);
  const va = ventas.actual;
  const vb = ventas.anterior;
  const cobros = verCobranzas ? await cobranzas(ctx, p) : null;
  const [comA, comB] = owner
    ? await Promise.all([
        comisionesVendedores(
          { ...ctx, usuario: { rol: "OWNER" } },
          { inicio: a.inicio, fin: a.fin },
        ),
        comisionesVendedores(
          { ...ctx, usuario: { rol: "OWNER" } },
          { inicio: b.inicio, fin: b.fin },
        ),
      ])
    : [null, null];
  return {
    periodo: p,
    anterior,
    facturado: compararMontos(va.facturado, vb.facturado),
    cobrado: cobros?.cobrado ?? null,
    porCobrar: cobros?.porCobrar ?? null,
    cantidadVentas: compararNumero(va.cantidad, vb.cantidad),
    unidadesVendidas: compararNumero(
      unidades.find((u) => u.actual)?.unidades ?? 0,
      unidades.find((u) => !u.actual)?.unidades ?? 0,
    ),
    ganancia: owner ? compararMontos(va.ganancia, vb.ganancia) : null,
    comisiones: comA && comB ? compararMontos(comA.total, comB.total) : null,
    comisionDe: comA?.porVendedor.map((v) => v.nombre) ?? [],
    gananciaNeta:
      comA && comB
        ? compararMontos(
            restarMontos(va.ganancia, comA.total),
            restarMontos(vb.ganancia, comB.total),
          )
        : null,
    margenPct:
      owner && Number(va.facturado.usdt) > 0
        ? Math.round((Number(va.ganancia.usdt) / Number(va.facturado.usdt)) * 1000) / 10
        : null,
    clientesNuevos: compararNumero(otros?.clientesA ?? 0, otros?.clientesB ?? 0),
    ticketPromedio: compararMontos(
      ticket(va.facturado, va.cantidad),
      ticket(vb.facturado, vb.cantidad),
    ),
    devoluciones: compararNumero(otros?.devolucionesA ?? 0, otros?.devolucionesB ?? 0),
  };
}

// =============================================================================
// Serie comparativa
// =============================================================================

/** SQL de la serie (exportado para EXPLAIN / verificación). */
export function sqlSerieComparativa(ctx: Ctx, p: Periodo, vendedorId?: string): Prisma.Sql {
  const { a, b, anterior } = rangos(p);
  const local = Prisma.sql`((v."fecha" AT TIME ZONE 'UTC') AT TIME ZONE ${TZ})`;
  const idx =
    p.modo === "DIARIO"
      ? Prisma.sql`EXTRACT(HOUR FROM ${local})::int`
      : Prisma.sql`(${local}::date - CASE WHEN v."fecha" >= ${ts(a.inicio)}
          THEN ${diaDe(p.desde)}::date ELSE ${diaDe(anterior.desde)}::date END)::int`;
  return Prisma.sql`
    SELECT (v."fecha" >= ${ts(a.inicio)}) AS "actual", ${idx} AS "idx",
           COALESCE(SUM(v."totalUsdt"), 0)::text AS "total"
    FROM "Venta" v
    WHERE v."panelId" = ${ctx.panelId}
      AND v."estado" = 'CONFIRMADA'
      AND v."fecha" >= ${ts(b.inicio)} AND v."fecha" < ${ts(a.fin)}
      ${vendedorId ? Prisma.sql`AND v."vendedorId" = ${vendedorId}` : Prisma.empty}
    GROUP BY 1, 2`;
}

/**
 * Facturado EN USDT (cada venta a su cotización) por punto (hora / día) del
 * período actual y del anterior, alineados.
 * Con `vendedorId`, solo las ventas de ese vendedor.
 */
export async function serieComparativa(
  ctx: Ctx,
  p: Periodo,
  vendedorId?: string,
): Promise<PuntoSerie[]> {
  const filas = await consultar(
    ctx,
    z.object({ actual: z.boolean(), idx: z.number().int(), total: montoTexto }),
    sqlSerieComparativa(ctx, p, vendedorId),
  );
  const instante = ahora();
  return armarSerie(
    p,
    filas.map((f) => ({ ...f, total: Number(f.total) })),
    { hoy: diaEn(instante, TZ), hora: horaEn(instante, TZ) },
  );
}

// =============================================================================
// Distribuciones del período actual
// =============================================================================

export interface PorMedioPago {
  medio: MedioPago;
  etiqueta: string;
  cantidad: number;
  total: Montos;
}

/**
 * Lo cobrado por medio de pago: Σ PagoVenta no anulados con FECHA DE PAGO en
 * el período (pagos al vender, mixtos por separado, y cobros de fiados), más
 * las diferencias de las devoluciones con cambio (restan si se le devolvió al
 * cliente), cada uno a la cotización de su venta. `cantidad` = movimientos
 * registrados en ese medio.
 */
export async function ventasPorMedioPago(ctx: Ctx, p: Periodo): Promise<PorMedioPago[]> {
  const { inicio, fin } = instantesDe(p);
  const filas = await consultar(
    ctx,
    z.object({ medio: z.enum(MedioPago), cantidad: z.number().int(), ...camposMontos("total") }),
    Prisma.sql`
      SELECT pv."medioPago"::text AS "medio", COUNT(*)::int AS "cantidad",
             ${sumaMontos(MONTO_MOVIMIENTO, "total")}
      FROM ${movimientosDePlata(ctx)} pv
      WHERE pv."fecha" >= ${ts(inicio)} AND pv."fecha" < ${ts(fin)}
      GROUP BY 1`,
  );
  // Los medios del panel (en su orden) y, además, cualquiera que tenga movimientos
  // aunque ya no esté habilitado.
  const { mediosPago } = await obtenerConfigVentas(ctx);
  const medios = [
    ...mediosPago,
    ...TODOS_LOS_MEDIOS.filter((m) => !mediosPago.includes(m) && filas.some((f) => f.medio === m)),
  ];
  return medios.map((medio) => {
    const f = filas.find((x) => x.medio === medio);
    return {
      medio,
      etiqueta: ETIQUETA_MEDIO_PAGO[medio],
      cantidad: f?.cantidad ?? 0,
      total: f ? leerMontos(f, "total") : MONTOS_CERO,
    };
  });
}

export interface PorTipo {
  tipo: TipoVenta;
  etiqueta: string;
  cantidad: number;
  total: Montos;
  unidades: number;
}

export async function ventasPorTipo(ctx: Ctx, p: Periodo): Promise<PorTipo[]> {
  const { inicio, fin } = instantesDe(p);
  const filas = await consultar(
    ctx,
    z.object({
      tipo: z.enum(TipoVenta),
      cantidad: z.number().int(),
      ...camposMontos("total"),
      unidades: z.number().int(),
    }),
    Prisma.sql`
      SELECT v."tipo"::text AS "tipo", COUNT(*)::int AS "cantidad",
             ${sumaMontos(DE_VENTA.total, "total")},
             COALESCE(SUM(u."unidades"), 0)::int AS "unidades"
      FROM "Venta" v
      LEFT JOIN LATERAL (
        SELECT SUM(vi."cantidad") AS "unidades" FROM "VentaItem" vi
        WHERE vi."ventaId" = v."id" AND vi."panelId" = ${ctx.panelId}
      ) u ON TRUE
      WHERE v."panelId" = ${ctx.panelId} AND v."estado" = 'CONFIRMADA'
        AND v."fecha" >= ${ts(inicio)} AND v."fecha" < ${ts(fin)}
      GROUP BY 1`,
  );
  return Object.values(TipoVenta).map((tipo) => {
    const f = filas.find((x) => x.tipo === tipo);
    return {
      tipo,
      etiqueta: ETIQUETA_TIPO_VENTA[tipo],
      cantidad: f?.cantidad ?? 0,
      total: f ? leerMontos(f, "total") : MONTOS_CERO,
      unidades: f?.unidades ?? 0,
    };
  });
}

export interface PorDeposito {
  depositoId: string;
  nombre: string;
  cantidad: number;
  total: Montos;
}

/** Ventas por galpón (todos los depósitos activos, aunque no hayan vendido). */
export async function ventasPorDeposito(ctx: Ctx, p: Periodo): Promise<PorDeposito[]> {
  const { inicio, fin } = instantesDe(p);
  const filas = await consultar(
    ctx,
    z.object({
      depositoId: z.string(),
      nombre: z.string(),
      cantidad: z.number().int(),
      ...camposMontos("total"),
    }),
    Prisma.sql`
      SELECT d."id" AS "depositoId", d."nombre" AS "nombre",
             COUNT(v."id")::int AS "cantidad", ${sumaMontos(DE_VENTA.total, "total")}
      FROM "Deposito" d
      LEFT JOIN "Venta" v ON v."depositoId" = d."id" AND v."panelId" = ${ctx.panelId}
        AND v."estado" = 'CONFIRMADA' AND v."fecha" >= ${ts(inicio)} AND v."fecha" < ${ts(fin)}
      WHERE d."panelId" = ${ctx.panelId} AND (d."activo" OR v."id" IS NOT NULL)
      GROUP BY d."id", d."nombre", d."esPrincipal"
      ORDER BY d."esPrincipal" DESC, d."nombre" ASC`,
  );
  return filas.map((f) => ({
    depositoId: f.depositoId,
    nombre: f.nombre,
    cantidad: f.cantidad,
    total: leerMontos(f, "total"),
  }));
}

export interface TopItem {
  id: string;
  nombre: string;
  unidades: number;
  /** Lo facturado neto (con el descuento de cada venta prorrateado). */
  facturado: Montos;
  /** Solo dueños. */
  ganancia: Montos | null;
}

const topSchema = z.object({
  id: z.string(),
  nombre: z.string(),
  sabor: z.string().nullable(),
  unidades: z.number().int(),
  ...camposMontos("facturado"),
  ...camposMontos("ganancia"),
});

/**
 * Lo facturado NETO de un ítem en pesos: su subtotal con el descuento de la
 * venta prorrateado (subtotal del ítem × total ÷ subtotal de la venta).
 */
const NETO_ITEM = Prisma.sql`COALESCE(vi."subtotal" * v."total" / NULLIF(v."subtotal", 0), 0)`;
/** Ganancia en pesos del ítem: neto − costo en pesos (a la cotización de la venta). */
const GANANCIA_ITEM_PESOS = Prisma.sql`(${NETO_ITEM} - vi."costoUnitario" * vi."cantidad")`;

async function top(ctx: Ctx, p: Periodo, limit: number, porSabor: boolean): Promise<TopItem[]> {
  const { inicio, fin } = instantesDe(p);
  const lim = Math.min(Math.max(Math.trunc(limit), 1), 100);
  // Cada ítem a la cotización de SU venta; se redondea solo la suma final.
  const r2 = (x: Prisma.Sql) => Prisma.sql`ROUND(COALESCE(SUM(${x}), 0), 2)::text`;
  const [owner, filas] = await Promise.all([
    esOwnerCtx(ctx),
    consultar(
      ctx,
      topSchema,
      Prisma.sql`
        SELECT ${porSabor ? Prisma.sql`va."id"` : Prisma.sql`p."id"`} AS "id",
               p."nombreCompleto" AS "nombre",
               ${porSabor ? Prisma.sql`va."nombre"` : Prisma.sql`NULL::text`} AS "sabor",
               SUM(vi."cantidad")::int AS "unidades",
               ${r2(Prisma.sql`${NETO_ITEM} / v."tipoCambioUsdt"`)} AS "facturadoUsdt",
               ${r2(NETO_ITEM)} AS "facturadoPesos",
               ${r2(Prisma.sql`${NETO_ITEM} / v."tipoCambioUsd"`)} AS "facturadoUsd",
               ${r2(Prisma.sql`${NETO_ITEM} / v."tipoCambioUsdt" - vi."costoUnitarioUsdt" * vi."cantidad"`)} AS "gananciaUsdt",
               ${r2(GANANCIA_ITEM_PESOS)} AS "gananciaPesos",
               ${r2(Prisma.sql`${GANANCIA_ITEM_PESOS} / v."tipoCambioUsd"`)} AS "gananciaUsd"
        FROM "Venta" v
        JOIN "VentaItem" vi ON vi."ventaId" = v."id"
        JOIN "Producto" p ON p."id" = vi."productoId"
        ${porSabor ? Prisma.sql`JOIN "Variante" va ON va."id" = vi."varianteId"` : Prisma.empty}
        WHERE v."panelId" = ${ctx.panelId} AND vi."panelId" = ${ctx.panelId}
          AND v."estado" = 'CONFIRMADA'
          AND v."fecha" >= ${ts(inicio)} AND v."fecha" < ${ts(fin)}
        GROUP BY 1, 2, 3
        ORDER BY "unidades" DESC, SUM(${NETO_ITEM} / v."tipoCambioUsdt") DESC
        LIMIT ${lim}`,
    ),
  ]);
  return filas.map((f) => ({
    id: f.id,
    nombre: porSabor ? nombreConSabor(f.nombre, f.sabor) : f.nombre,
    unidades: f.unidades,
    facturado: leerMontos(f, "facturado"),
    ganancia: owner ? leerMontos(f, "ganancia") : null,
  }));
}

/** Productos más vendidos del período (por unidades). */
export function topProductos(ctx: Ctx, p: Periodo, limit = 5): Promise<TopItem[]> {
  return top(ctx, p, limit, false);
}

/** Sabores (variantes) más vendidos del período. */
export function topSabores(ctx: Ctx, p: Periodo, limit = 5): Promise<TopItem[]> {
  return top(ctx, p, limit, true);
}

// =============================================================================
// Rendimiento por vendedor
// =============================================================================

export interface RendimientoVendedor {
  usuarioId: string;
  nombre: string;
  rol: RolUsuario;
  unitarias: { cantidad: number; total: Montos };
  mayoristas: { cantidad: number; total: Montos };
  cantidadVentas: number;
  facturado: Montos;
  unidades: number;
  ticketPromedio: Montos;
  cotizaciones: { creadas: number; convertidas: number; tasaPct: number | null };
  /** Clientes que dio de alta en el período (Cliente.creadoPorId), desde una venta o desde Clientes. */
  clientesNuevos: number;
  /** Ventas a clientes que se dieron de alta con esa misma venta (Venta.clienteNuevo). */
  ventasAClientesNuevos: number;
  devoluciones: number;
  /**
   * null si el usuario no tiene porcentajes de comisión cargados. `estimada`:
   * los porcentajes sobre lo vendido, en cada moneda.
   */
  comision: { unitariaPct: string | null; mayoristaPct: string | null; estimada: Montos } | null;
}

interface UsuarioRend {
  id: string;
  nombre: string;
  rol: RolUsuario;
  comisionUnitariaPct: Prisma.Decimal | null;
  comisionMayoristaPct: Prisma.Decimal | null;
}

async function agregadosVendedores(ctx: Ctx, r: Instantes, usuarioId?: string) {
  const soloV = usuarioId ? Prisma.sql`AND v."vendedorId" = ${usuarioId}` : Prisma.empty;
  const [ventas, unidades, cotizaciones, clientes, devoluciones] = await Promise.all([
    consultar(
      ctx,
      z.object({
        usuarioId: z.string(),
        tipo: z.enum(TipoVenta),
        cantidad: z.number().int(),
        aClientesNuevos: z.number().int(),
        ...camposMontos("total"),
      }),
      Prisma.sql`
        SELECT v."vendedorId" AS "usuarioId", v."tipo"::text AS "tipo",
               COUNT(*)::int AS "cantidad",
               (COUNT(*) FILTER (WHERE v."clienteNuevo"))::int AS "aClientesNuevos",
               ${sumaMontos(DE_VENTA.total, "total")}
        FROM "Venta" v
        WHERE v."panelId" = ${ctx.panelId} AND v."estado" = 'CONFIRMADA'
          AND v."fecha" >= ${ts(r.inicio)} AND v."fecha" < ${ts(r.fin)} ${soloV}
        GROUP BY 1, 2`,
    ),
    consultar(
      ctx,
      z.object({ usuarioId: z.string(), unidades: z.number().int() }),
      Prisma.sql`
        SELECT v."vendedorId" AS "usuarioId", COALESCE(SUM(vi."cantidad"), 0)::int AS "unidades"
        FROM "Venta" v
        JOIN "VentaItem" vi ON vi."ventaId" = v."id"
        WHERE v."panelId" = ${ctx.panelId} AND vi."panelId" = ${ctx.panelId}
          AND v."estado" = 'CONFIRMADA'
          AND v."fecha" >= ${ts(r.inicio)} AND v."fecha" < ${ts(r.fin)} ${soloV}
        GROUP BY 1`,
    ),
    consultar(
      ctx,
      z.object({ usuarioId: z.string(), creadas: z.number().int(), convertidas: z.number().int() }),
      Prisma.sql`
        SELECT c."vendedorId" AS "usuarioId", COUNT(*)::int AS "creadas",
               (COUNT(*) FILTER (WHERE c."estado" = 'CONVERTIDA'))::int AS "convertidas"
        FROM "Cotizacion" c
        WHERE c."panelId" = ${ctx.panelId} AND c."deletedAt" IS NULL
          AND c."fecha" >= ${ts(r.inicio)} AND c."fecha" < ${ts(r.fin)}
          ${usuarioId ? Prisma.sql`AND c."vendedorId" = ${usuarioId}` : Prisma.empty}
        GROUP BY 1`,
    ),
    consultar(
      ctx,
      z.object({ usuarioId: z.string(), cantidad: z.number().int() }),
      Prisma.sql`
        SELECT c."creadoPorId" AS "usuarioId", COUNT(*)::int AS "cantidad"
        FROM "Cliente" c
        WHERE c."panelId" = ${ctx.panelId} AND c."creadoPorId" IS NOT NULL
          AND c."createdAt" >= ${ts(r.inicio)} AND c."createdAt" < ${ts(r.fin)}
          ${usuarioId ? Prisma.sql`AND c."creadoPorId" = ${usuarioId}` : Prisma.empty}
        GROUP BY 1`,
    ),
    consultar(
      ctx,
      z.object({ usuarioId: z.string(), cantidad: z.number().int() }),
      Prisma.sql`
        SELECT d."usuarioId" AS "usuarioId", COUNT(*)::int AS "cantidad"
        FROM "Devolucion" d
        WHERE d."panelId" = ${ctx.panelId} AND d."estado" = 'REGISTRADA'
          AND d."fecha" >= ${ts(r.inicio)} AND d."fecha" < ${ts(r.fin)}
          ${usuarioId ? Prisma.sql`AND d."usuarioId" = ${usuarioId}` : Prisma.empty}
        GROUP BY 1`,
    ),
  ]);
  return { ventas, unidades, cotizaciones, clientes, devoluciones };
}

type Agregados = Awaited<ReturnType<typeof agregadosVendedores>>;

function filaRendimiento(u: UsuarioRend, ag: Agregados): RendimientoVendedor {
  const tipo = (t: TipoVenta) => {
    const f = ag.ventas.find((x) => x.usuarioId === u.id && x.tipo === t);
    return { cantidad: f?.cantidad ?? 0, total: f ? leerMontos(f, "total") : MONTOS_CERO };
  };
  const unitarias = tipo(TipoVenta.UNITARIA);
  const mayoristas = tipo(TipoVenta.MAYORISTA);
  const cantidadVentas = unitarias.cantidad + mayoristas.cantidad;
  const facturado = sumar([unitarias.total, mayoristas.total]);
  const cot = ag.cotizaciones.find((x) => x.usuarioId === u.id);
  const creadas = cot?.creadas ?? 0;
  const convertidas = cot?.convertidas ?? 0;
  const pctU = u.comisionUnitariaPct;
  const pctM = u.comisionMayoristaPct;
  return {
    usuarioId: u.id,
    nombre: u.nombre,
    rol: u.rol,
    unitarias,
    mayoristas,
    cantidadVentas,
    facturado,
    unidades: ag.unidades.find((x) => x.usuarioId === u.id)?.unidades ?? 0,
    ticketPromedio: ticket(facturado, cantidadVentas),
    cotizaciones: {
      creadas,
      convertidas,
      tasaPct: creadas === 0 ? null : Math.round((convertidas / creadas) * 1000) / 10,
    },
    clientesNuevos: ag.clientes.find((x) => x.usuarioId === u.id)?.cantidad ?? 0,
    ventasAClientesNuevos: ag.ventas
      .filter((x) => x.usuarioId === u.id)
      .reduce((a, x) => a + x.aClientesNuevos, 0),
    devoluciones: ag.devoluciones.find((x) => x.usuarioId === u.id)?.cantidad ?? 0,
    comision:
      pctU === null && pctM === null
        ? null
        : {
            unitariaPct: pctU?.toFixed(2) ?? null,
            mayoristaPct: pctM?.toFixed(2) ?? null,
            estimada: sumar([
              mapMontos(unitarias.total, (v) => v.mul(pctU ?? 0).div(100)),
              mapMontos(mayoristas.total, (v) => v.mul(pctM ?? 0).div(100)),
            ]),
          },
  };
}

const selectUsuarioRend = {
  id: true,
  nombre: true,
  rol: true,
  comisionUnitariaPct: true,
  comisionMayoristaPct: true,
} satisfies Prisma.UsuarioSelect;

/**
 * Rendimiento de cada usuario del panel en el período: los que vendieron
 * (o cotizaron, cargaron clientes, registraron devoluciones) y los que tienen
 * acceso al panel (empleados habilitados y dueños activos). Solo dueños.
 * Empleados primero (por facturado), después los dueños.
 */
export async function rendimientoVendedores(ctx: Ctx, p: Periodo): Promise<RendimientoVendedor[]> {
  await exigirOwner(ctx, "El rendimiento del equipo");
  const ag = await agregadosVendedores(ctx, instantesDe(p));
  const conDatos = [
    ...new Set(
      [ag.ventas, ag.cotizaciones, ag.clientes, ag.devoluciones].flatMap((l) =>
        l.map((x) => x.usuarioId),
      ),
    ),
  ];
  const usuarios = await dbPara(ctx.panelId).usuario.findMany({
    where: {
      OR: [
        { id: { in: conDatos } },
        {
          deletedAt: null,
          activo: true,
          OR: [{ rol: RolUsuario.OWNER }, { paneles: { some: { panelId: ctx.panelId } } }],
        },
      ],
    },
    select: selectUsuarioRend,
  });
  return usuarios
    .map((u) => filaRendimiento(u, ag))
    .sort(
      (x, y) =>
        (x.rol === RolUsuario.OWNER ? 1 : 0) - (y.rol === RolUsuario.OWNER ? 1 : 0) ||
        Number(y.facturado.usdt) - Number(x.facturado.usdt) ||
        x.nombre.localeCompare(y.nombre),
    );
}

export interface RendimientoComparado {
  usuario: { id: string; nombre: string; rol: RolUsuario };
  actual: RendimientoVendedor;
  anterior: RendimientoVendedor;
  facturado: ComparadoMontos;
  cantidadVentas: Comparado<number>;
  unidades: Comparado<number>;
  ticketPromedio: ComparadoMontos;
  clientesNuevos: Comparado<number>;
  ventasAClientesNuevos: Comparado<number>;
  comision: ComparadoMontos | null;
}

async function rendimientoDe(
  ctx: Ctx,
  usuarioId: string,
  p: Periodo,
): Promise<RendimientoComparado> {
  const u = await dbPara(ctx.panelId).usuario.findUnique({
    where: { id: usuarioId },
    select: selectUsuarioRend,
  });
  if (!u) throw new NotFoundError("El usuario no existe");
  const { a, b } = rangos(p);
  const [agA, agB] = await Promise.all([
    agregadosVendedores(ctx, a, usuarioId),
    agregadosVendedores(ctx, b, usuarioId),
  ]);
  const actual = filaRendimiento(u, agA);
  const anterior = filaRendimiento(u, agB);
  return {
    usuario: { id: u.id, nombre: u.nombre, rol: u.rol },
    actual,
    anterior,
    facturado: compararMontos(actual.facturado, anterior.facturado),
    cantidadVentas: compararNumero(actual.cantidadVentas, anterior.cantidadVentas),
    unidades: compararNumero(actual.unidades, anterior.unidades),
    ticketPromedio: compararMontos(actual.ticketPromedio, anterior.ticketPromedio),
    clientesNuevos: compararNumero(actual.clientesNuevos, anterior.clientesNuevos),
    ventasAClientesNuevos: compararNumero(
      actual.ventasAClientesNuevos,
      anterior.ventasAClientesNuevos,
    ),
    comision:
      actual.comision && anterior.comision
        ? compararMontos(actual.comision.estimada, anterior.comision.estimada)
        : null,
  };
}

/** "Mi rendimiento": el del usuario que llama (sin costos ni datos de otros). */
export function miRendimiento(ctx: Ctx, p: Periodo): Promise<RendimientoComparado> {
  return rendimientoDe(ctx, ctx.usuarioId, p);
}

export interface VentaDeVendedor {
  id: string;
  codigo: string;
  fecha: Date;
  tipo: TipoVenta;
  cliente: string;
  /** El cliente se dio de alta con esta venta. */
  clienteNuevo: boolean;
  /** Medio principal; null si se fió todo. */
  medioPago: MedioPago | null;
  estadoPago: EstadoPago;
  /** Lo que falta cobrar, a la cotización de la venta. */
  saldoPendiente: Montos;
  unidades: number;
  total: Montos;
}

export const PAGE_SIZE_VENTAS_VENDEDOR = 25;

/** Saldo pendiente (pesos) de una venta en las tres monedas, a SU cotización. */
function saldoDeVenta(v: {
  saldoPendiente: Prisma.Decimal;
  tipoCambioUsdt: Prisma.Decimal;
  tipoCambioUsd: Prisma.Decimal;
}): Montos {
  const r2 = (d: Prisma.Decimal) => d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2);
  return {
    usdt: r2(v.saldoPendiente.div(v.tipoCambioUsdt)),
    pesos: v.saldoPendiente.toFixed(2),
    usd: r2(v.saldoPendiente.div(v.tipoCambioUsd)),
  };
}

async function listarVentasVendedor(
  ctx: Ctx,
  usuarioId: string,
  p: Periodo,
  pagina: { skip: number; take: number },
): Promise<{ filas: VentaDeVendedor[]; total: number }> {
  const { inicio, fin } = instantesDe(p);
  const where = {
    vendedorId: usuarioId,
    estado: "CONFIRMADA" as const,
    fecha: { gte: inicio, lt: fin },
  };
  const db = dbPara(ctx.panelId);
  const [ventas, total] = await Promise.all([
    db.venta.findMany({
      where,
      orderBy: [{ fecha: "desc" }, { numero: "desc" }],
      skip: pagina.skip,
      take: pagina.take,
      select: {
        id: true,
        codigo: true,
        fecha: true,
        tipo: true,
        medioPago: true,
        estadoPago: true,
        saldoPendiente: true,
        clienteNuevo: true,
        total: true,
        totalUsdt: true,
        tipoCambioUsdt: true,
        tipoCambioUsd: true,
        cliente: { select: { nombre: true } },
      },
    }),
    db.venta.count({ where }),
  ]);
  const unidades = ventas.length
    ? await db.ventaItem.groupBy({
        by: ["ventaId"],
        where: { ventaId: { in: ventas.map((v) => v.id) } },
        _sum: { cantidad: true },
      })
    : [];
  return {
    total,
    filas: ventas.map((v) => ({
      id: v.id,
      codigo: v.codigo,
      fecha: v.fecha,
      tipo: v.tipo,
      cliente: v.cliente.nombre,
      clienteNuevo: v.clienteNuevo,
      medioPago: v.medioPago,
      estadoPago: v.estadoPago,
      saldoPendiente: saldoDeVenta(v),
      unidades: unidades.find((u) => u.ventaId === v.id)?._sum.cantidad ?? 0,
      total: totalDeVenta(v),
    })),
  };
}

export interface VentasDeVendedor extends RendimientoComparado {
  /** Facturado del vendedor por hora / día, contra el período anterior. */
  serie: PuntoSerie[];
  ventas: { filas: VentaDeVendedor[]; total: number; page: number; pageSize: number };
}

/**
 * "Ventas de {vendedor}" (Reportes y Equipo, solo dueños): cantidad de ventas,
 * unidades ("vapes vendidos"), facturado, clientes nuevos que cargó y ventas a
 * clientes nuevos, unitarias vs. mayoristas (todo contra el período anterior),
 * el facturado por día y sus ventas paginadas.
 */
export async function ventasDeVendedor(
  ctx: Ctx,
  usuarioId: string,
  p: Periodo,
  page = 1,
): Promise<VentasDeVendedor> {
  await exigirOwner(ctx, "Las ventas de un vendedor");
  const pagina = Math.max(1, Math.trunc(page) || 1);
  const [rend, serie, ventas] = await Promise.all([
    rendimientoDe(ctx, usuarioId, p),
    serieComparativa(ctx, p, usuarioId),
    listarVentasVendedor(ctx, usuarioId, p, {
      skip: (pagina - 1) * PAGE_SIZE_VENTAS_VENDEDOR,
      take: PAGE_SIZE_VENTAS_VENDEDOR,
    }),
  ]);
  return {
    ...rend,
    serie,
    ventas: { ...ventas, page: pagina, pageSize: PAGE_SIZE_VENTAS_VENDEDOR },
  };
}

export interface VendedorDestacado {
  id: string;
  nombre: string;
}

/**
 * Empleados que venden en el panel (activos, con acceso y VENTAS "crear"):
 * una tarjeta "Ventas de {nombre}" cada uno en Reportes. Solo dueños.
 */
export async function vendedoresDestacados(ctx: Ctx): Promise<VendedorDestacado[]> {
  await exigirOwner(ctx, "Los vendedores del panel");
  return dbPara(ctx.panelId).usuario.findMany({
    where: {
      rol: RolUsuario.EMPLEADO,
      activo: true,
      deletedAt: null,
      paneles: { some: { panelId: ctx.panelId } },
      permisos: { some: { panelId: ctx.panelId, modulo: Modulo.VENTAS, puedeCrear: true } },
    },
    orderBy: { nombre: "asc" },
    select: { id: true, nombre: true },
  });
}

/** Excel con todas las ventas del vendedor en el período (máx. 20.000). Solo dueños. */
export async function exportarVentasVendedorExcel(
  ctx: Ctx,
  usuarioId: string,
  p: Periodo,
): Promise<{ buffer: Buffer; nombre: string }> {
  await exigirOwner(ctx, "Exportar las ventas de un vendedor");
  const rend = await rendimientoDe(ctx, usuarioId, p);
  const { filas } = await listarVentasVendedor(ctx, usuarioId, p, { skip: 0, take: 20_000 });
  const libro = new ExcelJS.Workbook();
  libro.created = new Date();
  const hoja = libro.addWorksheet("Ventas", { views: [{ state: "frozen", ySplit: 1 }] });
  hoja.columns = [
    { header: "ID de venta", key: "codigo", width: 14 },
    { header: "Fecha", key: "fecha", width: 18 },
    { header: "Tipo", key: "tipo", width: 12 },
    { header: "Cliente", key: "cliente", width: 28 },
    { header: "Cliente nuevo", key: "nuevo", width: 13 },
    { header: "Medio de pago", key: "medio", width: 16 },
    { header: "Estado de pago", key: "estadoPago", width: 15 },
    { header: "Unidades", key: "unidades", width: 10 },
    { header: "Total USDT", key: "totalUsdt", width: 14, style: { numFmt: '#,##0.00 "USDT"' } },
    { header: "Total en pesos", key: "total", width: 16, style: { numFmt: '"$" #,##0.00' } },
    { header: "Total en dólares", key: "totalUsd", width: 16, style: { numFmt: '"US$" #,##0.00' } },
  ];
  hoja.getRow(1).font = { bold: true };
  for (const v of filas) {
    hoja.addRow({
      codigo: v.codigo,
      fecha: new Intl.DateTimeFormat("es-AR", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: TZ,
      }).format(v.fecha),
      tipo: ETIQUETA_TIPO_VENTA[v.tipo],
      cliente: v.cliente,
      nuevo: v.clienteNuevo ? "Sí" : "",
      medio: etiquetaMedioPrincipal(v.medioPago),
      estadoPago: ESTADO_PAGO_UI[v.estadoPago].label,
      unidades: v.unidades,
      totalUsdt: Number(v.total.usdt),
      total: Number(v.total.pesos),
      totalUsd: Number(v.total.usd),
    });
  }
  const pie = hoja.addRow({
    cliente: "Total",
    unidades: rend.actual.unidades,
    totalUsdt: Number(rend.actual.facturado.usdt),
    total: Number(rend.actual.facturado.pesos),
    totalUsd: Number(rend.actual.facturado.usd),
  });
  pie.font = { bold: true };
  const slug = rend.usuario.nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
  return {
    buffer: Buffer.from(await libro.xlsx.writeBuffer()),
    nombre: `ventas-${slug}-${diaDe(p.desde)}-${diaDe(p.hasta)}`,
  };
}

// =============================================================================
// Compras vs. ventas (dueños)
// =============================================================================

export interface ComprasPeriodo {
  /**
   * Costo final de las compras recibidas (con comisión del pasista y gastos
   * extras), cada una a SU cotización (la de su fecha si no la guardó).
   */
  compras: ComparadoMontos;
  cantidadCompras: Comparado<number>;
  ventas: ComparadoMontos;
  /** Costo de lo vendido (Σ costoTotalUsdt / costoTotal). */
  costoVendido: ComparadoMontos;
}

export async function comprasDelPeriodo(ctx: Ctx, p: Periodo): Promise<ComprasPeriodo> {
  await exigirOwner(ctx, "Compras vs. ventas");
  const { a, b } = rangos(p);
  const filaCompras = z.object({
    actual: z.boolean(),
    cantidad: z.number().int(),
    ...camposMontos("total"),
  });
  const [compras, ventas] = await Promise.all([
    consultar(
      ctx,
      filaCompras,
      Prisma.sql`
        SELECT (c."fecha" >= ${ts(a.inicio)}) AS "actual", COUNT(*)::int AS "cantidad",
               ${sumaMontos(
                 convertido(
                   Prisma.sql`c."costoFinalTotal"`,
                   Prisma.sql`COALESCE(c."tipoCambioUSDT", ${cotizacionEn("USDT", Prisma.sql`c."fecha"`)})`,
                   Prisma.sql`COALESCE(c."tipoCambioUSD", ${cotizacionEn("USD_BLUE", Prisma.sql`c."fecha"`)})`,
                 ),
                 "total",
               )}
        FROM "Compra" c
        WHERE c."panelId" = ${ctx.panelId} AND c."estado" = 'RECIBIDA'
          AND c."fecha" >= ${ts(b.inicio)} AND c."fecha" < ${ts(a.fin)}
        GROUP BY 1`,
    ),
    ventasActualAnterior(ctx, p),
  ]);
  const ca = compras.find((c) => c.actual);
  const cb = compras.find((c) => !c.actual);
  const de = (f: z.output<typeof filaCompras> | undefined) =>
    f ? leerMontos(f, "total") : MONTOS_CERO;
  return {
    compras: compararMontos(de(ca), de(cb)),
    cantidadCompras: compararNumero(ca?.cantidad ?? 0, cb?.cantidad ?? 0),
    ventas: compararMontos(ventas.actual.facturado, ventas.anterior.facturado),
    costoVendido: compararMontos(ventas.actual.costo, ventas.anterior.costo),
  };
}

// =============================================================================
// Alertas y pendientes
// =============================================================================

export interface AlertasDeposito {
  depositoId: string;
  nombre: string;
  sinStock: number;
  bajoMinimo: number;
  /** Los más urgentes (hasta 5): primero sin stock. */
  items: { varianteId: string; nombre: string; cantidad: number; stockMinimo: number }[];
}

/**
 * Stock por galpón: "sin stock" = el sabor tiene fila de stock en ese galpón
 * (se manejó ahí) y está en 0; "bajo mínimo" = tiene mínimo y no lo alcanza.
 */
export async function alertasStock(ctx: Ctx): Promise<AlertasDeposito[]> {
  const filas = await consultar(
    ctx,
    z.object({
      depositoId: z.string(),
      deposito: z.string(),
      sinStock: z.number().int(),
      bajoMinimo: z.number().int(),
      varianteId: z.string().nullable(),
      producto: z.string().nullable(),
      sabor: z.string().nullable(),
      cantidad: z.number().int().nullable(),
      stockMinimo: z.number().int().nullable(),
    }),
    Prisma.sql`
      WITH alertas AS (
        SELECT d."id" AS "depositoId", va."id" AS "varianteId", p."nombreCompleto" AS "producto",
               va."nombre" AS "sabor", COALESCE(s."cantidad", 0) AS "cantidad",
               va."stockMinimo" AS "stockMinimo",
               ROW_NUMBER() OVER (PARTITION BY d."id"
                 ORDER BY COALESCE(s."cantidad", 0) ASC, va."stockMinimo" DESC, p."nombreCompleto") AS "n"
        FROM "Deposito" d
        JOIN "Variante" va ON va."panelId" = ${ctx.panelId}
        JOIN "Producto" p ON p."id" = va."productoId"
        LEFT JOIN "Stock" s ON s."varianteId" = va."id" AND s."depositoId" = d."id"
        WHERE d."panelId" = ${ctx.panelId} AND d."activo"
          AND va."activo" AND va."deletedAt" IS NULL AND p."activo" AND p."deletedAt" IS NULL
          AND ((va."stockMinimo" > 0 AND COALESCE(s."cantidad", 0) < va."stockMinimo")
               OR (s."id" IS NOT NULL AND s."cantidad" <= 0))
      )
      SELECT d."id" AS "depositoId", d."nombre" AS "deposito",
             (SELECT COUNT(*) FROM alertas a WHERE a."depositoId" = d."id" AND a."cantidad" <= 0)::int AS "sinStock",
             (SELECT COUNT(*) FROM alertas a WHERE a."depositoId" = d."id" AND a."cantidad" > 0)::int AS "bajoMinimo",
             a."varianteId", a."producto", a."sabor", a."cantidad"::int AS "cantidad",
             a."stockMinimo"
      FROM "Deposito" d
      LEFT JOIN alertas a ON a."depositoId" = d."id" AND a."n" <= 5
      WHERE d."panelId" = ${ctx.panelId} AND d."activo"
      ORDER BY d."esPrincipal" DESC, d."nombre", a."n"`,
  );
  const porDeposito = new Map<string, AlertasDeposito>();
  for (const f of filas) {
    const dep = porDeposito.get(f.depositoId) ?? {
      depositoId: f.depositoId,
      nombre: f.deposito,
      sinStock: f.sinStock,
      bajoMinimo: f.bajoMinimo,
      items: [],
    };
    if (f.varianteId && f.producto !== null) {
      dep.items.push({
        varianteId: f.varianteId,
        nombre: nombreConSabor(f.producto, f.sabor),
        cantidad: f.cantidad ?? 0,
        stockMinimo: f.stockMinimo ?? 0,
      });
    }
    porDeposito.set(f.depositoId, dep);
  }
  return [...porDeposito.values()];
}

export interface Pendientes {
  /** null = quien llama no ve compras. */
  comprasBorrador: number | null;
  /** null = quien llama no ve el cotizador. `total` en pesos: una cotización es un presupuesto en pesos. */
  cotizacionesPorVencer:
    | { id: string; codigo: string; cliente: string | null; validaHasta: Date; total: string }[]
    | null;
}

/**
 * Compras en borrador y cotizaciones abiertas que vencen en las próximas 48 h
 * (un empleado ve solo las suyas).
 */
export async function pendientes(
  ctx: Ctx,
  opciones: { verCompras: boolean; verCotizaciones: boolean; soloPropias: boolean },
): Promise<Pendientes> {
  const db = dbPara(ctx.panelId);
  const instante = ahora();
  const limite = new Date(instante.getTime() + 48 * 3600_000);
  const [comprasBorrador, cotizaciones] = await Promise.all([
    opciones.verCompras ? db.compra.count({ where: { estado: "BORRADOR" } }) : null,
    opciones.verCotizaciones
      ? db.cotizacion.findMany({
          where: {
            deletedAt: null,
            estado: {
              in: [EstadoCotizacion.BORRADOR, EstadoCotizacion.ENVIADA, EstadoCotizacion.ACEPTADA],
            },
            validaHasta: { gte: instante, lte: limite },
            ...(opciones.soloPropias ? { vendedorId: ctx.usuarioId } : {}),
          },
          orderBy: { validaHasta: "asc" },
          take: 10,
          select: {
            id: true,
            codigo: true,
            validaHasta: true,
            total: true,
            clienteNombre: true,
            cliente: { select: { nombre: true } },
          },
        })
      : null,
  ]);
  return {
    comprasBorrador,
    cotizacionesPorVencer:
      cotizaciones?.map((c) => ({
        id: c.id,
        codigo: c.codigo,
        cliente: c.cliente?.nombre ?? c.clienteNombre,
        validaHasta: c.validaHasta,
        total: aMonto(c.total),
      })) ?? null,
  };
}
