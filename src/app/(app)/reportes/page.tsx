import { Modulo } from "@prisma/client";
import { ChevronRight, Lock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { requirePaginaPermiso } from "@/server/auth/permissions";
import { puedeVerReporte, REPORTES } from "@/server/reportes/definiciones";

export const metadata: Metadata = { title: "Reportes" };

export default async function ReportesPage() {
  const usuario = await requirePaginaPermiso(Modulo.REPORTES, "ver");
  const visibles = REPORTES.filter((r) => puedeVerReporte(usuario, r));
  return (
    <>
      <PageHeader
        title="Reportes"
        subtitle="Cada reporte se filtra por período y depósito, y se exporta a PDF o Excel."
      />
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {visibles.map((r) => (
          <li key={r.slug}>
            <Link
              href={`/reportes/${r.slug}`}
              className="group border-border bg-surface hover:border-primary/40 flex h-full gap-3 rounded-xl border p-4 transition-colors"
            >
              <span className="bg-primary-soft text-primary-soft-foreground flex size-10 shrink-0 items-center justify-center rounded-lg text-sm font-semibold tabular-nums">
                {r.numero}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex flex-wrap items-center gap-2 font-medium">
                  {r.titulo}
                  {r.finanzas && (
                    <Badge variant="warning">
                      <Lock className="size-3" aria-hidden /> Finanzas
                    </Badge>
                  )}
                </span>
                <span className="text-muted text-sm">{r.descripcion}</span>
              </span>
              <ChevronRight
                className="text-muted mt-2 size-4 shrink-0 transition-transform group-hover:translate-x-0.5"
                aria-hidden
              />
            </Link>
          </li>
        ))}
      </ul>
      {visibles.length < REPORTES.length && (
        <p className="text-muted mt-4 text-sm">
          Algunos reportes (costos, ganancias, gastos, deudas) necesitan permisos adicionales.
        </p>
      )}
    </>
  );
}
