"use client";

import { LogOut } from "lucide-react";

import { borrarCatalogo } from "@/features/offline/catalogo";
import { cn } from "@/lib/utils";

/**
 * POST nativo a /api/auth/logout (funciona aun sin JS). Antes, borra el
 * catálogo offline: precios y stock no quedan en el celular. La cola de
 * operaciones pendientes NO se borra: es de ese usuario y se sincroniza
 * cuando vuelva a entrar.
 */
export function LogoutButton({
  className,
  compacto = false,
}: {
  className?: string;
  compacto?: boolean;
}) {
  return (
    <form
      action="/api/auth/logout"
      method="post"
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        void borrarCatalogo().finally(() => form.submit());
      }}
    >
      <button
        type="submit"
        title="Cerrar sesión"
        aria-label="Cerrar sesión"
        className={cn(
          "text-muted hover:bg-surface-2 hover:text-foreground flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors",
          compacto && "justify-center px-0",
          className,
        )}
      >
        <LogOut className="size-5 shrink-0" aria-hidden />
        {!compacto && <span>Cerrar sesión</span>}
      </button>
    </form>
  );
}
