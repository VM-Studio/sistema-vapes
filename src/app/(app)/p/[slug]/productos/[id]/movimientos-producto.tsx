import { History } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { conSigno, formatearPesos } from "@/lib/format";
import { TIPO_MOVIMIENTO_UI } from "@/lib/movimientos-ui";
import { cn, formatearFechaHora } from "@/lib/utils";
import type { MovimientoListado } from "@/server/services/movimiento.service";

/** Últimos movimientos de todos los sabores del producto (costos: solo dueños). */
export function MovimientosProducto({
  movimientos,
  total,
  verCostos,
  hrefTodos,
}: {
  movimientos: MovimientoListado[];
  total: number;
  verCostos: boolean;
  /** Historial completo del producto en Stock → Movimientos. */
  hrefTodos: string;
}) {
  return (
    <>
      <DataTable
        caption="Últimos movimientos"
        rows={movimientos}
        getRowKey={(m) => m.id}
        empty={<EmptyState icon={History} title="Este producto todavía no tuvo movimientos" />}
        columns={[
          {
            key: "fecha",
            header: "Fecha",
            cell: (m) => (
              <span className="text-muted whitespace-nowrap">{formatearFechaHora(m.fecha)}</span>
            ),
          },
          {
            key: "tipo",
            header: "Tipo",
            cell: (m) => (
              <Badge variant={TIPO_MOVIMIENTO_UI[m.tipo].variante}>
                {TIPO_MOVIMIENTO_UI[m.tipo].label}
              </Badge>
            ),
          },
          { key: "sabor", header: "Sabor", cell: (m) => m.nombre },
          { key: "deposito", header: "Depósito", cell: (m) => m.deposito },
          {
            key: "cantidad",
            header: "Cantidad",
            className: "text-right",
            cell: (m) => (
              <span
                className={cn(
                  "font-semibold tabular-nums",
                  m.cantidad > 0 ? "text-success" : "text-danger",
                )}
              >
                {conSigno(m.cantidad)}
              </span>
            ),
          },
          {
            key: "stock",
            header: "Stock",
            className: "text-right",
            cell: (m) => (
              <span className="tabular-nums">
                {m.stockAnterior} → {m.stockPosterior}
              </span>
            ),
          },
          ...(verCostos
            ? [
                {
                  key: "costo",
                  header: "Costo",
                  className: "text-right",
                  cell: (m: MovimientoListado) =>
                    m.costoUnitario === null ? "—" : formatearPesos(m.costoUnitario),
                  ocultarEnMobile: true,
                },
              ]
            : []),
          { key: "usuario", header: "Usuario", cell: (m) => m.usuario, ocultarEnMobile: true },
          {
            key: "motivo",
            header: "Motivo",
            cell: (m) => <span className="text-muted">{m.motivo ?? "—"}</span>,
            ocultarEnMobile: true,
          },
        ]}
      />
      {total > movimientos.length && (
        <p className="mt-3 text-sm">
          Mostrando los últimos {movimientos.length} de {total}.{" "}
          <Link href={hrefTodos} className="text-primary hover:underline">
            Ver todos en Movimientos
          </Link>
        </p>
      )}
    </>
  );
}
