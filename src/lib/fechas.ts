/**
 * Rangos de fechas en hora de Argentina (UTC-3, sin horario de verano).
 * "Hoy" es el día calendario argentino aunque el servidor esté en UTC.
 */
const OFFSET = "-03:00";
const TZ = "America/Argentina/Buenos_Aires";

/** "YYYY-MM-DD" del día actual en Argentina. */
export function hoyAR(ahora = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(ahora);
}

export function inicioDelDia(fecha: string): Date {
  return new Date(`${fecha}T00:00:00.000${OFFSET}`);
}

export function finDelDia(fecha: string): Date {
  return new Date(`${fecha}T23:59:59.999${OFFSET}`);
}

function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00${OFFSET}`);
  d.setUTCDate(d.getUTCDate() + dias);
  return hoyAR(d);
}

export const RANGOS = ["hoy", "ayer", "semana", "mes"] as const;
export type Rango = (typeof RANGOS)[number];

export const RANGO_LABEL: Record<Rango, string> = {
  hoy: "Hoy",
  ayer: "Ayer",
  semana: "Esta semana",
  mes: "Este mes",
};

/** Rango preset -> { desde, hasta } como "YYYY-MM-DD" (semana: desde el lunes). */
export function fechasDeRango(rango: Rango, ahora = new Date()): { desde: string; hasta: string } {
  const hoy = hoyAR(ahora);
  switch (rango) {
    case "hoy":
      return { desde: hoy, hasta: hoy };
    case "ayer": {
      const ayer = sumarDias(hoy, -1);
      return { desde: ayer, hasta: ayer };
    }
    case "semana": {
      const diaSemana = new Date(`${hoy}T12:00:00${OFFSET}`).getUTCDay(); // 0 = domingo
      return { desde: sumarDias(hoy, -((diaSemana + 6) % 7)), hasta: hoy };
    }
    case "mes":
      return { desde: `${hoy.slice(0, 8)}01`, hasta: hoy };
  }
}

export const esFechaISO = (s: unknown): s is string =>
  typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
