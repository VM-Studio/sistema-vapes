import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { SelectorPeriodo } from "@/components/analitica/selector-periodo";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatearNumero, formatearPesos } from "@/lib/format";
import { rutaPanel } from "@/lib/paneles";
import { requirePaginaPanelOwner } from "@/server/auth/permissions";
import {
  describirPeriodo,
  diaDe,
  periodoDesdeParams,
  queryPeriodo,
  rendimientoVendedores,
} from "@/server/services/analitica.service";

export const metadata: Metadata = { title: "Equipo" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Índice del equipo (solo dueños): una fila por vendedor del período, con link a su detalle. */
export default async function EquipoPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePaginaPanelOwner();
  const sp = await searchParams;
  const periodo = periodoDesdeParams(sp);
  const desc = describirPeriodo(periodo);
  const filas = await rendimientoVendedores(ctx, periodo);
  const qs = queryPeriodo(sp);

  return (
    <div className="flex flex-col gap-6 md:gap-8">
      <header className="flex flex-col gap-4">
        <h1 className="text-2xl leading-tight font-semibold tracking-tight md:text-3xl">Equipo</h1>
        <SelectorPeriodo
          modo={periodo.modo}
          desde={diaDe(periodo.desde)}
          hasta={diaDe(periodo.hasta)}
          preset={typeof sp.preset === "string" ? sp.preset : null}
          etiqueta={desc.etiqueta}
          comparacion={desc.comparacion}
        />
      </header>
      {filas.length === 0 ? (
        <EmptyState title="Sin ventas en el período" />
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Vendedores">
          {filas.map((r) => (
            <li key={r.usuarioId}>
              <Link
                href={`${rutaPanel(ctx.panel.slug, `/equipo/${r.usuarioId}`)}${qs}`}
                className="border-border bg-surface shadow-card hover:bg-surface-2 flex min-h-11 items-center gap-3 rounded-2xl border p-4"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-semibold">{r.nombre}</span>
                    <Badge variant={r.rol === "OWNER" ? "primary" : "neutral"}>
                      {r.rol === "OWNER" ? "Dueño" : "Empleado"}
                    </Badge>
                  </div>
                  <p className="text-muted text-sm">
                    {formatearNumero(r.cantidadVentas)} ventas · {formatearPesos(r.facturado)} ·{" "}
                    {formatearNumero(r.unidades)} u.
                    {r.comision ? ` · comisión ${formatearPesos(r.comision.estimada)}` : ""}
                  </p>
                </div>
                <ChevronRight className="text-muted size-5" strokeWidth={1.75} aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
