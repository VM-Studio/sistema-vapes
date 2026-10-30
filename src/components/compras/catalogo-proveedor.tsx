"use client";

import { ChevronDown, ChevronRight, Package, Search } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { controlClass } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { formatearMonto, formatearNumero, formatearUsdt } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ProductoCatalogoCompra } from "@/server/services/compra.service";

/** Sin buscar, en el celular se muestran estos y un "Ver todos". */
const VISIBLES_MOBILE = 5;

/**
 * Catálogo del proveedor elegido en el paso Ítems de la compra: los productos
 * que vende con su precio en USDT (si el proveedor lo tiene en pesos, su
 * equivalente en USDT, que es lo que se precarga como costo). Buscable; tocar uno abre la hoja para
 * elegir sabores y cantidades (`onElegir`). `enCompra` = unidades ya
 * cargadas por producto.
 */
export function CatalogoProveedor({
  proveedor,
  productos,
  enCompra,
  onElegir,
}: {
  proveedor: string;
  /** null = cargando. */
  productos: ProductoCatalogoCompra[] | null;
  enCompra: Map<string, number>;
  onElegir: (p: ProductoCatalogoCompra) => void;
}) {
  const [filtro, setFiltro] = useState("");
  const [abierto, setAbierto] = useState(true);
  const [todos, setTodos] = useState(false);

  const palabras = filtro.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const visibles = (productos ?? []).filter((p) => {
    const texto = `${p.nombreCompleto} ${p.sabores.map((s) => s.sabor ?? "").join(" ")}`;
    return palabras.every((w) => texto.toLowerCase().includes(w));
  });
  const recortar = !todos && palabras.length === 0 && visibles.length > VISIBLES_MOBILE;

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <button
          type="button"
          onClick={() => setAbierto((a) => !a)}
          aria-expanded={abierto}
          aria-controls="catalogo-proveedor"
          className="rounded-control -m-1 flex items-center justify-between gap-3 p-1 text-left"
        >
          <span className="flex min-w-0 flex-col">
            <span className="text-h3 font-semibold">Lo que vende {proveedor}</span>
            <span className="text-muted text-small">
              {productos === null
                ? "Cargando sus productos…"
                : productos.length === 0
                  ? "Todavía no tiene productos cargados."
                  : `${formatearNumero(productos.length)} ${productos.length === 1 ? "producto" : "productos"} con su precio · tocá uno para agregarlo`}
            </span>
          </span>
          <ChevronDown
            className={cn(
              "text-muted size-5 shrink-0 transition-transform",
              abierto && "rotate-180",
            )}
            strokeWidth={1.75}
            aria-hidden
          />
        </button>

        {abierto && (
          <div id="catalogo-proveedor" className="flex flex-col gap-3">
            {productos === null ? (
              <div className="flex flex-col gap-2" aria-hidden>
                <Skeleton className="h-11" />
                <Skeleton className="h-14" />
                <Skeleton className="h-14" />
              </div>
            ) : productos.length === 0 ? (
              <p className="text-muted bg-surface rounded-control p-3 text-sm">
                Cargá los productos que vende y su precio en la ficha del proveedor: la próxima
                compra los vas a tener acá. Mientras, escaneá o buscá la mercadería.
              </p>
            ) : (
              <>
                {productos.length > 3 && (
                  <div className="relative">
                    <Search
                      className="text-muted pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
                      strokeWidth={1.75}
                      aria-hidden
                    />
                    <input
                      type="search"
                      aria-label={`Buscar en lo que vende ${proveedor}`}
                      placeholder="Filtrar sus productos o sabores"
                      value={filtro}
                      onChange={(e) => setFiltro(e.target.value)}
                      className={cn(controlClass, "h-11 pl-9 md:h-10")}
                    />
                  </div>
                )}
                {visibles.length === 0 ? (
                  <p className="text-muted px-1 text-sm">
                    Ninguno de sus productos coincide con «{filtro.trim()}».
                  </p>
                ) : (
                  <ul
                    aria-label={`Productos de ${proveedor}`}
                    className="border-border divide-border rounded-control flex flex-col divide-y overflow-hidden border md:max-h-[26rem] md:overflow-y-auto"
                  >
                    {visibles.map((p, i) => {
                      const unidades = enCompra.get(p.productoId) ?? 0;
                      const sabores = p.sabores.filter((s) => s.sabor !== null).length;
                      return (
                        <li
                          key={p.productoId}
                          className={cn(recortar && i >= VISIBLES_MOBILE && "max-md:hidden")}
                        >
                          <button
                            type="button"
                            onClick={() => onElegir(p)}
                            aria-label={`Agregar ${p.nombreCompleto}`}
                            className="hover:bg-surface flex min-h-14 w-full items-center gap-3 px-3 py-2.5 text-left transition-colors"
                          >
                            <span className="bg-surface text-muted rounded-control flex size-9 shrink-0 items-center justify-center">
                              <Package className="size-4" strokeWidth={1.75} aria-hidden />
                            </span>
                            <span className="flex min-w-0 flex-1 flex-col">
                              <span className="line-clamp-2 font-medium">{p.nombreCompleto}</span>
                              <span className="text-subtle flex flex-wrap items-center gap-x-1.5 text-xs">
                                {sabores > 0
                                  ? `${sabores} ${sabores === 1 ? "sabor" : "sabores"}`
                                  : "Sin sabores"}
                                {unidades > 0 && (
                                  <Badge variant="primary" className="h-5">
                                    {formatearNumero(unidades)} u. en la compra
                                  </Badge>
                                )}
                              </span>
                            </span>
                            <span className="flex shrink-0 flex-col items-end">
                              <span
                                className="font-semibold tabular-nums"
                                data-testid="precio-catalogo"
                              >
                                {p.moneda === "USDT"
                                  ? formatearUsdt(p.precio)
                                  : p.costoUsdt
                                    ? `≈ ${formatearUsdt(p.costoUsdt)}`
                                    : "sin cotización"}
                              </span>
                              {p.moneda !== "USDT" && (
                                <span className="text-subtle text-xs tabular-nums">
                                  precio en pesos: {formatearMonto(p.precio, p.moneda)}
                                </span>
                              )}
                            </span>
                            <ChevronRight
                              className="text-subtle size-4 shrink-0"
                              strokeWidth={1.75}
                              aria-hidden
                            />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {recortar && (
                  <button
                    type="button"
                    onClick={() => setTodos(true)}
                    className="text-small text-foreground self-start font-medium underline underline-offset-4 md:hidden"
                  >
                    Ver los {formatearNumero(visibles.length)} productos
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
