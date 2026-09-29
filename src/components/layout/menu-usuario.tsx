"use client";

import { ChevronDown, CircleHelp, LayoutGrid, UserCog, UserRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Avatar } from "@/components/ui/avatar";
import { esOwner } from "@/lib/permisos";
import { cn } from "@/lib/utils";

import { LogoutButton } from "./logout-button";
import { useUsuario } from "./usuario-context";

/**
 * Avatar con menú desplegable: Mi cuenta, Usuarios (dueño), Ayuda, Salir.
 * `restringido` (contraseña pendiente): solo Salir.
 */
export function MenuUsuario({
  restringido = false,
  conCambiarSistema = false,
  mostrarNombre = false,
}: {
  restringido?: boolean;
  /** En mobile el botón "Cambiar de sistema" vive acá. */
  conCambiarSistema?: boolean;
  mostrarNombre?: boolean;
}) {
  const usuario = useUsuario();
  const [abierto, setAbierto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto) return;
    const cerrar = (e: MouseEvent | KeyboardEvent) => {
      if (
        e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)
      )
        setAbierto(false);
    };
    document.addEventListener("mousedown", cerrar);
    document.addEventListener("keydown", cerrar);
    return () => {
      document.removeEventListener("mousedown", cerrar);
      document.removeEventListener("keydown", cerrar);
    };
  }, [abierto]);

  const item =
    "flex min-h-11 items-center gap-3 rounded-[4px] px-3 text-sm font-medium text-foreground hover:bg-surface-2 md:min-h-10";
  const cerrar = () => setAbierto(false);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setAbierto((a) => !a)}
        aria-label="Menú de cuenta"
        aria-haspopup="menu"
        aria-expanded={abierto}
        className="hover:bg-surface-2 flex h-11 items-center gap-2 rounded-[var(--radius-control)] px-1 md:h-10 md:px-1.5"
      >
        <Avatar nombre={usuario.nombre} className="size-8" />
        {mostrarNombre && (
          <span className="hidden max-w-40 truncate text-sm font-medium lg:inline">
            {usuario.nombre}
          </span>
        )}
        <ChevronDown
          className="text-subtle hidden size-4 md:block"
          strokeWidth={1.75}
          aria-hidden
        />
      </button>
      {abierto && (
        <div
          role="menu"
          className="bg-surface border-border shadow-pop absolute top-[calc(100%+6px)] right-0 z-50 w-64 rounded-[var(--radius-card)] border p-1.5"
        >
          <div className="flex items-center gap-3 px-3 py-2.5">
            <Avatar nombre={usuario.nombre} />
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-semibold">{usuario.nombre}</span>
              <span className="text-subtle truncate text-xs">
                {esOwner(usuario) ? "Dueño" : "Empleado"} · {usuario.email}
              </span>
            </div>
          </div>
          <div className="bg-border my-1 h-px" aria-hidden />
          {!restringido && conCambiarSistema && (
            <Link href="/paneles" role="menuitem" onClick={cerrar} className={item}>
              <LayoutGrid className="text-muted size-5" strokeWidth={1.75} aria-hidden />
              Cambiar de sistema
            </Link>
          )}
          {!restringido && (
            <Link href="/cuenta" role="menuitem" onClick={cerrar} className={item}>
              <UserRound className="text-muted size-5" strokeWidth={1.75} aria-hidden />
              Mi cuenta
            </Link>
          )}
          {!restringido && esOwner(usuario) && (
            <Link href="/usuarios" role="menuitem" onClick={cerrar} className={item}>
              <UserCog className="text-muted size-5" strokeWidth={1.75} aria-hidden />
              Usuarios
            </Link>
          )}
          {!restringido && (
            <Link href="/ayuda" role="menuitem" onClick={cerrar} className={item}>
              <CircleHelp className="text-muted size-5" strokeWidth={1.75} aria-hidden />
              Ayuda
            </Link>
          )}
          <div className="bg-border my-1 h-px" aria-hidden />
          <LogoutButton className={cn(item, "text-foreground")} />
        </div>
      )}
    </div>
  );
}
