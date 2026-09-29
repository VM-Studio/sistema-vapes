"use client";

import { Loader2, Search } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { controlClass } from "@/components/ui/field";
import type { ActionResult } from "@/lib/action-result";
import { cn } from "@/lib/utils";

/**
 * Combobox con búsqueda en el servidor (debounce 250 ms, desde 2 letras).
 * Teclado: ↑/↓ recorre, Enter elige, Escape cierra.
 */
export function BuscadorRemoto<T>({
  buscar,
  onSelect,
  getKey,
  render,
  placeholder,
  ariaLabel,
  autoFocus,
  className,
}: {
  buscar: (q: string) => Promise<ActionResult<T[]>>;
  onSelect: (item: T) => void;
  getKey: (item: T) => string;
  render: (item: T) => ReactNode;
  placeholder: string;
  ariaLabel: string;
  autoFocus?: boolean;
  className?: string;
}) {
  const listaId = `${useId()}-lista`;
  const [q, setQ] = useState("");
  const [resultados, setResultados] = useState<T[]>([]);
  const [abierto, setAbierto] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [resaltado, setResaltado] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pedido = useRef(0);
  const buscarRef = useRef(buscar);
  buscarRef.current = buscar;

  useEffect(() => {
    const texto = q.trim();
    if (texto.length < 2) {
      setResultados([]);
      setAbierto(false);
      return;
    }
    const t = setTimeout(async () => {
      const n = ++pedido.current;
      setCargando(true);
      const r = await buscarRef.current(texto);
      if (n !== pedido.current) return;
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
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  function elegir(item: T) {
    onSelect(item);
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
      const item = resultados[resaltado];
      if (abierto && item && !cargando) elegir(item);
    }
  }

  return (
    <div className={cn("relative", className)}>
      <Search
        className="text-muted pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
        strokeWidth={1.75}
        aria-hidden
      />
      <input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-label={ariaLabel}
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
          className="border-border bg-surface rounded-control shadow-pop absolute inset-x-0 top-full z-30 mt-1 max-h-72 overflow-y-auto border p-1"
        >
          {resultados.length === 0 ? (
            <li className="text-muted px-3 py-3 text-sm">Sin resultados para “{q.trim()}”.</li>
          ) : (
            resultados.map((item, i) => (
              <li
                key={getKey(item)}
                id={`${listaId}-${i}`}
                role="option"
                aria-selected={i === resaltado}
                onMouseDown={(e) => {
                  e.preventDefault();
                  elegir(item);
                }}
                onMouseEnter={() => setResaltado(i)}
                className={cn(
                  "rounded-control flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm",
                  i === resaltado && "bg-surface-2",
                )}
              >
                {render(item)}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
