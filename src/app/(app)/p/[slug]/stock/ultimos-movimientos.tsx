import { ArrowRight, History } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { conSigno } from "@/lib/format";
import { TIPO_MOVIMIENTO_UI } from "@/lib/movimientos-ui";
import { cn, formatearFechaHora } from "@/lib/utils";
import type { MovimientoListado } from "@/server/services/movimiento.service";

/** Últimos movimientos de la vista (todos los depósitos en Global, o el depósito elegido). */
export function UltimosMovimientos({
  movimientos,
  total,
  verTodosHref,
  deposito,
}: {
  movimientos: MovimientoListado[];
  total: number;
  verTodosHref: string;
  deposito: string | null;
}) {
  return (
    <Card className="mt-6">
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle>
          Últimos movimientos
          <span className="text-muted ml-2 text-sm font-normal">
            {deposito ? `en ${deposito}` : "de todos los depósitos"}
          </span>
        </CardTitle>
        {total > 0 && (
          <Link
            href={verTodosHref}
            className="text-primary inline-flex min-h-11 items-center gap-1 text-sm font-medium"
          >
            Ver todos <ArrowRight className="size-4" strokeWidth={1.75} />
          </Link>
        )}
      </CardHeader>
      <CardContent>
        {movimientos.length === 0 ? (
          <EmptyState icon={History} title="Todavía no hay movimientos" />
        ) : (
          <ul className="divide-border flex flex-col divide-y">
            {movimientos.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate font-medium">{m.nombre}</p>
                  <p className="text-muted flex flex-wrap items-center gap-x-1.5 text-xs">
                    <Badge variant={TIPO_MOVIMIENTO_UI[m.tipo].variante}>
                      {TIPO_MOVIMIENTO_UI[m.tipo].label}
                    </Badge>
                    {!deposito && <span>{m.deposito} ·</span>}
                    <span>{formatearFechaHora(m.fecha)}</span>
                    <span>· {m.usuario}</span>
                  </p>
                </div>
                <p
                  className={cn(
                    "shrink-0 text-lg font-semibold tabular-nums",
                    m.cantidad > 0 ? "text-success" : "text-danger",
                  )}
                >
                  {conSigno(m.cantidad)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
