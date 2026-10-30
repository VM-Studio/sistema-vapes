import { pesosAMoneda, type CostosFinales } from "@/lib/costos-compra";
import { formatearDolares, formatearNumero, formatearPesos } from "@/lib/format";
import { cn } from "@/lib/utils";

import { textoUsdt, type CotizacionResumen } from "./resumen-compra-card";

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
 * (parejos), = costo final por unidad y subtotal final.
 *
 * Todo EN USDT (moneda de Compras): `costos` y `finalesUsdt` ya vienen
 * calculados en USDT (vistaCostosUsdt / calcularCostosCompraUsdt, la misma
 * función que usa el servidor). Solo «= Final u.» muestra además el costo
 * en pesos (`finalesPesos`: el que guarda la compra y toman las ventas) y en
 * dólares (esos pesos ÷ dólar blue de la compra).
 */
export function CostoFinalPorUnidad({
  items,
  costos,
  finalesUsdt,
  finalesPesos,
  aproximado = false,
  cotizacionUsd,
  className,
}: {
  items: ItemCostoFinalVista[];
  /** En USDT. */
  costos: CostosFinales;
  /** Costo final por unidad de cada ítem en USDT (mismo orden que `items`). */
  finalesUsdt: number[];
  /** Costo final por unidad de cada ítem en pesos (null = sin cotización para pasarlo). */
  finalesPesos: (number | null)[];
  /** Compra anterior cargada en pesos: los USDT son equivalentes. */
  aproximado?: boolean;
  /** Dólar blue (pesos por dólar) para el costo final en dólares; null = no se muestra. */
  cotizacionUsd: CotizacionResumen | null;
  className?: string;
}) {
  const usdt = (n: number) => textoUsdt(n, aproximado);
  const filas = items.map((it, n) => {
    const c = costos.items[n]!;
    const final = finalesUsdt[n] ?? c.costoUnitarioFinal;
    const pesos = finalesPesos[n] ?? null;
    return {
      it,
      c,
      final,
      pesos,
      dolares: pesos !== null && cotizacionUsd ? pesosAMoneda(pesos, cotizacionUsd.valor) : null,
      // A centavos de USDT: cantidad × final exacto.
      subtotalFinal: (Math.round(final * 100) * c.cantidad) / 100,
    };
  });
  // Agrupar por modelo, en el orden en que aparece cada uno.
  const grupos = new Map<string, typeof filas>();
  for (const x of filas) {
    const g = grupos.get(x.it.nombreCompleto) ?? [];
    g.push(x);
    grupos.set(x.it.nombreCompleto, g);
  }
  const totalFinal = filas.reduce((a, x) => a + Math.round(x.subtotalFinal * 100), 0) / 100;
  const pct = costos.comisionPorcentaje;
  const columnas =
    "md:grid-cols-[minmax(0,1fr)_4rem_7rem_7rem_7rem_9rem_8.5rem] md:items-center md:gap-3";

  return (
    <section
      aria-label="Costo final por unidad"
      className={cn("bg-card rounded-card flex flex-col gap-4 p-5 md:p-6", className)}
      data-testid="costo-final-por-unidad"
    >
      <header className="flex flex-col gap-1">
        <h2 className="text-h3 font-semibold">Costo final por unidad</h2>
        <p className="text-muted text-small">
          En USDT. Cada modelo y sabor con su propio costo: precio unitario
          {pct !== null ? ` + ${formatearNumero(pct)}% de pasista sobre ese precio` : ""} + gastos
          extras ÷ {formatearNumero(costos.unidades)} unidades ({usdt(costos.gastosPorUnidad)} c/u).
          El pasista se lleva más en los modelos más caros; los gastos son iguales para todas las
          unidades. El costo final también está en dólares
          {cotizacionUsd ? ` (blue ${formatearPesos(cotizacionUsd.valor)})` : ""} y en pesos: es el
          que toman las ventas para calcular la ganancia.
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
            {[...grupos.entries()].map(([modelo, filasModelo]) => (
              <li key={modelo} className="flex flex-col">
                <p className="px-4 pt-3 text-sm font-semibold">{modelo}</p>
                <ul aria-label={modelo} className="flex flex-col">
                  {filasModelo.map(({ it, c, final, pesos, dolares, subtotalFinal }) => (
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
                      <Celda label="Precio unitario">{usdt(c.costoUnitario)}</Celda>
                      <Celda label="Pasista por unidad">
                        {pct === null ? "—" : `+ ${usdt(c.comisionPorUnidad)}`}
                      </Celda>
                      <Celda label="Gastos por unidad">
                        {c.gastosPorUnidad > 0 ? `+ ${usdt(c.gastosPorUnidad)}` : "—"}
                      </Celda>
                      <Celda label="Costo final por unidad" fuerte>
                        <span aria-label={`Costo final por unidad de ${tituloItem(it)}`}>
                          {usdt(final)}
                        </span>
                        {dolares !== null && (
                          <span
                            className="text-muted block text-xs font-normal"
                            aria-label={`En dólares: ${formatearDolares(dolares)}`}
                            data-testid="final-dolares"
                          >
                            {formatearDolares(dolares)}
                          </span>
                        )}
                        {pesos !== null && (
                          <span
                            className="text-muted block text-xs font-normal"
                            aria-label={`En pesos: ${formatearPesos(pesos)}`}
                            data-testid="final-pesos"
                          >
                            {formatearPesos(pesos)}
                          </span>
                        )}
                        {c.ajustePorUnidad !== 0 && !aproximado && (
                          <span className="text-subtle block text-xs font-normal">
                            incl. {c.ajustePorUnidad > 0 ? "+" : "−"}
                            {textoUsdt(Math.abs(c.ajustePorUnidad))} de redondeo
                          </span>
                        )}
                      </Celda>
                      <Celda label="Subtotal final">{usdt(subtotalFinal)}</Celda>
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
            <strong className="text-right tabular-nums" aria-label="Suma de costos finales">
              {usdt(totalFinal)}
            </strong>
          </div>
        </div>
      )}
      {aproximado && (
        <p className="text-warning-soft-foreground text-small">
          Compra cargada en pesos (antes de que Compras pasara a USDT): los USDT son equivalentes
          con su cotización; el costo en pesos es el guardado.
        </p>
      )}
      {!aproximado && costos.diferenciaRedondeo !== 0 && (
        <p className="text-subtle text-small">
          Diferencia de redondeo no repartible: {textoUsdt(costos.diferenciaRedondeo)}.
        </p>
      )}
    </section>
  );
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
