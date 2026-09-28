"use client";

import { useState, type ReactNode } from "react";

import { navegacionPermitida } from "@/config/navigation";
import { COOKIE_SIDEBAR } from "@/config/ui";
import { cn } from "@/lib/utils";

import { LogoutButton } from "./logout-button";
import { BottomNav, TopBar } from "./mobile-nav";
import { LogoPanel } from "./logo-panel";
import { usePanel } from "./panel-context";
import { Sidebar } from "./sidebar";
import { useUsuario } from "./usuario-context";

interface AppShellProps {
  children: ReactNode;
  /** Estado inicial leído de la cookie en el servidor (sin parpadeo al cargar). */
  sidebarColapsadoInicial: boolean;
  /** Contraseña pendiente de cambio: sin navegación, solo /cuenta y salir. */
  restringido: boolean;
}

/**
 * Esqueleto de las pantallas DENTRO de un panel.
 * - Mobile (<768px): barra superior + bottom navigation + sheet "Más".
 * - Desktop (≥768px): sidebar lateral colapsable.
 */
export function AppShell({ children, sidebarColapsadoInicial, restringido }: AppShellProps) {
  const usuario = useUsuario();
  const panel = usePanel();
  const [colapsado, setColapsado] = useState(sidebarColapsadoInicial);
  const items = navegacionPermitida(usuario, panel);

  function toggleSidebar() {
    const nuevo = !colapsado;
    setColapsado(nuevo);
    document.cookie = `${COOKIE_SIDEBAR}=${nuevo ? "colapsado" : "expandido"}; path=/; max-age=31536000; samesite=lax`;
  }

  if (restringido) {
    return (
      <div className="min-h-dvh">
        <header className="pt-safe border-border bg-surface/95 sticky top-0 z-30 border-b backdrop-blur">
          <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
            <span className="flex items-center gap-2 font-semibold">
              <LogoPanel panel={panel} size={28} />
              {panel.nombre}
            </span>
            <div className="w-auto">
              <LogoutButton />
            </div>
          </div>
        </header>
        <main className="pb-safe mx-auto max-w-3xl px-4 py-6">{children}</main>
      </div>
    );
  }

  return (
    <div className="min-h-dvh">
      <Sidebar items={items} colapsado={colapsado} onToggle={toggleSidebar} />
      <TopBar />
      <main
        className={cn(
          // mobile: espacio para la barra superior y la bottom bar (+ safe areas)
          "pt-[calc(3.5rem+env(safe-area-inset-top))] pb-[calc(4.5rem+env(safe-area-inset-bottom))]",
          "md:pt-0 md:pb-0 md:transition-[padding] md:duration-200",
          colapsado ? "md:pl-[4.5rem]" : "md:pl-64",
        )}
      >
        <div className="mx-auto w-full max-w-6xl min-w-0 px-4 py-4 md:px-8 md:py-8">{children}</div>
      </main>
      <BottomNav items={items} />
    </div>
  );
}
