import { Modulo } from "@prisma/client";
import { AlertTriangle, ArrowRight, ShoppingBag } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { LogoPanel } from "@/components/layout/logo-panel";
import { formatearPesos } from "@/lib/format";
import { esOwner, puede } from "@/lib/permisos";
import { rutaPanel } from "@/lib/paneles";
import { requirePaginaUsuario } from "@/server/auth/permissions";
import { panelesDeUsuario, resumenesPaneles } from "@/server/services/panel.service";

import { AgregarPanel } from "./agregar-panel";
import { AvisosPaneles } from "./avisos";

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

  return (
    <div className="flex flex-col gap-8">
      <Suspense>
        <AvisosPaneles slugs={paneles.map((p) => p.slug)} />
      </Suspense>
      <header className="flex flex-col gap-2">
        <p className="text-muted text-sm font-medium">Hola, {usuario.nombre.split(" ")[0]}</p>
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
          ¿Qué sistema querés abrir?
        </h1>
      </header>

      {paneles.length === 0 && !owner ? (
        <div className="border-border bg-surface-2 rounded-2xl border p-8 text-center">
          <p className="font-medium">Todavía no tenés ningún sistema habilitado.</p>
          <p className="text-muted mt-1 text-sm">Pedile acceso a un dueño.</p>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {paneles.map((panel) => {
            const r = resumenes.get(panel.id);
            return (
              <li key={panel.id}>
                <Link
                  href={rutaPanel(panel.slug)}
                  className="group border-border bg-surface shadow-card hover:shadow-card-hover focus-visible:outline-primary flex min-h-56 flex-col gap-6 rounded-2xl border p-6 transition-shadow"
                  style={
                    panel.colorAcento
                      ? ({ "--panel-accent": panel.colorAcento } as React.CSSProperties)
                      : undefined
                  }
                >
                  <div className="flex items-start justify-between gap-3">
                    <LogoPanel panel={panel} size={56} />
                    <ArrowRight
                      className="text-muted size-5 transition-transform group-hover:translate-x-1"
                      strokeWidth={1.75}
                      aria-hidden
                    />
                  </div>
                  <div className="mt-auto flex flex-col gap-3">
                    <h2 className="text-xl font-semibold">{panel.nombre}</h2>
                    {r && (
                      <dl className="text-muted flex flex-wrap gap-x-5 gap-y-1 text-sm">
                        <div className="flex items-center gap-1.5">
                          <ShoppingBag className="size-4" strokeWidth={1.75} aria-hidden />
                          <dt className="sr-only">Ventas de hoy</dt>
                          <dd>
                            {r.ventasHoy} {r.ventasHoy === 1 ? "venta" : "ventas"} hoy
                            {r.ventasHoy > 0 && ` · ${formatearPesos(r.totalHoy)}`}
                          </dd>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <AlertTriangle
                            className={
                              r.alertasStock > 0 ? "text-warning-soft-foreground size-4" : "size-4"
                            }
                            strokeWidth={1.75}
                            aria-hidden
                          />
                          <dt className="sr-only">Alertas de stock</dt>
                          <dd>
                            {r.alertasStock === 0
                              ? "Stock al día"
                              : `${r.alertasStock} ${r.alertasStock === 1 ? "alerta" : "alertas"} de stock`}
                          </dd>
                        </div>
                      </dl>
                    )}
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
