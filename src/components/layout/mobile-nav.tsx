"use client";

import { CircleHelp, Ellipsis, LayoutGrid, UserRound } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { buttonVariants } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { esRutaActiva, type ItemNavegacion } from "@/config/navigation";
import { useRutaOptimista } from "@/hooks/use-ruta-optimista";
import { cn } from "@/lib/utils";

import { IndicadorRed } from "@/components/pwa/sincronizacion-offline";

import { LogoPanel } from "./logo-panel";
import { LogoutButton } from "./logout-button";
import { MenuUsuario } from "./menu-usuario";
import { usePanelOpcional, useRutaPanel } from "./panel-context";

function LinkInicioPanel() {
  const panel = usePanelOpcional();
  const ruta = useRutaPanel();
  if (!panel) return null;
  return (
    <Link
      href={ruta()}
      className="flex min-w-0 items-center"
      aria-label={`Inicio de ${panel.nombre}`}
    >
      {/* Solo el logo (sin el nombre al lado); sin logo, LogoPanel muestra el nombre. */}
      <LogoPanel panel={panel} size={44} sizeMd={52} />
    </Link>
  );
}

/**
 * Barra superior del panel (mobile y desktop): logo del panel a la izquierda;
 * a la derecha estado de red, "Cambiar de sistema" y el avatar con su menú.
 */
export function TopBar({
  restringido = false,
  conRed = true,
}: {
  restringido?: boolean;
  /** Indicador de red (necesita la sincronización offline del panel). */
  conRed?: boolean;
}) {
  const panel = usePanelOpcional();

  return (
    <header className="pt-safe pl-safe pr-safe border-border bg-surface fixed inset-x-0 top-0 z-30 border-b">
      <div className="flex h-14 items-center justify-between gap-3 px-4 md:h-16 md:px-6">
        {panel ? <LinkInicioPanel /> : <span />}
        <div className="flex items-center gap-1 md:gap-2">
          {!restringido && panel && conRed && <IndicadorRed />}
          {!restringido && (
            <Link
              href="/paneles"
              className={cn(
                buttonVariants({ variant: "secondary", size: "sm" }),
                "hidden md:inline-flex",
              )}
            >
              <LayoutGrid strokeWidth={1.75} aria-hidden />
              Cambiar de sistema
            </Link>
          )}
          <MenuUsuario restringido={restringido} conCambiarSistema mostrarNombre />
        </div>
      </div>
    </header>
  );
}

/**
 * Bottom navigation fija (mobile): hasta 4 módulos marcados `enBottomBar` +
 * "Más", que abre un sheet con el resto de los módulos permitidos.
 */
export function BottomNav({ items }: { items: ItemNavegacion[] }) {
  // Activo al instante al tocar, sin esperar la respuesta del servidor.
  const { ruta: pathname, marcar } = useRutaOptimista();
  const [masAbierto, setMasAbierto] = useState(false);

  const enOrden = [...items].sort((a, b) => a.ordenMobile - b.ordenMobile);
  const principales = enOrden.filter((i) => i.enBottomBar).slice(0, 4);
  const resto = enOrden.filter((i) => !principales.includes(i));
  const masActivo =
    resto.some((i) => esRutaActiva(i.base ?? i.href, pathname)) ||
    esRutaActiva("/cuenta", pathname);

  const claseItem = (activo: boolean) =>
    cn(
      "flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors",
      activo ? "text-foreground [&>svg]:text-marca-azul" : "text-subtle",
    );
  const claseLink =
    "hover:bg-surface-3/60 flex min-h-12 items-center gap-3 rounded-control px-3 text-sm font-medium";

  return (
    <>
      <nav
        aria-label="Navegación inferior"
        className="pb-safe pl-safe pr-safe border-border bg-surface fixed inset-x-0 bottom-0 z-30 border-t md:hidden"
      >
        <ul className="flex">
          {principales.map((item) => {
            const activo = esRutaActiva(item.base ?? item.href, pathname);
            const Icono = item.icon;
            return (
              <li key={item.href} className="flex flex-1">
                <Link
                  href={item.href}
                  onClick={marcar(item.href)}
                  aria-current={activo ? "page" : undefined}
                  className={claseItem(activo)}
                >
                  <Icono className="size-6" aria-hidden strokeWidth={activo ? 2 : 1.75} />
                  {item.label}
                </Link>
              </li>
            );
          })}
          <li className="flex flex-1">
            <button
              type="button"
              onClick={() => setMasAbierto(true)}
              className={claseItem(masActivo)}
              aria-haspopup="dialog"
              aria-expanded={masAbierto}
            >
              <Ellipsis className="size-6" strokeWidth={1.75} aria-hidden />
              Más
            </button>
          </li>
        </ul>
      </nav>

      <Sheet open={masAbierto} onOpenChange={setMasAbierto} title="Más opciones">
        {resto.length > 0 && (
          <ul className="grid grid-cols-3 gap-2">
            {resto.map((item) => {
              const activo = esRutaActiva(item.base ?? item.href, pathname);
              const Icono = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={(e) => {
                      marcar(item.href)(e);
                      setMasAbierto(false);
                    }}
                    aria-current={activo ? "page" : undefined}
                    className={cn(
                      "rounded-control flex min-h-20 flex-col items-center justify-center gap-1.5 px-1 text-center text-xs font-medium transition-colors",
                      activo
                        ? "bg-foreground text-background"
                        : "bg-surface text-foreground hover:bg-surface-3/60",
                    )}
                  >
                    <Icono className="size-6" strokeWidth={1.75} aria-hidden />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        <div className="border-border mt-4 flex flex-col gap-1 border-t pt-3">
          <Link href="/paneles" onClick={() => setMasAbierto(false)} className={claseLink}>
            <LayoutGrid className="text-muted size-5" strokeWidth={1.75} aria-hidden />
            Cambiar de sistema
          </Link>
          <Link href="/cuenta" onClick={() => setMasAbierto(false)} className={claseLink}>
            <UserRound className="text-muted size-5" strokeWidth={1.75} aria-hidden />
            Mi cuenta
          </Link>
          <Link href="/ayuda" onClick={() => setMasAbierto(false)} className={claseLink}>
            <CircleHelp className="text-muted size-5" strokeWidth={1.75} aria-hidden />
            Ayuda
          </Link>
          <LogoutButton className="min-h-12" />
        </div>
      </Sheet>
    </>
  );
}
