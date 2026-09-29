"use client";

import { LogOut } from "lucide-react";

import { borrarCatalogo } from "@/features/offline/catalogo";
import { cn } from "@/lib/utils";

/**
 * POST nativo a /api/auth/logout (funciona aun sin JS). Antes, borra los
 * catálogos offline de todos los paneles: precios y stock no quedan en el celular.
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
          "text-muted hover:bg-surface-2 hover:text-foreground flex min-h-10 w-full items-center gap-3 rounded-[var(--radius-control)] px-3 text-sm font-medium transition-colors",
          compacto && "justify-center px-0",
          className,
        )}
      >
        <LogOut className="text-muted size-5 shrink-0" strokeWidth={1.75} aria-hidden />
        {!compacto && <span>Cerrar sesión</span>}
      </button>
    </form>
  );
}
