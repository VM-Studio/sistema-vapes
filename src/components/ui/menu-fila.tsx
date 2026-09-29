"use client";

import { Ellipsis, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

export interface AccionFila {
  label: string;
  icon?: LucideIcon;
  href?: string;
  onSelect?: () => void;
  peligro?: boolean;
}

/** Menú "…" de acciones al final de una fila de tabla (o de una card mobile). */
export function MenuFila({
  acciones,
  label = "Acciones",
}: {
  acciones: AccionFila[];
  label?: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto) return;
    const cerrar = (e: MouseEvent | KeyboardEvent) => {
      if (
        e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)
      )
        setAbierto(false);
    };
    document.addEventListener("mousedown", cerrar);
    document.addEventListener("keydown", cerrar);
    return () => {
      document.removeEventListener("mousedown", cerrar);
      document.removeEventListener("keydown", cerrar);
    };
  }, [abierto]);

  const claseItem = (peligro?: boolean) =>
    cn(
      "flex min-h-10 w-full items-center gap-2.5 rounded-inner px-2.5 text-left text-sm transition-colors hover:bg-surface-2",
      peligro ? "text-danger" : "text-foreground",
    );

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={abierto}
        onClick={() => setAbierto((a) => !a)}
        className="text-muted hover:bg-surface-2 hover:text-foreground flex size-9 items-center justify-center rounded-control"
      >
        <Ellipsis className="size-5" strokeWidth={1.75} aria-hidden />
      </button>
      {abierto && (
        <div
          role="menu"
          className="bg-surface shadow-pop border-border absolute top-[calc(100%+4px)] right-0 z-40 min-w-44 rounded-control border p-1"
        >
          {acciones.map((a) => {
            const Icono = a.icon;
            const cuerpo = (
              <>
                {Icono && <Icono className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />}
                {a.label}
              </>
            );
            return a.href ? (
              <Link
                key={a.label}
                role="menuitem"
                href={a.href}
                className={claseItem(a.peligro)}
                onClick={() => setAbierto(false)}
              >
                {cuerpo}
              </Link>
            ) : (
              <button
                key={a.label}
                role="menuitem"
                type="button"
                className={claseItem(a.peligro)}
                onClick={() => {
                  setAbierto(false);
                  a.onSelect?.();
                }}
              >
                {cuerpo}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
