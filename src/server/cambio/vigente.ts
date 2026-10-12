import {
  estaDesactualizada,
  FRECUENCIA_MINUTOS_DEFAULT,
  FRECUENCIA_MINUTOS_MAX,
  FRECUENCIA_MINUTOS_MIN,
  type CotizacionVigente,
  type MonedaCambioClave,
  type TipoCotizacionCambioClave,
} from "@/lib/cambio";

/**
 * Reglas PURAS de qué cotización está vigente (testeadas sin base de datos).
 * Prioridad: override manual (mientras esté cargado) → última fila automática.
 */

/** Valor de ConfiguracionGlobal "cambio.override{MONEDA}". Pisa COMPRA y VENTA. */
export interface OverrideCambio {
  valor: number;
  usuarioId: string | null;
  usuarioNombre: string | null;
  cargadoAt: string;
}

export const claveOverride = (moneda: MonedaCambioClave) => `cambio.override${moneda}`;
export const CLAVE_FRECUENCIA = "cambio.actualizacionMinutos";
/** Fila de ConfiguracionGlobal cuyo updatedAt hace de "lease" entre instancias. */
export const CLAVE_LEASE = "cambio.lease";

export function parsearOverride(valor: unknown): OverrideCambio | null {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return null;
  const o = valor as Record<string, unknown>;
  const n = typeof o.valor === "number" ? o.valor : Number(o.valor);
  if (!Number.isFinite(n) || n <= 0) return null;
  const cargadoAt = typeof o.cargadoAt === "string" ? o.cargadoAt : new Date(0).toISOString();
  return {
    valor: n,
    usuarioId: typeof o.usuarioId === "string" ? o.usuarioId : null,
    usuarioNombre: typeof o.usuarioNombre === "string" ? o.usuarioNombre : null,
    cargadoAt,
  };
}

export function parsearFrecuencia(valor: unknown): number {
  const n = typeof valor === "number" ? valor : Number(valor);
  if (!Number.isInteger(n) || n < FRECUENCIA_MINUTOS_MIN || n > FRECUENCIA_MINUTOS_MAX)
    return FRECUENCIA_MINUTOS_DEFAULT;
  return n;
}

export interface FilaCambio {
  valor: number;
  fuente: string;
  obtenidoAt: Date;
}

export function elegirVigente(
  moneda: MonedaCambioClave,
  tipo: TipoCotizacionCambioClave,
  override: OverrideCambio | null,
  ultima: FilaCambio | null,
  ahora: Date,
): CotizacionVigente | null {
  if (override) {
    return {
      moneda,
      tipo,
      valor: override.valor,
      obtenidoAt: override.cargadoAt,
      fuente: "Manual",
      esManual: true,
      // Un valor cargado a mano es deliberado: no "se vence" solo.
      desactualizada: false,
      cargadaPor: override.usuarioNombre,
    };
  }
  if (!ultima) return null;
  return {
    moneda,
    tipo,
    valor: ultima.valor,
    obtenidoAt: ultima.obtenidoAt.toISOString(),
    fuente: ultima.fuente,
    esManual: false,
    desactualizada: estaDesactualizada(ultima.obtenidoAt, ahora),
  };
}

/** ¿Hay que refrescar? (sin datos, o la última automática es más vieja que la frecuencia). */
export function necesitaActualizar(
  ultimaObtenidaAt: Date | null,
  frecuenciaMinutos: number,
  ahora: Date,
): boolean {
  if (!ultimaObtenidaAt) return true;
  return ahora.getTime() - ultimaObtenidaAt.getTime() >= frecuenciaMinutos * 60_000;
}
