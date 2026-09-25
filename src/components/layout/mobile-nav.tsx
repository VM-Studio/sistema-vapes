"use client";

import { Ellipsis, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Sheet } from "@/components/ui/sheet";
import { esRutaActiva, tituloDeRuta, type ItemNavegacion } from "@/config/navigation";
import { esOwner } from "@/lib/permisos";
import { cn } from "@/lib/utils";

import { LogoutButton } from "./logout-button";
import { useUsuario } from "./usuario-context";

/** Barra superior fija (mobile): título de la sección + avatar que abre el menú de cuenta. */
export function TopBar({ restringido = false }: { restringido?: boolean }) {
  const pathname = usePathname();
  const usuario = useUsuario();
  const [menuAbierto, setMenuAbierto] = useState(false);

  return (
    <header className="pt-safe pl-safe pr-safe border-border bg-surface/95 fixed inset-x-0 top-0 z-30 border-b backdrop-blur md:hidden">
      <div className="flex h-14 items-center justify-between gap-3 px-4">
        {/* No es <h1>: el encabezado de la página lo pone cada pantalla. */}
        <p className="truncate text-lg font-semibold">{tituloDeRuta(pathname)}</p>
        <button
          type="button"
          onClick={() => setMenuAbierto(true)}
          className="-mr-1.5 flex size-11 items-center justify-center rounded-full"
          aria-label="Menú de cuenta"
        >
          <Avatar nombre={usuario.nombre} />
        </button>
      </div>
      <Sheet
        open={menuAbierto}
        onOpenChange={setMenuAbierto}
        title={usuario.nombre}
        description={usuario.email}
      >
        <div className="flex flex-col gap-1">
          <div className="mb-2">
            <Badge variant={esOwner(usuario) ? "primary" : "neutral"}>
              {esOwner(usuario) ? "Dueño" : "Empleado"}
            </Badge>
          </div>
          {!restringido && (
            <Link
              href="/cuenta"
              onClick={() => setMenuAbierto(false)}
              className="hover:bg-surface-2 flex min-h-12 items-center gap-3 rounded-lg px-3 text-sm font-medium"
            >
              <UserRound className="text-muted size-5" aria-hidden />
              Mi cuenta
            </Link>
          )}
          <LogoutButton className="min-h-12" />
        </div>
      </Sheet>
    </header>
  );
}

/**
 * Bottom navigation fija (mobile): hasta 4 módulos marcados `enBottomBar` +
 * "Más", que abre un sheet con el resto de los módulos permitidos.
 */
export function BottomNav({ items }: { items: ItemNavegacion[] }) {
  const pathname = usePathname();
  const [masAbierto, setMasAbierto] = useState(false);

  const principales = items.filter((i) => i.enBottomBar).slice(0, 4);
  const resto = items.filter((i) => !principales.includes(i));
  const masActivo =
    resto.some((i) => esRutaActiva(i.href, pathname)) || esRutaActiva("/cuenta", pathname);

  const claseItem = (activo: boolean) =>
    cn(
      "flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors",
      activo ? "text-primary" : "text-muted",
    );

  return (
    <>
      <nav
        aria-label="Navegación inferior"
        className="pb-safe pl-safe pr-safe border-border bg-surface/95 fixed inset-x-0 bottom-0 z-30 border-t backdrop-blur md:hidden"
      >
        <ul className="flex">
          {principales.map((item) => {
            const activo = esRutaActiva(item.href, pathname);
            const Icono = item.icon;
            if (item.destacado) {
              // Botón central elevado (Escanear): la acción más usada en el galpón.
              return (
                <li key={item.href} className="flex flex-1 justify-center">
                  <Link
                    href={item.href}
                    aria-current={activo ? "page" : undefined}
                    className="text-primary -mt-5 flex flex-col items-center gap-0.5 text-[11px] font-semibold"
                  >
                    <span
                      className={cn(
                        "border-background bg-primary text-primary-foreground flex size-14 items-center justify-center rounded-full border-4 shadow-lg",
                        activo && "ring-primary/40 ring-2",
                      )}
                    >
                      <Icono className="size-7" aria-hidden />
                    </span>
                    {item.label}
                  </Link>
                </li>
              );
            }
            return (
              <li key={item.href} className="flex flex-1">
                <Link
                  href={item.href}
                  aria-current={activo ? "page" : undefined}
                  className={claseItem(activo)}
                >
                  <Icono className="size-6" aria-hidden strokeWidth={activo ? 2.25 : 1.75} />
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
              <Ellipsis className="size-6" aria-hidden />
              Más
            </button>
          </li>
        </ul>
      </nav>

      <Sheet open={masAbierto} onOpenChange={setMasAbierto} title="Más opciones">
        {resto.length > 0 && (
          <ul className="grid grid-cols-3 gap-2">
            {resto.map((item) => {
              const activo = esRutaActiva(item.href, pathname);
              const Icono = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setMasAbierto(false)}
                    aria-current={activo ? "page" : undefined}
                    className={cn(
                      "flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-xl border px-1 text-center text-xs font-medium",
                      activo
                        ? "border-primary bg-primary-soft text-primary-soft-foreground"
                        : "border-border hover:bg-surface-2",
                    )}
                  >
                    <Icono className="size-6" aria-hidden />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        <div className="border-border mt-4 flex flex-col gap-1 border-t pt-3">
          <Link
            href="/cuenta"
            onClick={() => setMasAbierto(false)}
            className="hover:bg-surface-2 flex min-h-12 items-center gap-3 rounded-lg px-3 text-sm font-medium"
          >
            <UserRound className="text-muted size-5" aria-hidden />
            Mi cuenta
          </Link>
          <LogoutButton className="min-h-12" />
        </div>
      </Sheet>
    </>
  );
}
