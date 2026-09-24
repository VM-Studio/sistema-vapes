import { History } from "lucide-react";

import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { formatearPesos } from "@/lib/format";
import { cn, formatearFechaHora } from "@/lib/utils";
import type { HistorialPrecioDTO } from "@/server/services/producto.service";

function Cambio({ antes, despues }: { antes: string; despues: string }) {
  if (antes === despues)
    return <span className="text-muted tabular-nums">{formatearPesos(antes)}</span>;
  const sube = Number(despues) > Number(antes);
  return (
    <span className="whitespace-nowrap tabular-nums">
      <span className="text-muted line-through">{formatearPesos(antes)}</span>{" "}
      <strong className={cn(sube ? "text-success" : "text-danger")}>
        {formatearPesos(despues)}
      </strong>
    </span>
  );
}

export function HistorialPrecios({ filas }: { filas: HistorialPrecioDTO[] }) {
  return (
    <DataTable
      caption="Historial de precios"
      rows={filas}
      getRowKey={(h) => h.id}
      empty={<EmptyState icon={History} title="Sin cambios de precio todavía" />}
      columns={[
        {
          key: "fecha",
          header: "Fecha",
          cell: (h) => (
            <span className="text-muted whitespace-nowrap">{formatearFechaHora(h.fecha)}</span>
          ),
        },
        { key: "variante", header: "Variante", cell: (h) => h.variante },
        {
          key: "costo",
          header: "Costo",
          cell: (h) => <Cambio antes={h.precioCostoAnterior} despues={h.precioCostoNuevo} />,
        },
        {
          key: "venta",
          header: "Venta",
          cell: (h) => <Cambio antes={h.precioVentaAnterior} despues={h.precioVentaNuevo} />,
        },
        { key: "usuario", header: "Usuario", cell: (h) => h.usuario },
        {
          key: "motivo",
          header: "Motivo",
          cell: (h) => <span className="text-muted">{h.motivo ?? "—"}</span>,
        },
      ]}
    />
  );
}
