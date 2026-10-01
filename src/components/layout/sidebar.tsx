"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import Link from "next/link";

import { esRutaActiva, GRUPOS, type ItemNavegacion } from "@/config/navigation";
import { useRutaOptimista } from "@/hooks/use-ruta-optimista";
import { cn } from "@/lib/utils";

interface SidebarProps {
  items: ItemNavegacion[];
  colapsado: boolean;
  onToggle: () => void;
}

/**
 * Navegación lateral (≥768px), debajo de la barra superior: 240px, fondo
 * blanco, ítems ícono + texto; activo sobre un velo azul transparente, con el
 * ícono en azul y una línea azul fina a la izquierda. Al pie, el osito en azul
 * tenue. Colapsable a solo íconos.
 */
export function Sidebar({ items, colapsado, onToggle }: SidebarProps) {
  // Activo al instante al tocar, sin esperar la respuesta del servidor.
  const { ruta: pathname, marcar } = useRutaOptimista();
  const sueltos = items.filter((i) => i.grupo === null);

  const renderItem = (item: ItemNavegacion) => {
    const activo = esRutaActiva(item.base ?? item.href, pathname);
    const Icono = item.icon;
    return (
      <li key={item.href}>
        <Link
          href={item.href}
          onClick={marcar(item.href)}
          aria-current={activo ? "page" : undefined}
          title={colapsado ? item.label : undefined}
          className={cn(
            "rounded-control relative flex h-10 items-center gap-3 px-3 text-sm font-medium transition-colors",
            activo
              ? "bg-azul-velo-2 text-marca-azul before:bg-marca-azul before:rounded-circle font-semibold before:absolute before:inset-y-2 before:left-0 before:w-[3px]"
              : "text-muted hover:bg-azul-velo-1 hover:text-foreground",
            colapsado && "justify-center px-0",
          )}
        >
          <Icono className="size-5 shrink-0" strokeWidth={1.75} aria-hidden />
          <span className={cn("truncate", colapsado && "sr-only")}>{item.label}</span>
        </Link>
      </li>
    );
  };

  return (
    <aside
      className={cn(
        "border-border bg-surface fixed bottom-0 left-0 z-20 hidden flex-col border-r transition-[width] duration-200 md:flex",
        "top-[calc(4rem+env(safe-area-inset-top))]",
        colapsado ? "w-16" : "w-60",
      )}
    >
      <nav aria-label="Menú lateral" className="flex-1 overflow-y-auto px-3 pt-4 pb-3">
        <ul className="flex flex-col gap-0.5">{sueltos.map(renderItem)}</ul>
        {GRUPOS.map((grupo) => {
          const delGrupo = items.filter((i) => i.grupo === grupo);
          if (delGrupo.length === 0) return null;
          return (
            <div key={grupo} className="mt-6">
              {colapsado ? (
                <div className="border-border mx-2 mb-2 border-t" aria-hidden />
              ) : (
                <p className="text-subtle mb-1.5 px-3 text-[0.6875rem] font-semibold tracking-[0.08em] uppercase">
                  {grupo}
                </p>
              )}
              <ul className="flex flex-col gap-0.5" aria-label={grupo}>
                {delGrupo.map(renderItem)}
              </ul>
            </div>
          );
        })}
      </nav>

      <div className="border-border flex shrink-0 items-center gap-2 border-t p-3">
        <button
          type="button"
          onClick={onToggle}
          className={cn(
            "text-subtle hover:bg-azul-velo-1 hover:text-foreground rounded-control flex h-9 w-full min-w-0 flex-1 items-center gap-3 px-3 text-xs font-medium",
            colapsado && "justify-center px-0",
          )}
          aria-label={colapsado ? "Expandir menú" : "Colapsar menú"}
          aria-expanded={!colapsado}
        >
          {colapsado ? (
            <PanelLeftOpen className="size-5" strokeWidth={1.75} />
          ) : (
            <PanelLeftClose className="size-5" strokeWidth={1.75} />
          )}
          {!colapsado && "Colapsar menú"}
        </button>
        {!colapsado && (
          <div aria-hidden className="marca-agua text-marca-azul size-7 shrink-0 opacity-25" />
        )}
      </div>
    </aside>
  );
}
