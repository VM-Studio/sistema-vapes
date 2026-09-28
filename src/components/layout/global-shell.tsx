"use client";

import { CircleHelp, LayoutGrid, Settings, UserCog } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { Avatar } from "@/components/ui/avatar";
import { esRutaActiva } from "@/config/navigation";
import { esOwner } from "@/lib/permisos";
import { cn } from "@/lib/utils";

import { LogoutButton } from "./logout-button";
import { useUsuario } from "./usuario-context";

/**
 * Esqueleto de las pantallas GLOBALES (fuera de los paneles): selector de
 * sistemas, usuarios, configuración, cuenta y ayuda. Una sola barra superior.
 */
export function GlobalShell({
  children,
  restringido,
}: {
  children: ReactNode;
  /** Contraseña pendiente de cambio: sin navegación, solo /cuenta y salir. */
  restringido: boolean;
}) {
  const usuario = useUsuario();
  const pathname = usePathname();
  const links = restringido
    ? []
    : [
        { href: "/paneles", label: "Sistemas", icon: LayoutGrid },
        ...(esOwner(usuario)
          ? [
              { href: "/usuarios", label: "Usuarios", icon: UserCog },
              { href: "/configuracion", label: "Configuración", icon: Settings },
            ]
          : []),
        { href: "/ayuda", label: "Ayuda", icon: CircleHelp },
      ];

  return (
    <div className="bg-background min-h-dvh">
      <header className="pt-safe border-border bg-background/95 sticky top-0 z-30 border-b backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-4 md:px-8">
          <nav
            aria-label="Navegación principal"
            className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
          >
            {links.map(({ href, label, icon: Icono }) => {
              const activo = esRutaActiva(href, pathname);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={activo ? "page" : undefined}
                  className={cn(
                    "flex min-h-10 shrink-0 items-center gap-2 rounded-xl px-3 text-sm font-medium transition-colors",
                    activo
                      ? "bg-surface-2 text-foreground"
                      : "text-muted hover:bg-surface-2 hover:text-foreground",
                  )}
                >
                  <Icono className="size-4" strokeWidth={1.75} aria-hidden />
                  <span className={cn(href !== "/paneles" && "hidden sm:inline")}>{label}</span>
                </Link>
              );
            })}
          </nav>
          {!restringido && (
            <Link
              href="/cuenta"
              aria-label="Mi cuenta"
              className="hover:bg-surface-2 flex min-h-10 items-center gap-2 rounded-xl px-2"
            >
              <Avatar nombre={usuario.nombre} />
              <span className="hidden text-sm font-medium md:inline">{usuario.nombre}</span>
            </Link>
          )}
          <div className="w-auto">
            <LogoutButton compacto />
          </div>
        </div>
      </header>
      <main className="pb-safe mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-10">
        {children}
      </main>
    </div>
  );
}
