import {
  esDiaISO,
  PERIODO_LABEL,
  PERIODOS,
  rangoDePeriodo,
  type DiaISO,
  type Periodo,
  type Rango,
} from "@/lib/zona-horaria";

/**
 * Filtros de dashboard y reportes, SIEMPRE en la URL (compartible, sobrevive
 * al refresh): periodo, desde, hasta, deposito, categoria, vendedor,
 * diferencia, variante, producto.
 */
export interface ParametrosReporte {
  periodo: Periodo;
  rango: Rango;
  depositoId?: string;
  categoriaId?: string;
  usuarioId?: string;
  varianteId?: string;
  productoId?: string;
  soloConDiferencia: boolean;
}

type SP = Record<string, string | string[] | undefined> | URLSearchParams;

function leer(sp: SP, clave: string): string | undefined {
  const v = sp instanceof URLSearchParams ? sp.get(clave) : sp[clave];
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.trim() ? s.trim().slice(0, 100) : undefined;
}

export function parametrosDesdeUrl(
  sp: SP,
  hoy: DiaISO,
  porDefecto: Periodo = "mes",
): ParametrosReporte {
  const p = leer(sp, "periodo");
  const desde = leer(sp, "desde");
  const hasta = leer(sp, "hasta");
  const periodo: Periodo = (PERIODOS as readonly string[]).includes(p ?? "")
    ? (p as Periodo)
    : esDiaISO(desde) || esDiaISO(hasta)
      ? "personalizado"
      : porDefecto;
  return {
    periodo,
    rango: rangoDePeriodo(periodo, hoy, { desde, hasta }),
    depositoId: leer(sp, "deposito"),
    categoriaId: leer(sp, "categoria"),
    usuarioId: leer(sp, "vendedor"),
    varianteId: leer(sp, "variante"),
    productoId: leer(sp, "producto"),
    soloConDiferencia: leer(sp, "diferencia") === "1",
  };
}

/** Query string equivalente (para los links de exportación). */
export function queryDeParametros(p: ParametrosReporte): string {
  const q = new URLSearchParams();
  q.set("periodo", p.periodo);
  if (p.periodo === "personalizado") {
    q.set("desde", p.rango.desde);
    q.set("hasta", p.rango.hasta);
  }
  if (p.depositoId) q.set("deposito", p.depositoId);
  if (p.categoriaId) q.set("categoria", p.categoriaId);
  if (p.usuarioId) q.set("vendedor", p.usuarioId);
  if (p.varianteId) q.set("variante", p.varianteId);
  if (p.productoId) q.set("producto", p.productoId);
  if (p.soloConDiferencia) q.set("diferencia", "1");
  return q.toString();
}

const dmy = (d: DiaISO) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

export function etiquetaRango(p: Pick<ParametrosReporte, "periodo" | "rango">): string {
  const r = p.rango;
  const fechas = r.desde === r.hasta ? dmy(r.desde) : `${dmy(r.desde)} al ${dmy(r.hasta)}`;
  return p.periodo === "personalizado" ? fechas : `${PERIODO_LABEL[p.periodo]} (${fechas})`;
}
