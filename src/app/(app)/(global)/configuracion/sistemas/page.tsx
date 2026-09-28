import type { Metadata } from "next";
import Link from "next/link";

import { LogoPanel } from "@/components/layout/logo-panel";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { TabsNav } from "@/components/ui/tabs-nav";
import { formatearIdVenta, rutaPanel } from "@/lib/paneles";
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
      <PageHeader
        title="Configuración"
        subtitle="Sistemas (paneles). Para crear uno nuevo usá «Agregar panel» en la pantalla de sistemas."
      />
      <TabsNav items={tabsConfiguracion("/configuracion/sistemas")} className="mb-6" />
      <ul className="border-border bg-surface divide-border divide-y rounded-2xl border">
        {paneles.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-4 p-4 md:p-5">
            <LogoPanel panel={p} size={40} />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                {p.activo ? (
                  <Link href={rutaPanel(p.slug)} className="hover:underline">
                    {p.nombre}
                  </Link>
                ) : (
                  p.nombre
                )}
              </p>
              <p className="text-muted text-sm">
                /p/{p.slug} · IDs de venta {formatearIdVenta(p.slug, 1)}
              </p>
            </div>
            {p.activo ? (
              <DesactivarPanel panelId={p.id} nombre={p.nombre} />
            ) : (
              <Badge variant="neutral">Desactivado</Badge>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
