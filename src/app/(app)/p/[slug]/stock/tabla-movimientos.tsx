"use client";

import { History } from "lucide-react";
import Link from "next/link";

import { useRutaPanel } from "@/components/layout/panel-context";
import { Badge } from "@/components/ui/badge";
import { controlClass } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/select";
import { useUrlParams } from "@/hooks/use-url-params";
import { conSigno, formatearPesos } from "@/lib/format";
import { TIPO_MOVIMIENTO_UI, TIPOS_MOVIMIENTO_FILTRO } from "@/lib/movimientos-ui";
import { cn, formatearFechaHora } from "@/lib/utils";
import type { MovimientoListado } from "@/server/services/stock.service";

function Referencia({ m }: { m: MovimientoListado }) {
  if (!m.referencia) return <span className="text-muted">—</span>;
  return m.referencia.href ? (
    <Link href={m.referencia.href} className="text-primary font-medium hover:underline">
      {m.referencia.etiqueta}
    </Link>
  ) : (
    <span className="text-muted">{m.referencia.etiqueta}</span>
  );
}

/**
 * Ledger en tabla (desktop) o cards (mobile): fecha, tipo, producto — sabor,
 * cantidad con signo, anterior → posterior, usuario y referencia con su
 * código visible. `conDeposito`: columna galpón (vista de todos los galpones).
 */
export function TablaMovimientos({
  movimientos,
  conDeposito,
  vacio = "No hay movimientos con esos filtros",
}: {
  movimientos: MovimientoListado[];
  conDeposito: boolean;
  vacio?: string;
}) {
  const ruta = useRutaPanel();
  if (movimientos.length === 0) return <EmptyState icon={History} title={vacio} />;

  const encabezados = [
    "Fecha",
    "Tipo",
    "Producto",
    ...(conDeposito ? ["Galpón"] : []),
    "Cantidad",
    "Anterior → posterior",
    "Usuario",
    "Referencia",
    "Motivo",
  ];
  const aLaDerecha = new Set(["Cantidad", "Anterior → posterior"]);

  return (
    <>
      <div className="border-border bg-surface hidden overflow-x-auto rounded-2xl border md:block">
        <table className="w-full text-sm">
          <caption className="sr-only">Movimientos de stock</caption>
          <thead className="border-border bg-surface-2/60 text-muted border-b text-xs tracking-wide uppercase">
            <tr>
              {encabezados.map((h) => (
                <th
                  key={h}
                  scope="col"
                  className={cn(
                    "px-3 py-3 font-medium",
                    aLaDerecha.has(h) ? "text-right" : "text-left",
                  )}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-border divide-y">
            {movimientos.map((m) => (
              <tr key={m.id} className="hover:bg-surface-2/40 align-top">
                <td className="text-muted px-3 py-2.5 whitespace-nowrap">
                  {formatearFechaHora(m.fecha)}
                </td>
                <td className="px-3 py-2.5">
                  <Badge variant={TIPO_MOVIMIENTO_UI[m.tipo].variante}>
                    {TIPO_MOVIMIENTO_UI[m.tipo].label}
                  </Badge>
                </td>
                <td className="px-3 py-2.5">
                  <Link
                    href={ruta(`/productos/${m.productoId}`)}
                    className="font-medium hover:underline"
                  >
                    {m.nombre}
                  </Link>
                  <span className="text-muted block font-mono text-xs">{m.sku}</span>
                </td>
                {conDeposito && <td className="px-3 py-2.5">{m.deposito}</td>}
                <td
                  className={cn(
                    "px-3 py-2.5 text-right font-semibold tabular-nums",
                    m.cantidad > 0 ? "text-success" : "text-danger",
                  )}
                >
                  {conSigno(m.cantidad)}
                </td>
                <td className="text-muted px-3 py-2.5 text-right whitespace-nowrap tabular-nums">
                  {m.stockAnterior} →{" "}
                  <strong className="text-foreground">{m.stockPosterior}</strong>
                </td>
                <td className="px-3 py-2.5">{m.usuario}</td>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  <Referencia m={m} />
                </td>
                <td className="text-muted max-w-56 px-3 py-2.5">
                  {m.motivo ?? "—"}
                  {m.costoUnitario && (
                    <span className="block text-xs">Costo {formatearPesos(m.costoUnitario)}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="flex flex-col gap-2 md:hidden">
        {movimientos.map((m) => (
          <li key={m.id} className="border-border bg-surface rounded-2xl border p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Badge variant={TIPO_MOVIMIENTO_UI[m.tipo].variante}>
                  {TIPO_MOVIMIENTO_UI[m.tipo].label}
                </Badge>
                <p className="mt-1.5 font-medium">{m.nombre}</p>
                <p className="text-muted text-xs">
                  {conDeposito && `${m.deposito} · `}
                  {formatearFechaHora(m.fecha)} · {m.usuario}
                </p>
              </div>
              <div className="text-right">
                <p
                  className={cn(
                    "text-2xl font-bold tabular-nums",
                    m.cantidad > 0 ? "text-success" : "text-danger",
                  )}
                >
                  {conSigno(m.cantidad)}
                </p>
                <p className="text-muted text-xs tabular-nums">
                  {m.stockAnterior} → {m.stockPosterior}
                </p>
              </div>
            </div>
            {(m.motivo || m.referencia) && (
              <p className="border-border text-muted mt-2 border-t pt-2 text-sm">
                {m.referencia && (
                  <>
                    <Referencia m={m} />
                    {m.motivo && " · "}
                  </>
                )}
                {m.motivo}
              </p>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * Filtros del ledger embebido en la pantalla de Stock: tipo y fechas, con
 * parámetros propios en la URL (`mtipo`, `mdesde`, `mhasta`) para no pisar
 * los filtros del stock.
 */
export function FiltrosMovimientosStock() {
  const { params, actualizar } = useUrlParams();
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-[14rem_10rem_10rem]">
      <Select
        aria-label="Tipo de movimiento"
        options={[
          { value: "", label: "Todos los tipos" },
          ...TIPOS_MOVIMIENTO_FILTRO.map((t) => ({ value: t, label: TIPO_MOVIMIENTO_UI[t].label })),
        ]}
        value={params.get("mtipo") ?? ""}
        onChange={(e) =>
          actualizar({ mtipo: e.target.value || null, mpage: null, page: params.get("page") })
        }
        containerClassName="col-span-2 self-end md:col-span-1"
      />
      <label className="text-muted flex flex-col gap-1 text-xs">
        Desde
        <input
          type="date"
          className={cn(controlClass, "h-11")}
          value={params.get("mdesde") ?? ""}
          onChange={(e) =>
            actualizar({ mdesde: e.target.value || null, mpage: null, page: params.get("page") })
          }
        />
      </label>
      <label className="text-muted flex flex-col gap-1 text-xs">
        Hasta
        <input
          type="date"
          className={cn(controlClass, "h-11")}
          value={params.get("mhasta") ?? ""}
          onChange={(e) =>
            actualizar({ mhasta: e.target.value || null, mpage: null, page: params.get("page") })
          }
        />
      </label>
    </div>
  );
}
