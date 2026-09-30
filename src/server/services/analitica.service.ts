import ExcelJS from "exceljs";
import { EstadoCotizacion, MedioPago, Prisma, RolUsuario, TipoVenta } from "@prisma/client";
import { getDaysInMonth, getISODay, parseISO } from "date-fns";
import { z } from "zod";

import { esOwner, type SujetoPermisos } from "@/lib/permisos";
import { ahora } from "@/lib/reloj";
import {
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
import { puedeFiados } from "@/server/services/fiado.service";

/**
 * ANALÍTICA del panel (dashboard, rendimiento del equipo, reportes).
 *
 * Todo se agrega en PostgreSQL (`$queryRaw` con `"panelId" = ctx.panelId`
 * explícito y el resultado validado con Zod): acá nunca se traen ventas
 * completas a memoria para sumarlas. Los días se cortan en la zona del
 * negocio (America/Argentina/Buenos_Aires) y la semana va de lunes a domingo.
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

const ticket = (total: string, cantidad: number) =>
  cantidad === 0 ? "0.00" : D(total).div(cantidad).toFixed(2);

// =============================================================================
// KPIs
// =============================================================================

export interface KpisPeriodo {
  periodo: Periodo;
  anterior: Periodo;
  /** Σ total de las ventas (lo vendido, incluye lo fiado). */
  facturado: Comparado<string>;
  /**
   * Σ pagos no anulados con fecha en el período (al vender y cobros de
   * fiados). Solo dueños o FIADOS "ver" (null para el resto).
   */
  cobrado: Comparado<string> | null;
  /** Deuda total actual de los clientes (no depende del período). Idem `cobrado`. */
  porCobrar: string | null;
  cantidadVentas: Comparado<number>;
  unidadesVendidas: Comparado<number>;
  /** Solo dueños (null para el resto). */
  ganancia: Comparado<string> | null;
  /** Ganancia / facturado del período actual, en %. Solo dueños. */
  margenPct: number | null;
  clientesNuevos: Comparado<number>;
  ticketPromedio: Comparado<string>;
  /** Devoluciones por garantía REGISTRADAS (no anuladas). */
  devoluciones: Comparado<number>;
}

const filaVentasSchema = z.object({
  actual: z.boolean(),
  cantidad: z.number().int(),
  facturado: montoTexto,
  ganancia: montoTexto,
  costo: montoTexto,
});

async function ventasActualAnterior(ctx: Ctx, p: Periodo) {
  const { a, b } = rangos(p);
  const filas = await consultar(
    ctx,
    filaVentasSchema,
    Prisma.sql`
      SELECT (v."fecha" >= ${ts(a.inicio)}) AS "actual",
             COUNT(*)::int AS "cantidad",
             COALESCE(SUM(v."total"), 0)::text AS "facturado",
             COALESCE(SUM(v."gananciaBruta"), 0)::text AS "ganancia",
             COALESCE(SUM(v."costoTotal"), 0)::text AS "costo"
      FROM "Venta" v
      WHERE v."panelId" = ${ctx.panelId}
        AND v."estado" = 'CONFIRMADA'
        AND v."fecha" >= ${ts(b.inicio)} AND v."fecha" < ${ts(a.fin)}
      GROUP BY 1`,
  );
  const vacio = { cantidad: 0, facturado: "0", ganancia: "0", costo: "0" };
  return {
    actual: filas.find((f) => f.actual) ?? vacio,
    anterior: filas.find((f) => !f.actual) ?? vacio,
  };
}

