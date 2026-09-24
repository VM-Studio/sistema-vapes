import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { navegacionPermitida } from "@/config/navigation";
import { esOwner } from "@/lib/permisos";
import { requirePaginaUsuario } from "@/server/auth/permissions";

export const metadata: Metadata = { title: "Inicio" };

function saludo(): string {
  const hora = Number(
    new Intl.DateTimeFormat("es-AR", {
      hour: "numeric",
      hourCycle: "h23",
      timeZone: "America/Argentina/Buenos_Aires",
    }).format(new Date()),
  );
  if (hora < 12) return "Buen día";
  if (hora < 20) return "Buenas tardes";
  return "Buenas noches";
}

/** Inicio: saludo + accesos rápidos a los módulos permitidos. (Las métricas llegan con el módulo Dashboard.) */
export default async function InicioPage() {
  const usuario = await requirePaginaUsuario();
  const accesos = navegacionPermitida(usuario).filter((i) => i.href !== "/");
  // Módulos reales habilitados (Escanear no es un módulo: deriva de Ventas/Inventario).
  const modulosHabilitados = usuario.permisos.filter((p) => p.puedeVer).length;
  const nombre = usuario.nombre.split(" ")[0];

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
          {saludo()}, {nombre}
        </h1>
        <div className="text-muted flex items-center gap-2 text-sm">
          <Badge variant={esOwner(usuario) ? "primary" : "neutral"}>
            {esOwner(usuario) ? "Dueño" : "Empleado"}
          </Badge>
          <span>
            {esOwner(usuario)
              ? "Acceso total"
              : `${modulosHabilitados} módulo${modulosHabilitados === 1 ? "" : "s"} habilitado${modulosHabilitados === 1 ? "" : "s"}`}
          </span>
        </div>
      </section>

      <section aria-labelledby="accesos" className="flex flex-col gap-3">
        <h2 id="accesos" className="text-muted text-sm font-semibold tracking-wide uppercase">
          Accesos rápidos
        </h2>
        {accesos.length === 0 ? (
          <p className="border-border text-muted rounded-xl border border-dashed p-6 text-center text-sm">
            Todavía no tenés módulos habilitados. Pedile a un dueño que te dé acceso.
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {accesos.map((item) => {
              const Icono = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="group border-border bg-surface hover:border-primary/40 hover:bg-surface-2/50 flex h-full min-h-28 flex-col gap-3 rounded-xl border p-4 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <span className="bg-primary-soft text-primary-soft-foreground flex size-10 items-center justify-center rounded-lg">
                        <Icono className="size-5" aria-hidden />
                      </span>
                      <ChevronRight
                        className="text-muted size-4 transition-transform group-hover:translate-x-0.5"
                        aria-hidden
                      />
                    </div>
                    <div>
                      <p className="font-medium">{item.label}</p>
                      <p className="text-muted text-xs">{item.descripcion}</p>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
