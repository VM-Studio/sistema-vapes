"use client";

import { useEffect, useState } from "react";

import { Sheet } from "@/components/ui/sheet";
import { formatearPesos } from "@/lib/format";
import type { TablaPreciosProducto } from "@/server/services/escalon.service";

import { tablaPreciosAction } from "./actions";

const ORIGEN: Record<TablaPreciosProducto["origen"], string> = {
  PROPIOS: "Escalones propios del producto",
  DEFAULT: "Escalones por defecto del panel (% sobre la lista)",
  LISTA: "Sin escalones: siempre precio de lista",
};

/** "Ver tabla de precios": lista + cada escalón con su precio resultante. */
export function TablaPreciosSheet({
  productoId,
  onCerrar,
}: {
  productoId: string | null;
  onCerrar: () => void;
}) {
  const [tabla, setTabla] = useState<TablaPreciosProducto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!productoId) return;
    let vigente = true;
    setTabla(null);
    setError(null);
    void tablaPreciosAction({ productoId }).then((r) => {
      if (!vigente) return;
      if (r.ok) setTabla(r.data);
      else setError(r.error.message);
    });
    return () => {
      vigente = false;
    };
  }, [productoId]);

  return (
    <Sheet
      open={productoId !== null}
      onOpenChange={(o) => !o && onCerrar()}
      title={tabla?.nombreCompleto ?? "Tabla de precios"}
      description={tabla ? ORIGEN[tabla.origen] : undefined}
    >
      {error ? (
        <p role="alert" className="text-danger text-sm">
          {error}
        </p>
      ) : !tabla ? (
        <div className="bg-surface-2 h-40 animate-pulse rounded-card" />
      ) : (
        <div className="flex flex-col gap-5">
          <table className="w-full text-sm" data-testid="tabla-precios">
            <thead>
              <tr className="text-muted border-border border-b text-left text-xs">
                <th className="py-2 font-medium">Desde</th>
                <th className="py-2 text-right font-medium">Precio c/u</th>
                <th className="py-2 text-right font-medium">Descuento</th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y tabular-nums">
              <tr>
                <td className="py-2">1 u. (lista)</td>
                <td className="py-2 text-right font-medium">{formatearPesos(tabla.precioLista)}</td>
                <td className="text-muted py-2 text-right">—</td>
              </tr>
              {tabla.escalones.map((e) => (
                <tr key={e.cantidadMinima}>
                  <td className="py-2">{e.cantidadMinima} u.</td>
                  <td className="text-primary py-2 text-right font-semibold">
                    {formatearPesos(e.precioUnitario)}
                  </td>
                  <td className="text-muted py-2 text-right">
                    −{Number(e.descuento).toLocaleString("es-AR")} %
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {tabla.saboresConPrecioPropio.length > 0 && (
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">Sabores con precio propio</h3>
              <ul className="flex flex-col gap-2 text-sm">
                {tabla.saboresConPrecioPropio.map((s) => (
                  <li key={s.varianteId} className="bg-surface-2 rounded-control p-3">
                    <p className="font-medium">
                      {s.sabor ?? tabla.nombreCompleto} · lista {formatearPesos(s.precioLista)}
                    </p>
                    {s.escalones.length > 0 && (
                      <p className="text-muted text-xs tabular-nums">
                        {s.escalones
                          .map(
                            (e) => `${e.cantidadMinima} u. → ${formatearPesos(e.precioUnitario)}`,
                          )
                          .join(" · ")}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </Sheet>
  );
}
