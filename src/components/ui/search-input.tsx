"use client";

import { Loader2, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useUrlParams } from "@/hooks/use-url-params";
import { cn } from "@/lib/utils";

import { controlClass } from "./field";

/**
 * Buscador con debounce (300 ms) sincronizado con un parámetro de la URL.
 * También sirve para pegar/escanear un código de barras (Enter busca ya).
 */
export function SearchInput({
  param = "q",
  placeholder = "Buscar…",
  className,
  autoFocus,
}: {
  param?: string;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}) {
  const { params, actualizar, pendiente } = useUrlParams();
  const valorUrl = params.get(param) ?? "";
  const [valor, setValor] = useState(valorUrl);
  const ultimoEnviado = useRef(valorUrl);

  // Si la URL cambia desde afuera (chips, back), reflejarlo.
  useEffect(() => {
    if (valorUrl !== ultimoEnviado.current) {
      ultimoEnviado.current = valorUrl;
      setValor(valorUrl);
    }
  }, [valorUrl]);

  useEffect(() => {
    if (valor.trim() === ultimoEnviado.current) return;
    const t = setTimeout(() => {
      ultimoEnviado.current = valor.trim();
      actualizar({ [param]: valor.trim() || null });
    }, 300);
    return () => clearTimeout(t);
  }, [valor, param, actualizar]);

  return (
    <div className={cn("relative", className)}>
      <Search
        className="text-muted pointer-events-none absolute top-1/2 left-3.5 size-[1.125rem] -translate-y-1/2"
        strokeWidth={1.75}
        aria-hidden
      />
      <input
        type="search"
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        spellCheck={false}
        autoFocus={autoFocus}
        aria-label={placeholder}
        placeholder={placeholder}
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            ultimoEnviado.current = valor.trim();
            actualizar({ [param]: valor.trim() || null });
          }
        }}
        className={cn(
          controlClass,
          "h-11 pr-11 pl-10.5 md:h-10 [&::-webkit-search-cancel-button]:hidden",
        )}
      />
      {pendiente ? (
        <Loader2
          className="text-muted absolute top-1/2 right-3.5 size-4 -translate-y-1/2 animate-spin"
          strokeWidth={1.75}
          aria-hidden
        />
      ) : (
        valor && (
          <button
            type="button"
            onClick={() => setValor("")}
            className="text-muted hover:bg-surface-2 hover:text-foreground absolute top-1/2 right-1.5 flex size-9 -translate-y-1/2 items-center justify-center rounded-control"
            aria-label="Limpiar búsqueda"
          >
            <X className="size-4" strokeWidth={1.75} aria-hidden />
          </button>
        )
      )}
    </div>
  );
}
