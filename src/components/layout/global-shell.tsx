"use client";

/* eslint-disable @next/next/no-img-element -- marca chica fija de /public */
import { CircleHelp, LayoutGrid, Settings, UserCog } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Avatar } from "@/components/ui/avatar";
import { esRutaActiva } from "@/config/navigation";
import { useRutaOptimista } from "@/hooks/use-ruta-optimista";
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
  // Activo al instante al tocar, sin esperar la respuesta del servidor.
  const { ruta: pathname, marcar } = useRutaOptimista();
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
    <div className="fondo-marca min-h-dvh">
      <header className="pt-safe pl-safe pr-safe border-border sticky top-0 z-30 border-b bg-white/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1280px] items-center gap-2 px-4 md:h-16 md:gap-4 md:px-8">
          <Link
            href="/paneles"
            className="flex shrink-0 items-center gap-2 pr-1"
            aria-label="Sistemas"
          >
            <img
              src="/brand/osito.png"
              alt=""
              width={40}
              height={40}
              className="size-9 md:size-10"
            />
            <span className="font-titulo hidden text-[0.9375rem] font-extrabold tracking-tight italic lg:inline">
              Gestión
            </span>
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
                  onClick={marcar(href)}
                  aria-current={activo ? "page" : undefined}
                  aria-label={label}
                  className={cn(
                    "rounded-control flex h-9 shrink-0 items-center gap-2 px-2.5 text-sm font-medium transition-colors",
                    activo
                      ? "bg-azul-velo-2 text-foreground [&>svg]:text-marca-azul"
                      : "text-muted hover:bg-azul-velo-1 hover:text-foreground",
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
              className="hover:bg-surface-2 rounded-control flex h-10 items-center gap-2 px-1.5"
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
