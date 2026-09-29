import { Boxes, ChevronRight, Receipt, ScanBarcode, Tag, Warehouse } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/ui/page-header";
import { rutaPanel } from "@/lib/paneles";
import { requirePaginaPanelOwner } from "@/server/auth/permissions";

import { SECCIONES_AJUSTES_PANEL } from "./secciones";

export const metadata: Metadata = { title: "Ajustes del panel" };

const ICONOS = [Boxes, Tag, Warehouse, ScanBarcode, Receipt];

export default async function AjustesPanelPage() {
  const ctx = await requirePaginaPanelOwner();
  return (
    <>
      <PageHeader
        title="Ajustes del panel"
        subtitle={`Datos maestros de ${ctx.panel.nombre}: no se comparten con otros paneles.`}
      />
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {SECCIONES_AJUSTES_PANEL.map((s, i) => {
          const Icono = ICONOS[i]!;
          return (
            <li key={s.ruta}>
              <Link
                href={rutaPanel(ctx.panel.slug, s.ruta)}
                className="group border-border bg-surface hover:border-primary/40 flex min-h-20 items-center gap-4 rounded-card border p-4 transition-colors"
              >
                <span className="bg-primary-soft text-primary flex size-11 shrink-0 items-center justify-center rounded-control">
                  <Icono className="size-5" strokeWidth={1.75} aria-hidden />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-medium">{s.label}</span>
                  <span className="text-muted text-sm">{s.descripcion}</span>
                </span>
                <ChevronRight
                  className="text-muted size-4 transition-transform group-hover:translate-x-0.5"
                  strokeWidth={1.75}
                  aria-hidden
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
