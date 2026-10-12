import type { MonedaCambioClave, TipoCotizacionCambioClave } from "@/lib/cambio";

/**
 * Fuentes públicas de cotizaciones y sus parsers (PUROS: reciben el JSON ya
 * descargado). Formas verificadas el 11/10/2026 (fixtures en tests/fixtures/cambio/):
 *
 * - dolarapi.com/v1/dolares/blue y /v1/dolares/cripto:
 *     { moneda: "USD", casa: "blue" | "cripto", nombre, compra: number, venta: number,
 *       fechaActualizacion: ISO }
 * - criptoya.com/api/dolar:
 *     { oficial: {...}, blue: { ask, bid, variation, timestamp },
 *       cripto: { ccb: {...}, usdt: { ask, bid, variation, timestamp }, usdc: {...} }, mep, ccl, ... }
 *     ask = lo que cobra el mercado por vender la moneda (= VENTA), bid = COMPRA.
 * - criptoya.com/api/usdt/ars/1 (precio por 1 USDT, con comisiones):
 *     { [exchange]: { ask, totalAsk, bid, totalBid, time } }  (algunos con ask 0: sin oferta)
 *
 * Si una API cambia de forma, el parser lanza ErrorFormatoFuente con el
 * detalle; el servicio lo loguea, prueba la fuente siguiente y, si ninguna
 * responde, queda vigente la última cotización válida.
 */

export class ErrorFormatoFuente extends Error {
  constructor(fuente: string, detalle: string) {
    super(`Formato inesperado de ${fuente}: ${detalle}`);
    this.name = "ErrorFormatoFuente";
  }
}

export type ValoresCotizacion = Partial<Record<TipoCotizacionCambioClave, number>> & {
  VENTA: number;
};

export interface FuenteCotizacion {
  /** Nombre que se guarda en TipoCambio.fuente. */
  id: string;
  url: string;
  parsear(json: unknown): ValoresCotizacion;
}

function objeto(v: unknown, fuente: string, ruta: string): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new ErrorFormatoFuente(fuente, `falta el objeto "${ruta}"`);
  return v as Record<string, unknown>;
}

function numero(v: unknown, fuente: string, ruta: string): number {
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0)
    throw new ErrorFormatoFuente(fuente, `"${ruta}" no es un número positivo (${String(v)})`);
  return n;
}

function numeroOpcional(v: unknown): number | undefined {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : undefined;
}

function conCompra(venta: number, compra: number | undefined): ValoresCotizacion {
  return compra === undefined ? { VENTA: venta } : { VENTA: venta, COMPRA: compra };
}

/** dolarapi.com: { compra, venta }. */
export function parsearDolarApi(json: unknown, fuente: string): ValoresCotizacion {
  const o = objeto(json, fuente, "raíz");
  return conCompra(numero(o.venta, fuente, "venta"), numeroOpcional(o.compra));
}

/** criptoya.com/api/dolar → blue: { ask, bid }. */
export function parsearCriptoyaBlue(json: unknown, fuente: string): ValoresCotizacion {
  const blue = objeto(objeto(json, fuente, "raíz").blue, fuente, "blue");
  return conCompra(numero(blue.ask, fuente, "blue.ask"), numeroOpcional(blue.bid));
}

/** criptoya.com/api/dolar → cripto.usdt: { ask, bid }. */
export function parsearCriptoyaDolarUsdt(json: unknown, fuente: string): ValoresCotizacion {
  const cripto = objeto(objeto(json, fuente, "raíz").cripto, fuente, "cripto");
  const usdt = objeto(cripto.usdt, fuente, "cripto.usdt");
  return conCompra(numero(usdt.ask, fuente, "cripto.usdt.ask"), numeroOpcional(usdt.bid));
}

/** Exchanges "principales" que se promedian en /api/usdt/ars/1 (los que estén y tengan oferta). */
export const EXCHANGES_USDT = [
  "binance",
  "binancep2p",
  "lemoncash",
  "belo",
  "fiwind",
  "letsbit",
  "ripio",
  "bybitp2p",
  "okexp2p",
] as const;

function promedio(valores: number[]): number | undefined {
  if (valores.length === 0) return undefined;
  return Math.round((valores.reduce((a, b) => a + b, 0) / valores.length) * 100) / 100;
}

