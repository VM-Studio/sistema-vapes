import type { CostosFinales } from "@/lib/costos-compra";
import { formatearNumero, formatearPesos, formatearUsdt } from "@/lib/format";
import { cn } from "@/lib/utils";

import { EnUsdt, pesosAUsdt, type CotizacionResumen } from "./resumen-compra-card";

export interface ItemCostoFinalVista {
  key: string;
  /** "Marca Modelo Pitadas" (Producto.nombreCompleto). */
  nombreCompleto: string;
  /** null = sabor "Único". */
  sabor: string | null;
}

/**
 * «Costo final por unidad»: TODOS los ítems de la compra (marca · modelo ·
 * pitadas · sabor), agrupados por modelo, con cantidad, precio unitario,
 * + pasista por unidad (proporcional al precio), + gastos por unidad
 * (parejos), = costo final por unidad y subtotal final. Los números salen de
 * `calcularCostosFinales` (la misma función que usa el servidor).
 *
 * `finalesGuardados` (detalle de una compra): si el costo final guardado de
 * algún ítem no coincide con el calculado (compra recibida antes de A4, con
 * el recargo parejo), se muestra el guardado y se avisa.
 */
export function CostoFinalPorUnidad({
  items,
  costos,
  finalesGuardados,
  cotizacion,
  className,
}: {
  items: ItemCostoFinalVista[];
  costos: CostosFinales;
  finalesGuardados?: string[];
  /** Para el equivalente en USDT debajo de cada monto (null = solo pesos). */
  cotizacion: CotizacionResumen | null;
  className?: string;
}) {
  const usdt = (pesos: number, prefijo?: string) => (
    <EnUsdt pesos={pesos} cotizacion={cotizacion} prefijo={prefijo} />
  );
  const conGuardado = items.map((it, n) => {
    const c = costos.items[n]!;
    const guardado = finalesGuardados?.[n] !== undefined ? Number(finalesGuardados[n]) : null;
    const final = guardado ?? c.costoUnitarioFinal;
    return {
      it,
      c,
      final,
      subtotalFinal: final * c.cantidad,
      distinto: guardado !== null && guardado !== c.costoUnitarioFinal,
    };
  });
  const criterioAnterior = conGuardado.some((x) => x.distinto);
  // Agrupar por modelo, en el orden en que aparece cada uno.
  const grupos = new Map<string, typeof conGuardado>();
  for (const x of conGuardado) {
    const g = grupos.get(x.it.nombreCompleto) ?? [];
    g.push(x);
    grupos.set(x.it.nombreCompleto, g);
  }
  const totalFinal = conGuardado.reduce((a, x) => a + Math.round(x.subtotalFinal * 100), 0) / 100;
  const pct = costos.comisionPorcentaje;
  const columnas =
    "md:grid-cols-[minmax(0,1fr)_4rem_7rem_7rem_7rem_8rem_8.5rem] md:items-center md:gap-3";

  return (
    <section
      aria-label="Costo final por unidad"
      className={cn("bg-card rounded-card flex flex-col gap-4 p-5 md:p-6", className)}
      data-testid="costo-final-por-unidad"
    >
      <header className="flex flex-col gap-1">
        <h2 className="text-h3 font-semibold">Costo final por unidad</h2>
        <p className="text-muted text-small">
          Cada modelo y sabor con su propio costo: precio unitario
          {pct !== null ? ` + ${formatearNumero(pct)}% de pasista sobre ese precio` : ""} + gastos
          extras ÷ {formatearNumero(costos.unidades)} unidades (
          {formatearPesos(costos.gastosPorUnidad)} c/u
          {pesosUsdtTexto(costos.gastosPorUnidad, cotizacion)}). El pasista se lleva más en los
          modelos más caros; los gastos son iguales para todas las unidades.
        </p>
      </header>

      {items.length === 0 ? (
        <p className="text-muted text-small">Agregá productos para ver el costo de cada uno.</p>
      ) : (
        <div className="border-border bg-surface rounded-card overflow-hidden border">
          <div
            aria-hidden
            className={cn(
              "border-border bg-card text-muted hidden h-10 border-b px-4 text-xs font-medium md:grid",
              columnas,
            )}
          >
            <span>Producto</span>
            <span className="text-right">Cant.</span>
            <span className="text-right">Precio u.</span>
            <span className="text-right">+ Pasista u.</span>
            <span className="text-right">+ Gastos u.</span>
            <span className="text-right">= Final u.</span>
            <span className="text-right">Subtotal final</span>
          </div>
          <ul className="divide-border flex flex-col divide-y">
            {[...grupos.entries()].map(([modelo, filas]) => (
              <li key={modelo} className="flex flex-col">
                <p className="px-4 pt-3 text-sm font-semibold">{modelo}</p>
                <ul aria-label={modelo} className="flex flex-col">
                  {filas.map(({ it, c, final, subtotalFinal, distinto }) => (
                    <li
                      key={it.key}
                      data-testid="fila-costo-final"
                      className={cn(
                        "grid grid-cols-2 gap-x-3 gap-y-1 px-4 py-2.5 text-sm",
                        columnas,
                      )}
                    >
                      <span className="text-muted col-span-2 min-w-0 truncate md:col-span-1">
                        {it.sabor ?? "Único"}
                      </span>
                      <Celda label="Cantidad">{formatearNumero(c.cantidad)}</Celda>
                      <Celda label="Precio unitario">
                        {formatearPesos(c.costoUnitario)}
                        {usdt(c.costoUnitario)}
                      </Celda>
                      <Celda label="Pasista por unidad">
                        {pct === null ? (
                          "—"
                        ) : (
                          <>
                            + {formatearPesos(c.comisionPorUnidad)}
                            {usdt(c.comisionPorUnidad, "+ ")}
                          </>
                        )}
                      </Celda>
                      <Celda label="Gastos por unidad">
                        {c.gastosPorUnidad > 0 ? (
                          <>
                            + {formatearPesos(c.gastosPorUnidad)}
                            {usdt(c.gastosPorUnidad, "+ ")}
                          </>
                        ) : (
                          "—"
                        )}
                      </Celda>
                      <Celda label="Costo final por unidad" fuerte>
                        <span aria-label={`Costo final por unidad de ${tituloItem(it)}`}>
                          {formatearPesos(final)}
                        </span>
                        {usdt(final)}
                        {c.ajustePorUnidad !== 0 && !distinto && (
                          <span className="text-subtle block text-xs font-normal">
                            incl. {c.ajustePorUnidad > 0 ? "+" : "−"}
                            {formatearPesos(Math.abs(c.ajustePorUnidad))} de redondeo
                          </span>
                        )}
                        {distinto && (
                          <span className="text-subtle block text-xs font-normal">
                            hoy daría {formatearPesos(c.costoUnitarioFinal)}
                          </span>
                        )}
                      </Celda>
                      <Celda label="Subtotal final">
                        {formatearPesos(subtotalFinal)}
                        {usdt(subtotalFinal)}
                      </Celda>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          <div
            className={cn(
              "border-border bg-card flex items-baseline justify-between gap-3 border-t px-4 py-3 text-sm md:grid",
              columnas,
            )}
          >
            <span className="font-semibold md:col-span-6">Suma de costos finales</span>
            <span className="text-right">
              <strong className="tabular-nums" aria-label="Suma de costos finales">
                {formatearPesos(totalFinal)}
              </strong>
              {usdt(totalFinal)}
            </span>
          </div>
        </div>
      )}
      {criterioAnterior && (
        <p className="text-warning-soft-foreground text-small">
          Esta compra se recibió con el criterio anterior (recargo parejo por unidad): se muestra el
          costo final guardado. Se actualiza al nuevo cálculo cuando cambies la comisión o los
          gastos.
        </p>
      )}
      {!criterioAnterior && costos.descuento > 0 && (
        <p className="text-subtle text-small">
          El descuento se aplica a la comisión del pasista; el precio unitario se muestra sin
          descuento.
        </p>
      )}
      {!criterioAnterior && costos.diferenciaRedondeo !== 0 && (
        <p className="text-subtle text-small">
          Diferencia de redondeo no repartible: {formatearPesos(costos.diferenciaRedondeo)}.
        </p>
      )}
    </section>
  );
}

/** " ≈ 1,20 USDT" para meter en un texto (vacío sin cotización). */
function pesosUsdtTexto(pesos: number, cotizacion: CotizacionResumen | null): string {
  const u = pesosAUsdt(pesos, cotizacion);
  return u === null ? "" : ` ≈ ${formatearUsdt(u)}`;
}

const tituloItem = (i: ItemCostoFinalVista) =>
  i.sabor ? `${i.nombreCompleto} — ${i.sabor}` : i.nombreCompleto;

function Celda({
  label,
  children,
  fuerte = false,
}: {
  label: string;
  children: React.ReactNode;
  fuerte?: boolean;
}) {
  return (
    <span className="flex items-baseline justify-between gap-2 md:block md:text-right">
      <span className="text-subtle text-xs md:hidden">{label}</span>
      <span className={cn("flex flex-col items-end tabular-nums", fuerte && "font-semibold")}>
        {children}
      </span>
    </span>
  );
}
