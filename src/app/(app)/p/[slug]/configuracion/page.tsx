import { Boxes, ChevronRight, Receipt, ScanBarcode, Tag, Warehouse } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { cardVariants } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { rutaPanel } from "@/lib/paneles";
import { cn } from "@/lib/utils";
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
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SECCIONES_AJUSTES_PANEL.map((s, i) => {
          const Icono = ICONOS[i]!;
          return (
            <li key={s.ruta}>
              <Link
                href={rutaPanel(ctx.panel.slug, s.ruta)}
                className={cn(
                  cardVariants({ variant: "clickable" }),
                  "group flex min-h-20 items-center gap-4 p-5",
                )}
              >
                <span className="bg-surface rounded-control flex size-11 shrink-0 items-center justify-center">
                  <Icono className="size-5" strokeWidth={1.75} aria-hidden />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-h3 font-semibold">{s.label}</span>
                  <span className="text-muted text-small">{s.descripcion}</span>
                </span>
                <ChevronRight
                  className="text-subtle size-5 shrink-0 transition-transform group-hover:translate-x-0.5"
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
