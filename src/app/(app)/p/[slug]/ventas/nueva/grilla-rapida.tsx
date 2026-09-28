"use client";

import { Package } from "lucide-react";
import { useState } from "react";

import { Sheet } from "@/components/ui/sheet";
import { formatearPesos } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ProductoRapido } from "@/server/services/venta.service";

type VarianteRapida = ProductoRapido["variantes"][number];

/**
 * Los 12 más vendidos (30 días) para vender sin escanear. Un producto con
 * varios sabores abre un Sheet para elegir cuál (con su stock).
 */
export function GrillaRapida({
  productos,
  enCarrito,
  onElegir,
}: {
  productos: ProductoRapido[];
  enCarrito: ReadonlyMap<string, number>;
  onElegir: (v: VarianteRapida) => void;
}) {
  const [abierto, setAbierto] = useState<ProductoRapido | null>(null);
  if (productos.length === 0) return null;

  const precioDesde = (p: ProductoRapido) =>
    Math.min(...p.variantes.map((v) => Number(v.precioVenta)));
  const stockTotal = (p: ProductoRapido) => p.variantes.reduce((a, v) => a + v.stock, 0);

  return (
    <section aria-label="Más vendidos">
      <h2 className="text-muted mb-2 text-xs font-semibold tracking-wide uppercase">
        Más vendidos
      </h2>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
        {productos.map((p) => {
          const stock = stockTotal(p);
          const unica = p.variantes.length === 1 ? p.variantes[0]! : null;
          return (
            <li key={p.id}>
              <button
                type="button"
                disabled={stock === 0}
                onClick={() => (unica ? onElegir(unica) : setAbierto(p))}
                className="border-border bg-surface hover:border-primary/50 flex h-full min-h-20 w-full flex-col items-start justify-between gap-1 rounded-xl border p-3 text-left transition-colors disabled:opacity-50"
              >
                <span className="line-clamp-2 text-sm leading-tight font-medium">{p.nombre}</span>
                <span className="flex w-full items-end justify-between gap-1 text-xs">
                  <span className="font-semibold tabular-nums">
                    {p.variantes.length > 1 && "desde "}
                    {formatearPesos(precioDesde(p))}
                  </span>
                  <span className={cn("text-muted", stock === 0 && "text-danger")}>
                    {stock === 0 ? "sin stock" : `${stock} u.`}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <Sheet
        open={abierto !== null}
        onOpenChange={(o) => !o && setAbierto(null)}
        title={abierto?.nombre ?? ""}
        description="Elegí el sabor"
      >
        <ul aria-label="Sabores" className="flex flex-col gap-2">
          {abierto?.variantes.map((v) => {
            const quedan = v.stock - (enCarrito.get(v.varianteId) ?? 0);
            return (
              <li key={v.varianteId}>
                <button
                  type="button"
                  disabled={quedan <= 0}
                  onClick={() => {
                    onElegir(v);
                    setAbierto(null);
                  }}
                  className="border-border hover:bg-surface-2 flex min-h-14 w-full items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left disabled:opacity-50"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Package
                      strokeWidth={1.75}
                      className="text-muted size-4 shrink-0"
                      aria-hidden
                    />
                    <span className="truncate font-medium">{v.sabor ?? abierto.nombre}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block font-semibold tabular-nums">
                      {formatearPesos(v.precioVenta)}
                    </span>
                    <span className={cn("text-xs", quedan <= 0 ? "text-danger" : "text-muted")}>
                      {quedan <= 0 ? "sin stock" : `${quedan} disponibles`}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </Sheet>
    </section>
  );
}
