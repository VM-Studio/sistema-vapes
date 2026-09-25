"use client";

import { Loader2, Search } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { buscarVariantesAction } from "@/app/(app)/movimientos/actions";
import { controlClass } from "@/components/ui/field";
import { formatearPesos } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { VarianteBuscada } from "@/server/services/producto.service";

export type { VarianteBuscada };

interface VariantePickerProps {
  onSelect: (v: VarianteBuscada) => void;
  /** Para mostrar/filtrar el stock de ese depósito. */
  depositoId?: string;
  soloConStock?: boolean;
  /** Variantes ya agregadas (se muestran marcadas). */
  yaAgregadas?: ReadonlySet<string>;
  placeholder?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  id?: string;
  className?: string;
}

const pareceCodigo = (q: string) => /^[0-9A-Za-z-]{4,64}$/.test(q) && /\d/.test(q);

/**
 * Buscador de variantes por nombre, sabor, SKU o código de barras.
 * Pensado para la pistola lectora (keyboard wedge): escribe el código + Enter;
 * si hay una sola coincidencia se agrega directo y el foco queda en el input
 * para el siguiente escaneo.
 */
export function VariantePicker({
  onSelect,
  depositoId,
  soloConStock,
  yaAgregadas,
  placeholder = "Buscar por nombre, sabor, SKU o código…",
  autoFocus,
  disabled,
  id,
  className,
}: VariantePickerProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const listaId = `${inputId}-lista`;
  const [q, setQ] = useState("");
  const [resultados, setResultados] = useState<VarianteBuscada[]>([]);
  const [abierto, setAbierto] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [resaltado, setResaltado] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pedido = useRef(0);
  const enterPendiente = useRef(false);

  async function buscar(texto: string) {
    const n = ++pedido.current;
    setCargando(true);
    const r = await buscarVariantesAction({
      q: texto,
      depositoId,
      soloConStockEnDeposito: soloConStock,
    });
    if (n !== pedido.current) return; // llegó una búsqueda más nueva
    setCargando(false);
    if (!r.ok) {
      setError(r.error.message);
      setResultados([]);
      return;
    }
    setError(null);
    setResultados(r.data);
    setResaltado(0);
    setAbierto(true);
    if (enterPendiente.current) {
      enterPendiente.current = false;
      if (r.data.length === 1) elegir(r.data[0]!);
    }
  }

  useEffect(() => {
    const texto = q.trim();
    if (texto.length < 2) {
      setResultados([]);
      setAbierto(false);
      return;
    }
    const t = setTimeout(() => void buscar(texto), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- buscar depende de q/depositoId, que ya están acá
  }, [q, depositoId, soloConStock]);

  function elegir(v: VarianteBuscada) {
    onSelect(v);
    setQ("");
    setResultados([]);
    setAbierto(false);
    inputRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setAbierto(true);
      setResaltado((i) => Math.min(i + 1, resultados.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setResaltado((i) => Math.max(i - 1, 0));
    } else if (e.key === "Escape") {
      setAbierto(false);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const texto = q.trim();
      if (abierto && resultados[resaltado] && !cargando) {
        elegir(resultados[resaltado]!);
      } else if (pareceCodigo(texto)) {
        // Escaneo: buscar ya (sin esperar el debounce) y agregar si hay una sola coincidencia.
        enterPendiente.current = true;
        void buscar(texto);
      }
    }
  }

  const stockDe = (v: VarianteBuscada) => (depositoId ? v.stockDeposito : v.stockTotal) ?? 0;

  return (
    <div className={cn("relative", className)}>
      <Search
        className="text-muted pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
        aria-hidden
      />
      <input
        ref={inputRef}
        id={inputId}
        type="search"
        role="combobox"
        aria-expanded={abierto}
        aria-controls={listaId}
        aria-autocomplete="list"
        aria-activedescendant={
          abierto && resultados[resaltado] ? `${listaId}-${resaltado}` : undefined
        }
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
        autoFocus={autoFocus}
        disabled={disabled}
        placeholder={placeholder}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => resultados.length > 0 && setAbierto(true)}
        onBlur={() => setTimeout(() => setAbierto(false), 150)}
        className={cn(controlClass, "h-11 pr-10 pl-9 [&::-webkit-search-cancel-button]:hidden")}
      />
      {cargando && (
        <Loader2
          className="text-muted absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin"
          aria-hidden
        />
      )}
      {error && <p className="text-danger mt-1 text-sm">{error}</p>}
      {abierto && (
        <ul
          id={listaId}
          role="listbox"
          className="border-border bg-surface absolute inset-x-0 top-full z-20 mt-1 max-h-80 overflow-y-auto rounded-xl border p-1 shadow-lg"
        >
          {resultados.length === 0 ? (
            <li className="text-muted px-3 py-3 text-sm">Sin resultados para “{q.trim()}”.</li>
          ) : (
            resultados.map((v, i) => {
              const agregada = yaAgregadas?.has(v.id);
              return (
                <li
                  key={v.id}
                  id={`${listaId}-${i}`}
                  role="option"
                  aria-selected={i === resaltado}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    elegir(v);
                  }}
                  onMouseEnter={() => setResaltado(i)}
                  className={cn(
                    "flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2",
                    i === resaltado && "bg-surface-2",
                  )}
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium">
                      {v.nombreCompleto}
                      {agregada && (
                        <span className="text-primary ml-2 text-xs font-normal">(ya agregado)</span>
                      )}
                    </span>
                    <span className="text-muted truncate text-xs">
                      {v.sku}
                      {v.codigoBarras ? ` · ${v.codigoBarras}` : ""} ·{" "}
                      {formatearPesos(v.precioVenta)}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "shrink-0 text-right text-xs tabular-nums",
                      stockDe(v) === 0 ? "text-danger" : "text-muted",
                    )}
                  >
                    <span className="text-foreground block text-sm font-semibold">
                      {stockDe(v)}
                    </span>
                    {depositoId ? "en depósito" : "en total"}
                  </span>
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}
