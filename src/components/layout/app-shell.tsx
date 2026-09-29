"use client";

import { useState, type ReactNode } from "react";

import { navegacionPermitida } from "@/config/navigation";
import { COOKIE_SIDEBAR } from "@/config/ui";
import { cn } from "@/lib/utils";

import { BottomNav, TopBar } from "./mobile-nav";
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
 * Esqueleto de las pantallas DENTRO de un panel: barra superior blanca fija
 * (logo + nombre, red, cambiar de sistema, avatar).
 * - Mobile (<768px): + bottom navigation + sheet "Más".
 * - Desktop (≥768px): + sidebar de 240px colapsable. Contenido máx. 1280px.
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
      <div className="bg-background min-h-dvh">
        <TopBar restringido />
        <main className="mx-auto max-w-3xl px-4 pt-[calc(3.5rem+env(safe-area-inset-top)+1.5rem)] pb-[calc(2rem+env(safe-area-inset-bottom))] md:px-8">
          {children}
        </main>
      </div>
    );
  }

  return (
    <div className="bg-background min-h-dvh">
      <TopBar />
      <Sidebar items={items} colapsado={colapsado} onToggle={toggleSidebar} />
      <main
        className={cn(
          // barra superior fija (+ safe area); en mobile, además la bottom bar
          "pt-[calc(3.5rem+env(safe-area-inset-top))] pb-[calc(4.5rem+env(safe-area-inset-bottom))]",
          "md:pb-0 md:transition-[padding] md:duration-200",
          colapsado ? "md:pl-16" : "md:pl-60",
        )}
      >
        <div className="mx-auto w-full max-w-[1280px] min-w-0 px-4 py-6 md:px-8 md:py-8">
          {children}
        </div>
      </main>
      <BottomNav items={items} />
    </div>
  );
}