/** criptoya.com/api/usdt/ars/1: promedio de totalAsk (VENTA) y totalBid (COMPRA). */
export function parsearCriptoyaUsdtArs(json: unknown, fuente: string): ValoresCotizacion {
  const o = objeto(json, fuente, "raíz");
  const asks: number[] = [];
  const bids: number[] = [];
  for (const ex of EXCHANGES_USDT) {
    const fila = o[ex];
    if (!fila || typeof fila !== "object") continue;
    const f = fila as Record<string, unknown>;
    const ask = numeroOpcional(f.totalAsk);
    const bid = numeroOpcional(f.totalBid);
    if (ask !== undefined) asks.push(ask);
    if (bid !== undefined) bids.push(bid);
  }
  const venta = promedio(asks);
  if (venta === undefined)
    throw new ErrorFormatoFuente(
      fuente,
      `ningún exchange principal con totalAsk (${EXCHANGES_USDT.join(", ")})`,
    );
  return conCompra(venta, promedio(bids));
}

/** Fuentes por moneda, en orden de preferencia (la primera que responde y valida gana). */
export const FUENTES: Record<MonedaCambioClave, readonly FuenteCotizacion[]> = {
  USD_BLUE: [
    {
      id: "dolarapi.com/blue",
      url: "https://dolarapi.com/v1/dolares/blue",
      parsear: (j) => parsearDolarApi(j, "dolarapi.com/blue"),
    },
    {
      id: "criptoya.com/dolar",
      url: "https://criptoya.com/api/dolar",
      parsear: (j) => parsearCriptoyaBlue(j, "criptoya.com/dolar"),
    },
  ],
  USDT: [
    {
      id: "criptoya.com/dolar",
      url: "https://criptoya.com/api/dolar",
      parsear: (j) => parsearCriptoyaDolarUsdt(j, "criptoya.com/dolar"),
    },
    {
      id: "criptoya.com/usdt",
      url: "https://criptoya.com/api/usdt/ars/1",
      parsear: (j) => parsearCriptoyaUsdtArs(j, "criptoya.com/usdt"),
    },
    {
      id: "dolarapi.com/cripto",
      url: "https://dolarapi.com/v1/dolares/cripto",
      parsear: (j) => parsearDolarApi(j, "dolarapi.com/cripto"),
    },
  ],
};

/** Rango válido respecto de la cotización anterior: > 0 y menos de 10× (en cualquier sentido). */
export const FACTOR_RANGO = 10;

export function validarRango(valor: number, anterior: number | null): string | null {
  if (!Number.isFinite(valor) || valor <= 0) return `valor no positivo (${valor})`;
  if (anterior && anterior > 0) {
    if (valor >= anterior * FACTOR_RANGO)
      return `valor ${valor} fuera de rango: ${FACTOR_RANGO}× o más que el anterior (${anterior})`;
    if (valor <= anterior / FACTOR_RANGO)
      return `valor ${valor} fuera de rango: ${FACTOR_RANGO} veces menor que el anterior (${anterior})`;
  }
  return null;
}

export interface IntentoFuente {
  fuente: string;
  error: string;
}

export type ResultadoResolucion =
  | { ok: true; fuente: string; valores: ValoresCotizacion; intentos: IntentoFuente[] }
  | { ok: false; intentos: IntentoFuente[] };

/**
 * Prueba las fuentes en orden con `descargar` (inyectable: en los tests es un
 * fixture; en el servicio, fetch con timeout y caché por corrida). La primera
 * que responde, parsea y pasa la validación de rango gana.
 */
export async function resolverCotizacion(
  fuentes: readonly FuenteCotizacion[],
  descargar: (url: string) => Promise<unknown>,
  anteriorVenta: number | null,
): Promise<ResultadoResolucion> {
  const intentos: IntentoFuente[] = [];
  for (const fuente of fuentes) {
    try {
      const valores = fuente.parsear(await descargar(fuente.url));
      const fuera = validarRango(valores.VENTA, anteriorVenta);
      if (fuera) {
        intentos.push({ fuente: fuente.id, error: fuera });
        continue;
      }
      if (valores.COMPRA !== undefined && validarRango(valores.COMPRA, valores.VENTA))
        delete valores.COMPRA;
      return { ok: true, fuente: fuente.id, valores, intentos };
    } catch (e) {
      intentos.push({ fuente: fuente.id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { ok: false, intentos };
}
