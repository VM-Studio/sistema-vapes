import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

/**
 * Días calendario en la zona horaria del negocio (Configuracion.timezone).
 * Los timestamps se guardan en UTC: "el 3 de marzo" en Buenos Aires es
 * [03-03 03:00 UTC, 03-04 03:00 UTC). Nunca se corta un día en UTC crudo.
 */
export const ZONA_DEFAULT = "America/Argentina/Buenos_Aires";

export type DiaISO = string; // "YYYY-MM-DD"

export const esDiaISO = (s: unknown): s is DiaISO =>
  typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(parseISO(s).getTime());

/** Día calendario (en `tz`) de un instante. */
export function diaEn(instante: Date, tz: string): DiaISO {
  return formatInTimeZone(instante, tz, "yyyy-MM-dd");
}

/** Hora (0-23) en `tz`. */
export function horaEn(instante: Date, tz: string): number {
  return Number(formatInTimeZone(instante, tz, "H"));
}

export function sumarDias(dia: DiaISO, n: number): DiaISO {
  return format(addDays(parseISO(dia), n), "yyyy-MM-dd");
}

/** Cantidad de días del rango, ambos extremos incluidos. */
export function diasEntre(desde: DiaISO, hasta: DiaISO): number {
  return differenceInCalendarDays(parseISO(hasta), parseISO(desde)) + 1;
}

/** Instante UTC en que empieza `dia` en `tz`. */
export function inicioDia(dia: DiaISO, tz: string): Date {
  return fromZonedTime(`${dia}T00:00:00.000`, tz);
}

/**
 * Límites UTC de [desde, hasta] (días completos en `tz`): `inicio` incluido,
 * `fin` EXCLUIDO (= inicio del día siguiente a `hasta`). Para `>= inicio AND < fin`.
 */
export function limitesRango(
  desde: DiaISO,
  hasta: DiaISO,
  tz: string,
): { inicio: Date; fin: Date } {
  return { inicio: inicioDia(desde, tz), fin: inicioDia(sumarDias(hasta, 1), tz) };
}

/** El período anterior equivalente: misma cantidad de días, inmediatamente antes. */
export function periodoAnterior(desde: DiaISO, hasta: DiaISO): { desde: DiaISO; hasta: DiaISO } {
  const n = diasEntre(desde, hasta);
  return { desde: sumarDias(desde, -n), hasta: sumarDias(desde, -1) };
}

// -----------------------------------------------------------------------------
// Presets del selector de período (dashboard y reportes)
// -----------------------------------------------------------------------------

export const PERIODOS = [
  "hoy",
  "ayer",
  "7d",
  "30d",
  "mes",
  "mes-anterior",
  "personalizado",
] as const;
export type Periodo = (typeof PERIODOS)[number];

/** Los del selector del dashboard (los reportes suman "30 días"). */
export const PERIODOS_DASHBOARD: readonly Periodo[] = [
  "hoy",
  "ayer",
  "7d",
  "mes",
  "mes-anterior",
  "personalizado",
];

export const PERIODO_LABEL: Record<Periodo, string> = {
  hoy: "Hoy",
  ayer: "Ayer",
  "7d": "7 días",
  "30d": "30 días",
  mes: "Este mes",
  "mes-anterior": "Mes anterior",
  personalizado: "Personalizado",
};

export interface Rango {
  desde: DiaISO;
  hasta: DiaISO;
}

/**
 * Preset → días. "Mes anterior" se compara con el mes anterior a él (mismo
 * largo en días: ver periodoAnterior). "Personalizado" usa desde/hasta.
 */
export function rangoDePeriodo(
  periodo: Periodo,
  hoy: DiaISO,
  personalizado?: Partial<Rango>,
): Rango {
  switch (periodo) {
    case "hoy":
      return { desde: hoy, hasta: hoy };
    case "ayer":
      return { desde: sumarDias(hoy, -1), hasta: sumarDias(hoy, -1) };
    case "7d":
      return { desde: sumarDias(hoy, -6), hasta: hoy };
    case "30d":
      return { desde: sumarDias(hoy, -29), hasta: hoy };
    case "mes":
      return { desde: `${hoy.slice(0, 8)}01`, hasta: hoy };
    case "mes-anterior": {
      const primero = `${hoy.slice(0, 8)}01`;
      const fin = sumarDias(primero, -1);
      return { desde: `${fin.slice(0, 8)}01`, hasta: fin };
    }
    case "personalizado": {
      const desde = esDiaISO(personalizado?.desde) ? personalizado.desde : `${hoy.slice(0, 8)}01`;
      const hasta = esDiaISO(personalizado?.hasta) ? personalizado.hasta : hoy;
      return desde <= hasta ? { desde, hasta } : { desde: hasta, hasta: desde };
    }
  }
}

/** Comparación "mes contra mes": para un mes calendario completo, el mes anterior completo. */
export function rangoComparable(r: Rango): Rango {
  const esMesCompleto =
    r.desde.endsWith("-01") &&
    sumarDias(r.hasta, 1).endsWith("-01") &&
    r.desde.slice(0, 7) === r.hasta.slice(0, 7);
  if (esMesCompleto) {
    const fin = sumarDias(r.desde, -1);
    return { desde: `${fin.slice(0, 8)}01`, hasta: fin };
  }
  // "Este mes" (1 → hoy) contra el mismo tramo del mes anterior.
  if (r.desde.endsWith("-01") && r.desde.slice(0, 7) === r.hasta.slice(0, 7)) {
    const finMesAnterior = sumarDias(r.desde, -1);
    const inicio = `${finMesAnterior.slice(0, 8)}01`;
    const n = diasEntre(r.desde, r.hasta);
    const hasta = sumarDias(inicio, n - 1);
    return { desde: inicio, hasta: hasta > finMesAnterior ? finMesAnterior : hasta };
  }
  return periodoAnterior(r.desde, r.hasta);
}
