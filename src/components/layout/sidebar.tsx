"use client";

import { CircleHelp, PanelLeftClose, PanelLeftOpen, Store } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Avatar } from "@/components/ui/avatar";
import { esRutaActiva, GRUPOS, type ItemNavegacion } from "@/config/navigation";
import { esOwner } from "@/lib/permisos";
import { cn } from "@/lib/utils";

import { IndicadorRed } from "@/components/pwa/sincronizacion-offline";

import { Campana } from "./campana";
import { LogoutButton } from "./logout-button";
import { useUsuario } from "./usuario-context";

interface SidebarProps {
  items: ItemNavegacion[];
  colapsado: boolean;
  onToggle: () => void;
}

/** Navegación lateral (≥768px): agrupada, colapsable a solo íconos. */
export function Sidebar({ items, colapsado, onToggle }: SidebarProps) {
  const pathname = usePathname();
  const usuario = useUsuario();
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
            "flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors",
            activo
              ? "bg-primary-soft text-primary-soft-foreground"
              : "text-muted hover:bg-surface-2 hover:text-foreground",
            colapsado && "justify-center px-0",
          )}
        >
          <Icono className="size-5 shrink-0" aria-hidden />
          <span className={cn(colapsado && "sr-only")}>{item.label}</span>
        </Link>
      </li>
    );
  };

  return (
    <aside
      className={cn(
        "border-border bg-surface fixed inset-y-0 left-0 z-30 hidden flex-col border-r transition-[width] duration-200 md:flex",
        colapsado ? "w-[4.5rem]" : "w-64",
      )}
    >
      <div
        className={cn(
          "flex h-16 shrink-0 items-center gap-2 px-4",
          colapsado && "justify-center px-0",
        )}
      >
        {!colapsado && (
          <Link href="/" className="flex min-w-0 flex-1 items-center gap-2 font-semibold">
            <Store className="text-primary size-5 shrink-0" aria-hidden />
            <span className="truncate">Gestión</span>
          </Link>
        )}
        {!colapsado && <IndicadorRed className="px-1" />}
        {!colapsado && <Campana />}
        <button
          type="button"
          onClick={onToggle}
          className="text-muted hover:bg-surface-2 hover:text-foreground flex size-10 items-center justify-center rounded-lg"
          aria-label={colapsado ? "Expandir menú" : "Colapsar menú"}
          aria-expanded={!colapsado}
        >
          {colapsado ? <PanelLeftOpen className="size-5" /> : <PanelLeftClose className="size-5" />}
        </button>
      </div>

      <nav aria-label="Menú lateral" className="flex-1 overflow-y-auto px-3 pb-3">
        <ul className="flex flex-col gap-0.5">{sueltos.map(renderItem)}</ul>
        {GRUPOS.map((grupo) => {
          const delGrupo = items.filter((i) => i.grupo === grupo);
          if (delGrupo.length === 0) return null;
          return (
            <div key={grupo} className="mt-5">
              {colapsado ? (
                <div className="border-border mx-3 mb-2 border-t" aria-hidden />
              ) : (
                <p className="text-muted/80 mb-1.5 px-3 text-xs font-semibold tracking-wide uppercase">
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

      <div className="border-border flex shrink-0 flex-col gap-1 border-t p-3">
        <Link
          href="/cuenta"
          title={colapsado ? "Mi cuenta" : undefined}
          className={cn(
            "hover:bg-surface-2 flex min-h-11 items-center gap-3 rounded-lg px-2 py-1.5",
            colapsado && "justify-center px-0",
          )}
        >
          <Avatar nombre={usuario.nombre} />
          {!colapsado && (
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium">{usuario.nombre}</span>
              <span className="text-muted truncate text-xs">
                {esOwner(usuario) ? "Dueño" : "Empleado"}
              </span>
            </span>
          )}
        </Link>
        <Link
          href="/ayuda"
          title={colapsado ? "Ayuda" : undefined}
          className={cn(
            "hover:bg-surface-2 text-muted flex min-h-11 items-center gap-3 rounded-lg px-2 text-sm font-medium",
            colapsado && "justify-center px-0",
          )}
        >
          <CircleHelp className="size-5 shrink-0" aria-hidden />
          <span className={cn(colapsado && "sr-only")}>Ayuda</span>
        </Link>
        <LogoutButton compacto={colapsado} />
      </div>
    </aside>
  );
}
