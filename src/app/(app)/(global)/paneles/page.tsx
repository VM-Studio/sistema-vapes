import { Modulo } from "@prisma/client";
import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { formatearPesos } from "@/lib/format";
import { esOwner, puede } from "@/lib/permisos";
import { rutaPanel } from "@/lib/paneles";
import { requirePaginaUsuario } from "@/server/auth/permissions";
import { panelesDeUsuario, resumenesPaneles } from "@/server/services/panel.service";

import { AgregarPanel } from "./agregar-panel";
import { AvisosPaneles } from "./avisos";
import { LogoTarjeta } from "./logo-tarjeta";

export const metadata: Metadata = { title: "Sistemas" };

/**
 * Selector de sistemas (después del login). Muestra solo los paneles a los
 * que el usuario accede; con uno solo, entra directo.
 */
export default async function PanelesPage({
  searchParams,
}: {
  searchParams: Promise<{ aviso?: string; origen?: string }>;
}) {
  const usuario = await requirePaginaUsuario();
  const [paneles, params] = await Promise.all([panelesDeUsuario(usuario), searchParams]);
  const owner = esOwner(usuario);

  if (paneles.length === 1 && !owner && params.aviso !== "sin-acceso") {
    redirect(rutaPanel(paneles[0]!.slug));
  }

  const resumenes = await resumenesPaneles(
    paneles
      .filter(
        (p) =>
          puede(usuario, p.id, Modulo.DASHBOARD, "ver") ||
          puede(usuario, p.id, Modulo.VENTAS, "ver"),
      )
      .map((p) => p.id),
  );

  /** "Hoy: 12 ventas · $ 340.000" (el monto solo para dueños) o "Sin ventas hoy". */
  function lineaHoy(panelId: string): string | null {
    const r = resumenes.get(panelId);
    if (!r) return null;
    if (r.ventasHoy === 0) return "Sin ventas hoy";
    const ventas = `Hoy: ${r.ventasHoy} ${r.ventasHoy === 1 ? "venta" : "ventas"}`;
    return owner ? `${ventas} · ${formatearPesos(r.totalHoy)}` : ventas;
  }

  return (
    <div className="flex flex-col gap-8 md:gap-10">
      <Suspense>
        <AvisosPaneles slugs={paneles.map((p) => p.slug)} />
      </Suspense>
      <header className="flex flex-col gap-2">
        <h1 className="text-h1 md:text-display font-semibold">Elegí un sistema</h1>
        <p className="text-muted text-body">
          Cada sistema tiene sus propios productos, ventas y stock
        </p>
      </header>

      {paneles.length === 0 && !owner ? (
        <div className="bg-card rounded-card p-10 text-center">
          <p className="text-h3 font-semibold">Todavía no tenés ningún sistema habilitado</p>
          <p className="text-muted mt-1 text-sm">Pedile acceso a un dueño.</p>
        </div>
      ) : (
        <ul className="grid auto-rows-fr gap-4 md:grid-cols-2 lg:grid-cols-3">
          {paneles.map((panel) => {
            const linea = lineaHoy(panel.id);
            return (
              <li key={panel.id}>
                <Link
                  href={rutaPanel(panel.slug)}
                  className="group bg-card hover:bg-card-hover hover:shadow-card-hover flex h-full flex-col gap-5 rounded-card p-4 transition-[background-color,box-shadow,transform] duration-150 hover:-translate-y-0.5 md:p-5"
                >
                  <LogoTarjeta nombre={panel.nombre} logoUrl={panel.logoUrl} />
                  <div className="flex flex-1 items-end justify-between gap-3 px-1">
                    <div className="flex min-w-0 flex-col gap-1">
                      <h2 className="text-h2 truncate font-semibold">{panel.nombre}</h2>
                      {linea && <p className="text-muted text-sm tabular-nums">{linea}</p>}
                    </div>
                    <span className="text-muted group-hover:text-foreground flex shrink-0 items-center gap-0.5 text-sm font-medium transition-colors">
                      Entrar
                      <ChevronRight
                        className="size-4 transition-transform group-hover:translate-x-0.5"
                        strokeWidth={1.75}
                        aria-hidden
                      />
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
          {owner && (
            <li>
              <AgregarPanel />
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