/** Cobrado del período actual y del anterior, y la deuda total de hoy. */
async function cobranzas(ctx: Ctx, p: Periodo) {
  const { a, b } = rangos(p);
  const [cobrado, [deuda]] = await Promise.all([
    consultar(
      ctx,
      z.object({ actual: z.boolean(), total: montoTexto }),
      Prisma.sql`
        SELECT (pv."fecha" >= ${ts(a.inicio)}) AS "actual", COALESCE(SUM(pv."monto"), 0)::text AS "total"
        FROM "PagoVenta" pv
        WHERE pv."panelId" = ${ctx.panelId} AND NOT pv."anulado"
          AND pv."fecha" >= ${ts(b.inicio)} AND pv."fecha" < ${ts(a.fin)}
        GROUP BY 1`,
    ),
    consultar(
      ctx,
      z.object({ total: montoTexto }),
      Prisma.sql`
        SELECT COALESCE(SUM(c."saldoDeudor"), 0)::text AS "total"
        FROM "Cliente" c WHERE c."panelId" = ${ctx.panelId} AND c."saldoDeudor" > 0`,
    ),
  ]);
  return {
    cobrado: compararMonto(
      cobrado.find((f) => f.actual)?.total ?? "0",
      cobrado.find((f) => !f.actual)?.total ?? "0",
    ),
    porCobrar: aMonto(deuda?.total ?? "0"),
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
  return {
    periodo: p,
    anterior,
    facturado: compararMonto(va.facturado, vb.facturado),
    cobrado: cobros?.cobrado ?? null,
    porCobrar: cobros?.porCobrar ?? null,
    cantidadVentas: compararNumero(va.cantidad, vb.cantidad),
    unidadesVendidas: compararNumero(
      unidades.find((u) => u.actual)?.unidades ?? 0,
      unidades.find((u) => !u.actual)?.unidades ?? 0,
    ),
    ganancia: owner ? compararMonto(va.ganancia, vb.ganancia) : null,
    margenPct:
      owner && Number(va.facturado) > 0
        ? Math.round((Number(va.ganancia) / Number(va.facturado)) * 1000) / 10
        : null,
    clientesNuevos: compararNumero(otros?.clientesA ?? 0, otros?.clientesB ?? 0),
    ticketPromedio: compararMonto(
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
export function sqlSerieComparativa(ctx: Ctx, p: Periodo): Prisma.Sql {
  const { a, b, anterior } = rangos(p);
  const local = Prisma.sql`((v."fecha" AT TIME ZONE 'UTC') AT TIME ZONE ${TZ})`;
  const idx =
    p.modo === "DIARIO"
      ? Prisma.sql`EXTRACT(HOUR FROM ${local})::int`
      : Prisma.sql`(${local}::date - CASE WHEN v."fecha" >= ${ts(a.inicio)}
          THEN ${diaDe(p.desde)}::date ELSE ${diaDe(anterior.desde)}::date END)::int`;
  return Prisma.sql`
    SELECT (v."fecha" >= ${ts(a.inicio)}) AS "actual", ${idx} AS "idx",
           COALESCE(SUM(v."total"), 0)::text AS "total"
    FROM "Venta" v
    WHERE v."panelId" = ${ctx.panelId}
      AND v."estado" = 'CONFIRMADA'
      AND v."fecha" >= ${ts(b.inicio)} AND v."fecha" < ${ts(a.fin)}
    GROUP BY 1, 2`;
}

/** Facturado por punto (hora / día) del período actual y del anterior, alineados. */
export async function serieComparativa(ctx: Ctx, p: Periodo): Promise<PuntoSerie[]> {
  const filas = await consultar(
    ctx,
    z.object({ actual: z.boolean(), idx: z.number().int(), total: montoTexto }),
    sqlSerieComparativa(ctx, p),
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
  total: string;
}

/**
 * Lo cobrado por medio de pago: Σ PagoVenta no anulados con FECHA DE PAGO en
 * el período (pagos al vender, mixtos por separado, y cobros de fiados).
 * `cantidad` = pagos registrados en ese medio.
 */
export async function ventasPorMedioPago(ctx: Ctx, p: Periodo): Promise<PorMedioPago[]> {
  const { inicio, fin } = instantesDe(p);
  const filas = await consultar(
    ctx,
    z.object({ medio: z.enum(MedioPago), cantidad: z.number().int(), total: montoTexto }),
    Prisma.sql`
      SELECT pv."medioPago"::text AS "medio", COUNT(*)::int AS "cantidad",
             COALESCE(SUM(pv."monto"), 0)::text AS "total"
      FROM "PagoVenta" pv
      WHERE pv."panelId" = ${ctx.panelId} AND NOT pv."anulado"
        AND pv."fecha" >= ${ts(inicio)} AND pv."fecha" < ${ts(fin)}
      GROUP BY 1`,
  );
  return Object.values(MedioPago).map((medio) => {
    const f = filas.find((x) => x.medio === medio);
    return {
      medio,
      etiqueta: ETIQUETA_MEDIO_PAGO[medio],
      cantidad: f?.cantidad ?? 0,
      total: aMonto(f?.total ?? "0"),
    };
  });
}

export interface PorTipo {
  tipo: TipoVenta;
  etiqueta: string;
  cantidad: number;
  total: string;
  unidades: number;
}

export async function ventasPorTipo(ctx: Ctx, p: Periodo): Promise<PorTipo[]> {
  const { inicio, fin } = instantesDe(p);
  const filas = await consultar(
    ctx,
    z.object({
      tipo: z.enum(TipoVenta),
      cantidad: z.number().int(),
      total: montoTexto,
      unidades: z.number().int(),
    }),
    Prisma.sql`
      SELECT v."tipo"::text AS "tipo", COUNT(*)::int AS "cantidad",
             COALESCE(SUM(v."total"), 0)::text AS "total",
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
      total: aMonto(f?.total ?? "0"),
      unidades: f?.unidades ?? 0,
    };
  });
}

export interface PorDeposito {
  depositoId: string;
  nombre: string;
  cantidad: number;
  total: string;
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
      total: montoTexto,
    }),
    Prisma.sql`
      SELECT d."id" AS "depositoId", d."nombre" AS "nombre",
             COUNT(v."id")::int AS "cantidad", COALESCE(SUM(v."total"), 0)::text AS "total"
      FROM "Deposito" d
      LEFT JOIN "Venta" v ON v."depositoId" = d."id" AND v."panelId" = ${ctx.panelId}
        AND v."estado" = 'CONFIRMADA' AND v."fecha" >= ${ts(inicio)} AND v."fecha" < ${ts(fin)}
      WHERE d."panelId" = ${ctx.panelId} AND (d."activo" OR v."id" IS NOT NULL)
      GROUP BY d."id", d."nombre", d."esPrincipal"
      ORDER BY d."esPrincipal" DESC, d."nombre" ASC`,
  );
  return filas.map((f) => ({ ...f, total: aMonto(f.total) }));
}

export interface TopItem {
  id: string;
  nombre: string;
  unidades: number;
  facturado: string;
  /** Solo dueños. */
  ganancia: string | null;
}

const topSchema = z.object({
  id: z.string(),
  nombre: z.string(),
  sabor: z.string().nullable(),
  unidades: z.number().int(),
  facturado: montoTexto,
  ganancia: montoTexto,
});

async function top(ctx: Ctx, p: Periodo, limit: number, porSabor: boolean): Promise<TopItem[]> {
  const { inicio, fin } = instantesDe(p);
  const lim = Math.min(Math.max(Math.trunc(limit), 1), 100);
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
               SUM(vi."subtotal")::text AS "facturado",
               SUM((vi."precioUnitario" - vi."costoUnitario") * vi."cantidad")::text AS "ganancia"
        FROM "Venta" v
        JOIN "VentaItem" vi ON vi."ventaId" = v."id"
        JOIN "Producto" p ON p."id" = vi."productoId"
        ${porSabor ? Prisma.sql`JOIN "Variante" va ON va."id" = vi."varianteId"` : Prisma.empty}
        WHERE v."panelId" = ${ctx.panelId} AND vi."panelId" = ${ctx.panelId}
          AND v."estado" = 'CONFIRMADA'
          AND v."fecha" >= ${ts(inicio)} AND v."fecha" < ${ts(fin)}
        GROUP BY 1, 2, 3
        ORDER BY "unidades" DESC, SUM(vi."subtotal") DESC
        LIMIT ${lim}`,
    ),
  ]);
  return filas.map((f) => ({
    id: f.id,
    nombre: porSabor ? nombreConSabor(f.nombre, f.sabor) : f.nombre,
    unidades: f.unidades,
    facturado: aMonto(f.facturado),
    ganancia: owner ? aMonto(f.ganancia) : null,
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
  unitarias: { cantidad: number; total: string };
  mayoristas: { cantidad: number; total: string };
  cantidadVentas: number;
  facturado: string;
  unidades: number;
  ticketPromedio: string;
  cotizaciones: { creadas: number; convertidas: number; tasaPct: number | null };
  /** Clientes que dio de alta (AuditLog CREATE Cliente). */
  clientesNuevos: number;
  devoluciones: number;
  /** null si el usuario no tiene porcentajes de comisión cargados. */
  comision: { unitariaPct: string | null; mayoristaPct: string | null; estimada: string } | null;
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
        total: montoTexto,
      }),
      Prisma.sql`
        SELECT v."vendedorId" AS "usuarioId", v."tipo"::text AS "tipo",
               COUNT(*)::int AS "cantidad", COALESCE(SUM(v."total"), 0)::text AS "total"
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
        SELECT a."usuarioId" AS "usuarioId", COUNT(*)::int AS "cantidad"
        FROM "AuditLog" a
        WHERE a."panelId" = ${ctx.panelId} AND a."accion" = 'CREATE' AND a."entidad" = 'Cliente'
          AND a."usuarioId" IS NOT NULL
          AND a."createdAt" >= ${ts(r.inicio)} AND a."createdAt" < ${ts(r.fin)}
          ${usuarioId ? Prisma.sql`AND a."usuarioId" = ${usuarioId}` : Prisma.empty}
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
    return { cantidad: f?.cantidad ?? 0, total: aMonto(f?.total ?? "0") };
  };
  const unitarias = tipo(TipoVenta.UNITARIA);
  const mayoristas = tipo(TipoVenta.MAYORISTA);
  const cantidadVentas = unitarias.cantidad + mayoristas.cantidad;
  const facturado = D(unitarias.total).plus(mayoristas.total).toFixed(2);
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
    devoluciones: ag.devoluciones.find((x) => x.usuarioId === u.id)?.cantidad ?? 0,
    comision:
      pctU === null && pctM === null
        ? null
        : {
            unitariaPct: pctU?.toFixed(2) ?? null,
            mayoristaPct: pctM?.toFixed(2) ?? null,
            estimada: D(unitarias.total)
              .mul(pctU ?? 0)
              .plus(D(mayoristas.total).mul(pctM ?? 0))
              .div(100)
              .toFixed(2),
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
        Number(y.facturado) - Number(x.facturado) ||
        x.nombre.localeCompare(y.nombre),
    );
}

export interface RendimientoComparado {
  usuario: { id: string; nombre: string; rol: RolUsuario };
  actual: RendimientoVendedor;
  anterior: RendimientoVendedor;
  facturado: Comparado<string>;
  cantidadVentas: Comparado<number>;
  unidades: Comparado<number>;
  ticketPromedio: Comparado<string>;
  clientesNuevos: Comparado<number>;
  comision: Comparado<string> | null;
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
    facturado: compararMonto(actual.facturado, anterior.facturado),
    cantidadVentas: compararNumero(actual.cantidadVentas, anterior.cantidadVentas),
    unidades: compararNumero(actual.unidades, anterior.unidades),
    ticketPromedio: compararMonto(actual.ticketPromedio, anterior.ticketPromedio),
    clientesNuevos: compararNumero(actual.clientesNuevos, anterior.clientesNuevos),
    comision:
      actual.comision && anterior.comision
        ? compararMonto(actual.comision.estimada, anterior.comision.estimada)
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
  /** Medio principal; null si se fió todo. */
  medioPago: MedioPago | null;
  unidades: number;
  total: string;
}

export const PAGE_SIZE_VENTAS_VENDEDOR = 25;

async function ventasDeVendedor(
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
        total: true,
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
      medioPago: v.medioPago,
      unidades: unidades.find((u) => u.ventaId === v.id)?._sum.cantidad ?? 0,
      total: aMonto(v.total),
    })),
  };
}

export interface RendimientoVendedorDetalle extends RendimientoComparado {
  ventas: { filas: VentaDeVendedor[]; total: number; page: number; pageSize: number };
}

/** Detalle de un vendedor: KPIs vs. el período anterior y todas sus ventas (paginadas). Solo dueños. */
export async function rendimientoVendedorDetalle(
  ctx: Ctx,
  usuarioId: string,
  p: Periodo,
  page = 1,
): Promise<RendimientoVendedorDetalle> {
  await exigirOwner(ctx, "El rendimiento de un vendedor");
  const pagina = Math.max(1, Math.trunc(page) || 1);
  const [rend, ventas] = await Promise.all([
    rendimientoDe(ctx, usuarioId, p),
    ventasDeVendedor(ctx, usuarioId, p, {
      skip: (pagina - 1) * PAGE_SIZE_VENTAS_VENDEDOR,
      take: PAGE_SIZE_VENTAS_VENDEDOR,
    }),
  ]);
  return { ...rend, ventas: { ...ventas, page: pagina, pageSize: PAGE_SIZE_VENTAS_VENDEDOR } };
}

/** Excel con todas las ventas del vendedor en el período (máx. 20.000). Solo dueños. */
export async function exportarVentasVendedorExcel(
  ctx: Ctx,
  usuarioId: string,
  p: Periodo,
): Promise<{ buffer: Buffer; nombre: string }> {
  await exigirOwner(ctx, "Exportar las ventas de un vendedor");
  const rend = await rendimientoDe(ctx, usuarioId, p);
  const { filas } = await ventasDeVendedor(ctx, usuarioId, p, { skip: 0, take: 20_000 });
  const libro = new ExcelJS.Workbook();
  libro.created = new Date();
  const hoja = libro.addWorksheet("Ventas", { views: [{ state: "frozen", ySplit: 1 }] });
  hoja.columns = [
    { header: "ID de venta", key: "codigo", width: 14 },
    { header: "Fecha", key: "fecha", width: 18 },
    { header: "Tipo", key: "tipo", width: 12 },
    { header: "Cliente", key: "cliente", width: 28 },
    { header: "Medio de pago", key: "medio", width: 16 },
    { header: "Unidades", key: "unidades", width: 10 },
    { header: "Total", key: "total", width: 14, style: { numFmt: '"$" #,##0.00' } },
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
      medio: etiquetaMedioPrincipal(v.medioPago),
      unidades: v.unidades,
      total: Number(v.total),
    });
  }
  const pie = hoja.addRow({
    cliente: "Total",
    unidades: rend.actual.unidades,
    total: Number(rend.actual.facturado),
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
  compras: Comparado<string>;
  cantidadCompras: Comparado<number>;
  ventas: Comparado<string>;
  /** Costo de lo vendido (Σ costoTotal). */
  costoVendido: Comparado<string>;
}

export async function comprasDelPeriodo(ctx: Ctx, p: Periodo): Promise<ComprasPeriodo> {
  await exigirOwner(ctx, "Compras vs. ventas");
  const { a, b } = rangos(p);
  const [compras, ventas] = await Promise.all([
    consultar(
      ctx,
      z.object({ actual: z.boolean(), cantidad: z.number().int(), total: montoTexto }),
      Prisma.sql`
        SELECT (c."fecha" >= ${ts(a.inicio)}) AS "actual", COUNT(*)::int AS "cantidad",
               COALESCE(SUM(c."total"), 0)::text AS "total"
        FROM "Compra" c
        WHERE c."panelId" = ${ctx.panelId} AND c."estado" = 'RECIBIDA'
          AND c."fecha" >= ${ts(b.inicio)} AND c."fecha" < ${ts(a.fin)}
        GROUP BY 1`,
    ),
    ventasActualAnterior(ctx, p),
  ]);
  const ca = compras.find((c) => c.actual);
  const cb = compras.find((c) => !c.actual);
  return {
    compras: compararMonto(ca?.total ?? "0", cb?.total ?? "0"),
    cantidadCompras: compararNumero(ca?.cantidad ?? 0, cb?.cantidad ?? 0),
    ventas: compararMonto(ventas.actual.facturado, ventas.anterior.facturado),
    costoVendido: compararMonto(ventas.actual.costo, ventas.anterior.costo),
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
  /** null = quien llama no ve el cotizador. */
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
