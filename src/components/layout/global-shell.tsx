"use client";

/* eslint-disable @next/next/no-img-element -- marca chica fija de /public */
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
 * sistemas, usuarios, configuración, cuenta y ayuda. Barra superior blanca:
 * marca + secciones a la izquierda, usuario y salir a la derecha.
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
    <div className="min-h-dvh bg-white">
      <header className="pt-safe pl-safe pr-safe border-border sticky top-0 z-30 border-b bg-white">
        <div className="mx-auto flex h-14 max-w-[1280px] items-center gap-2 px-4 md:gap-4 md:px-8">
          <Link
            href="/paneles"
            className="flex shrink-0 items-center gap-2 pr-1"
            aria-label="Sistemas"
          >
            <img src="/brand/marca.png" alt="" width={28} height={28} className="size-7" />
            <span className="hidden text-sm font-semibold lg:inline">Gestión</span>
          </Link>
          <nav
            aria-label="Navegación principal"
            className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto"
          >
            {links.map(({ href, label, icon: Icono }) => {
              const activo = esRutaActiva(href, pathname);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={activo ? "page" : undefined}
                  aria-label={label}
                  className={cn(
                    "flex h-9 shrink-0 items-center gap-2 rounded-[var(--radius-control)] px-2.5 text-sm font-medium transition-colors",
                    activo
                      ? "bg-card text-foreground"
                      : "text-muted hover:bg-surface-2 hover:text-foreground",
                  )}
                >
                  <Icono className="size-[1.125rem]" strokeWidth={1.75} aria-hidden />
                  <span className="hidden sm:inline">{label}</span>
                </Link>
              );
            })}
          </nav>
          {!restringido && (
            <Link
              href="/cuenta"
              aria-label="Mi cuenta"
              className="hover:bg-surface-2 flex h-10 items-center gap-2 rounded-[var(--radius-control)] px-1.5"
            >
              <Avatar nombre={usuario.nombre} className="size-8" />
              <span className="hidden max-w-40 truncate text-sm font-medium md:inline">
                {usuario.nombre}
              </span>
            </Link>
          )}
          <div className="w-auto">
            <LogoutButton className="h-10 min-h-10 w-auto px-2.5 max-md:[&_span]:sr-only" />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1280px] px-4 py-8 pb-[calc(2rem+env(safe-area-inset-bottom))] md:px-8 md:py-12">
        {children}
      </main>
    </div>
  );
}
