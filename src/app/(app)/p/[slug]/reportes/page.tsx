import { Modulo } from "@prisma/client";
import {
  ArrowLeftRight,
  BarChart3,
  Boxes,
  CalendarDays,
  ChevronRight,
  Lock,
  Receipt,
  RotateCcw,
  Scale,
  Truck,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/ui/page-header";
import { rutaPanel } from "@/lib/paneles";
import { esOwner } from "@/lib/permisos";
import { requirePaginaPanel } from "@/server/auth/permissions";
import { REPORTES, type ClaveReporte } from "@/server/reportes/catalogo";

export const metadata: Metadata = { title: "Reportes" };

const ICONOS: Record<ClaveReporte, LucideIcon> = {
  comparador: Scale,
  empresa: BarChart3,
  vendedores: UsersRound,
  ventas: Receipt,
  stock: Boxes,
  movimientos: ArrowLeftRight,
  compras: Truck,
  clientes: Users,
  devoluciones: RotateCcw,
  "resumen-mensual": CalendarDays,
};

/** Índice de reportes: los de dueños solo aparecen para dueños. */
export default async function ReportesPage() {
  const ctx = await requirePaginaPanel(Modulo.REPORTES, "ver");
  const owner = esOwner(ctx.usuario);
  const visibles = REPORTES.filter((r) => owner || !r.owner);
  return (
    <>
      <PageHeader title="Reportes" subtitle="Filtrá, mirá el gráfico y exportá a PDF o Excel." />
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4 xl:grid-cols-3">
        {visibles.map((r) => {
          const Icono = ICONOS[r.clave];
          const principal = r.clave === "comparador";
          return (
            <li key={r.clave} className={principal ? "md:col-span-2 xl:col-span-3" : undefined}>
              <Link
                href={rutaPanel(ctx.panel.slug, `/reportes/${r.clave}`)}
                data-testid={`reporte-${r.clave}`}
                className={
                  principal
                    ? "border-primary/30 bg-primary-soft shadow-card hover:shadow-card-hover flex h-full items-center gap-4 rounded-2xl border p-5 transition-shadow"
                    : "border-border bg-surface shadow-card hover:border-input hover:shadow-card-hover flex h-full items-center gap-4 rounded-2xl border p-5 transition-[border-color,box-shadow]"
                }
              >
                <span className="bg-primary-soft text-primary flex size-12 shrink-0 items-center justify-center rounded-xl">
                  <Icono className="size-6" strokeWidth={1.75} aria-hidden />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex items-center gap-2 font-semibold">
                    {r.titulo}
                    {r.owner && (
                      <Lock
                        className="text-muted size-3.5"
                        strokeWidth={1.75}
                        aria-label="Solo dueños"
                      />
                    )}
                  </span>
                  <span className="text-muted text-sm">{r.descripcion}</span>
                </span>
                <ChevronRight
                  className="text-muted size-5 shrink-0"
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
