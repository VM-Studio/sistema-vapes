"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { esRutaActiva, GRUPOS, type ItemNavegacion } from "@/config/navigation";
import { cn } from "@/lib/utils";

interface SidebarProps {
  items: ItemNavegacion[];
  colapsado: boolean;
  onToggle: () => void;
}

/**
 * Navegación lateral (≥768px), debajo de la barra superior: 240px, fondo
 * blanco, ítems ícono + texto, activo sobre gris clarito con una línea azul
 * fina a la izquierda (única excepción del azul fuera de los gráficos).
 * Colapsable a solo íconos.
 */
export function Sidebar({ items, colapsado, onToggle }: SidebarProps) {
  const pathname = usePathname();
  const sueltos = items.filter((i) => i.grupo === null);

  const renderItem = (item: ItemNavegacion) => {
    const activo = esRutaActiva(item.base ?? item.href, pathname);
    const Icono = item.icon;
    return (
      <li key={item.href}>
        <Link
          href={item.href}
          aria-current={activo ? "page" : undefined}
          title={colapsado ? item.label : undefined}
          className={cn(
            "relative flex h-10 items-center gap-3 rounded-control px-3 text-sm font-medium transition-colors",
            activo
              ? "bg-card text-foreground before:bg-marca-azul before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-circle"
              : "text-muted hover:bg-surface-2/70 hover:text-foreground",
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
        "top-[calc(3.5rem+env(safe-area-inset-top))]",
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
                <p className="text-subtle mb-1 px-3 text-xs font-medium">{grupo}</p>
              )}
              <ul className="flex flex-col gap-0.5" aria-label={grupo}>
                {delGrupo.map(renderItem)}
              </ul>
            </div>
          );
        })}
      </nav>

      <div className="border-border shrink-0 border-t p-3">
        <button
          type="button"
          onClick={onToggle}
          className={cn(
            "text-subtle hover:bg-surface-2 hover:text-foreground flex h-9 w-full items-center gap-3 rounded-control px-3 text-xs font-medium",
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
      </div>
    </aside>
  );
}
