"use client";

import { Loader2, Search } from "lucide-react";
import { useEffect, useRef, useState, type Ref } from "react";

import { controlClass } from "@/components/ui/field";
import { formatearPesos } from "@/lib/format";
import { cn } from "@/lib/utils";

import { buscarProductosPosAction, type VariantePos } from "../actions";

/**
 * Búsqueda manual por producto, sabor, SKU con stock del depósito y precio.
 * (Los códigos de barras los resuelve el escáner, con o sin foco acá.)
 */
export function BuscadorPos({
  depositoId,
  enCarrito,
  onElegir,
  inputRef,
}: {
  depositoId: string;
  enCarrito: ReadonlyMap<string, number>;
  onElegir: (v: VariantePos) => void;
  inputRef?: Ref<HTMLInputElement>;
}) {
  const [q, setQ] = useState("");
  const [resultados, setResultados] = useState<VariantePos[]>([]);
  const [buscando, setBuscando] = useState(false);
  const ultima = useRef(0);

  useEffect(() => {
    const texto = q.trim();
    if (texto.length < 2) {
      setResultados([]);
      return;
    }
    const n = ++ultima.current;
    const t = setTimeout(async () => {
      setBuscando(true);
      const r = await buscarProductosPosAction({ q: texto, depositoId });
      if (n !== ultima.current) return; // llegó una búsqueda más nueva
      setBuscando(false);
      if (r.ok) setResultados(r.data);
    }, 250);
    return () => clearTimeout(t);
  }, [q, depositoId]);

  return (
    <div className="relative">
      <Search
        strokeWidth={1.75}
        className="text-muted pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
        aria-hidden
      />
      <input
        ref={inputRef}
        type="search"
        aria-label="Buscar producto"
        placeholder="Buscar por producto, sabor o SKU (F2)"
        autoComplete="off"
        className={cn(controlClass, "h-11 pr-9 pl-9")}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setQ("");
          if (e.key === "Enter" && resultados.length === 1) {
            e.preventDefault();
            onElegir(resultados[0]!);
            setQ("");
          }
        }}
      />
      {buscando && (
        <Loader2
          strokeWidth={1.75}
          className="text-muted absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin"
          aria-hidden
        />
      )}
      {q.trim().length >= 2 && !buscando && (
        <ul
          aria-label="Resultados"
          className="border-border bg-surface absolute inset-x-0 top-full z-30 mt-1 max-h-80 overflow-y-auto rounded-xl border p-1 shadow-lg"
        >
          {resultados.length === 0 && (
            <li className="text-muted px-3 py-3 text-sm">Sin resultados para “{q.trim()}”.</li>
          )}
          {resultados.map((v) => {
            const quedan = v.stock - (enCarrito.get(v.varianteId) ?? 0);
            return (
              <li key={v.varianteId}>
                <button
                  type="button"
                  disabled={quedan <= 0}
                  onClick={() => {
                    onElegir(v);
                    setQ("");
                  }}
                  className="hover:bg-surface-2 flex min-h-12 w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left disabled:opacity-50"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{v.nombreCompleto}</span>
                    <span className="text-muted block text-xs">{v.sku}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-sm font-semibold tabular-nums">
                      {formatearPesos(v.precioVenta)}
                    </span>
                    <span className={cn("text-xs", quedan <= 0 ? "text-danger" : "text-muted")}>
                      {quedan <= 0 ? "sin stock" : `${quedan} en stock`}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
