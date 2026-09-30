"use client";

import { TipoMovimiento } from "@prisma/client";
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

/**
 * Badge del tipo de movimiento: ingresos en verde, salidas en rojo,
 * transferencias en gris oscuro, ajustes en alerta y garantías en gris.
 */
export function BadgeTipoMovimiento({ tipo }: { tipo: TipoMovimiento }) {
  const ui = TIPO_MOVIMIENTO_UI[tipo];
  const transferencia =
    tipo === TipoMovimiento.TRANSFERENCIA_SALIDA || tipo === TipoMovimiento.TRANSFERENCIA_ENTRADA;
  const garantia = tipo === TipoMovimiento.GARANTIA;
  return (
    <Badge
      variant={transferencia || garantia ? "neutral" : ui.variante}
      className={cn(transferencia && "bg-surface-3 text-foreground")}
    >
      {ui.label}
    </Badge>
  );
}

function Referencia({ m }: { m: MovimientoListado }) {
  if (!m.referencia) return <span className="text-subtle">—</span>;
  return m.referencia.href ? (
    <Link
      href={m.referencia.href}
      className="text-foreground font-medium underline underline-offset-4 hover:decoration-2"
    >
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
      <div className="border-border bg-surface rounded-card hidden overflow-x-auto border md:block">
        <table className="w-full text-left text-sm tabular-nums">
          <caption className="sr-only">Movimientos de stock</caption>
          <thead className="border-border bg-card text-muted border-b text-xs">
            <tr>
              {encabezados.map((h) => (
                <th
                  key={h}
                  scope="col"
                  className={cn(
                    "h-10 px-4 font-medium whitespace-nowrap",
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
              <tr key={m.id} className="hover:bg-card/60 align-top transition-colors">
                <td className="text-muted px-4 py-3 whitespace-nowrap">
                  {formatearFechaHora(m.fecha)}
                </td>
                <td className="px-4 py-3">
                  <BadgeTipoMovimiento tipo={m.tipo} />
                </td>
                <td className="px-4 py-3">
                  <Link
                    href={ruta(`/productos/${m.productoId}`)}
                    className="font-medium hover:underline"
                  >
                    {m.nombre}
                  </Link>
                  <span className="text-muted block font-mono text-xs">{m.sku}</span>
                </td>
                {conDeposito && <td className="px-4 py-3">{m.deposito}</td>}
                <td
                  className={cn(
                    "px-4 py-3 text-right font-semibold tabular-nums",
                    m.cantidad > 0 ? "text-success" : "text-danger",
                  )}
                >
                  {conSigno(m.cantidad)}
                </td>
                <td className="text-muted px-4 py-3 text-right whitespace-nowrap tabular-nums">
                  {m.stockAnterior} →{" "}
                  <strong className="text-foreground">{m.stockPosterior}</strong>
                </td>
                <td className="px-4 py-3">{m.usuario}</td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <Referencia m={m} />
                </td>
                <td className="text-muted max-w-56 px-4 py-3">
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
          <li key={m.id} className="bg-card rounded-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <BadgeTipoMovimiento tipo={m.tipo} />
                <p className="mt-2 font-medium">{m.nombre}</p>
                <p className="text-muted text-xs">
                  {conDeposito && `${m.deposito} · `}
                  {formatearFechaHora(m.fecha)} · {m.usuario}
                </p>
              </div>
              <div className="text-right">
                <p
                  className={cn(
                    "text-2xl font-semibold tracking-tight tabular-nums",
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
              <p className="border-border text-muted mt-3 border-t pt-3 text-sm">
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
    <div
      role="group"
      aria-label="Filtros de movimientos"
      className="grid grid-cols-2 gap-2 md:flex md:flex-wrap md:items-center"
    >
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
        containerClassName="col-span-2 md:w-60"
      />
      <CampoFecha
        etiqueta="Desde"
        valor={params.get("mdesde") ?? ""}
        onCambio={(v) => actualizar({ mdesde: v || null, mpage: null, page: params.get("page") })}
      />
      <CampoFecha
        etiqueta="Hasta"
        valor={params.get("mhasta") ?? ""}
        onCambio={(v) => actualizar({ mhasta: v || null, mpage: null, page: params.get("page") })}
      />
    </div>
  );
}

/** Fecha con la etiqueta dentro del control (entra en una barra de filtros). */
export function CampoFecha({
  etiqueta,
  valor,
  onCambio,
  className,
}: {
  etiqueta: string;
  valor: string;
  onCambio: (v: string) => void;
  className?: string;
}) {
  return (
    <label className={cn("relative flex min-w-0 md:w-44", className)}>
      <span className="text-subtle pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-xs">
        {etiqueta}
      </span>
      <input
        type="date"
        aria-label={etiqueta}
        className={cn(controlClass, "h-11 pl-14 md:h-10")}
        value={valor}
        onChange={(e) => onCambio(e.target.value)}
      />
    </label>
  );
}
