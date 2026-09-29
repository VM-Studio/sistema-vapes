import { LayoutGrid } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { LogoPanel } from "@/components/layout/logo-panel";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { TabsNav } from "@/components/ui/tabs-nav";
import { formatearIdVenta, rutaPanel } from "@/lib/paneles";
import { cn } from "@/lib/utils";
import { requirePaginaOwner } from "@/server/auth/permissions";
import { listarTodosLosPaneles } from "@/server/services/panel.service";

import { tabsConfiguracion } from "../secciones";
import { DesactivarPanel } from "./desactivar-panel";

export const metadata: Metadata = { title: "Sistemas" };

/** Paneles: los activos se pueden dar de baja (soft: sus datos quedan). Se crean desde /paneles. */
export default async function SistemasPage() {
  await requirePaginaOwner();
  const paneles = await listarTodosLosPaneles();
  return (
    <>
      <TabsNav
        items={tabsConfiguracion("/configuracion/sistemas")}
        className="mb-6"
        ariaLabel="Configuración"
      />
      <PageHeader
        title="Sistemas"
        subtitle="Paneles del negocio. Para crear uno nuevo usá «Agregar sistema» en la pantalla de sistemas."
        actions={
          <Link href="/paneles" className={buttonVariants({ variant: "secondary" })}>
            <LayoutGrid strokeWidth={1.75} /> Ir a sistemas
          </Link>
        }
      />
      <ul className="flex flex-col gap-4">
        {paneles.map((p) => (
          <li
            key={p.id}
            className={cn(cardVariants(), "flex flex-wrap items-center gap-4 p-4 md:p-5")}
          >
            <span className="bg-surface rounded-control flex h-14 w-24 shrink-0 items-center justify-center">
              <LogoPanel panel={p} size={32} />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <p className="text-h3 font-semibold">
                {p.activo ? (
                  <Link href={rutaPanel(p.slug)} className="hover:underline">
                    {p.nombre}
                  </Link>
                ) : (
                  p.nombre
                )}
              </p>
              <p className="text-muted text-small">
                /p/{p.slug} · IDs de venta{" "}
                <span className="text-foreground font-mono font-semibold">
                  {formatearIdVenta(p.slug, 1)}
                </span>
              </p>
            </div>
            {p.activo ? (
              <DesactivarPanel panelId={p.id} nombre={p.nombre} />
            ) : (
              <Badge variant="neutral" className="bg-surface-3">
                Desactivado
              </Badge>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
