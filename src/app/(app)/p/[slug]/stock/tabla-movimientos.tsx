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
import { FAMILIAS, FAMILIAS_MOVIMIENTO, TIPO_MOVIMIENTO_UI } from "@/lib/movimientos-ui";
import { cn, formatearFechaHora } from "@/lib/utils";
import type { MovimientoListado } from "@/server/services/stock.service";

/**
 * Badge del tipo de movimiento: ingresos en verde, salidas en rojo,
 * transferencias en gris oscuro, ajustes en alerta y garantías en gris.
 * Un retiro (sin cambio de cantidad) va en gris: «Retiro».
 */
export function BadgeTipoMovimiento({
  tipo,
  evento = "MOVIMIENTO",
}: {
  tipo: TipoMovimiento;
  evento?: MovimientoListado["evento"];
}) {
  if (evento === "RETIRO")
    return (
      <Badge variant="neutral" className="bg-surface-3 text-foreground">
        Retiro
      </Badge>
    );
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

/**
 * El texto fácil del movimiento ("Venta VAP-000123 a Juan") con el código de
 * la referencia como link al documento.
 */
export function DescripcionMovimiento({ m }: { m: MovimientoListado }) {
  const ref = m.referencia;
  const i = ref ? m.descripcion.indexOf(ref.etiqueta) : -1;
  if (!ref || i < 0 || !ref.href) return <span>{m.descripcion}</span>;
  return (
    <span>
      {m.descripcion.slice(0, i)}
      <Link
        href={ref.href}
        className="text-foreground font-medium underline underline-offset-4 hover:decoration-2"
      >
        {ref.etiqueta}
      </Link>
      {m.descripcion.slice(i + ref.etiqueta.length)}
    </span>
  );
}

/** Cantidad con signo (verde entra / rojo sale); un retiro muestra las unidades sin signo. */
export function CantidadMovimiento({
  m,
  grande = false,
}: {
  m: MovimientoListado;
  grande?: boolean;
}) {
  if (m.evento === "RETIRO")
    return (
      <span
        className={cn("text-muted font-semibold tabular-nums", grande && "text-2xl tracking-tight")}
        title="No cambia el stock: se descontó al vender"
      >
        {m.cantidad} u.
      </span>
    );
  return (
    <span
      className={cn(
        "font-semibold tabular-nums",
        grande && "text-2xl tracking-tight",
        m.cantidad > 0 ? "text-success" : "text-danger",
      )}
    >
      {conSigno(m.cantidad)}
    </span>
  );
}

/** Anterior → posterior (un retiro no cambia la cantidad). */
export function StockAntesDespues({ m }: { m: MovimientoListado }) {
  if (m.evento === "RETIRO") return <span className="text-subtle">sin cambio</span>;
  return (
    <>
      {m.stockAnterior} → <strong className="text-foreground">{m.stockPosterior}</strong>
    </>
  );
}

/**
 * Ledger en tabla (desktop) o cards (mobile): fecha, qué pasó ("Venta
 * VAP-000123 a Juan", con link), producto — sabor, cantidad con signo,
 * anterior → posterior, usuario y motivo. `conDeposito`: columna galpón (vista
 * de todos los galpones). Los retiros (el cliente se llevó lo vendido) se
 * mezclan por fecha, sin cambio de cantidad.
 */
export function TablaMovimientos({
  movimientos,
  conDeposito,
  conProducto = true,
  vacio = "No hay movimientos con esos filtros",
}: {
  movimientos: MovimientoListado[];
  conDeposito: boolean;
  /** false: el ledger de un solo producto (se muestra solo el sabor). */
  conProducto?: boolean;
  vacio?: string;
}) {
  const ruta = useRutaPanel();
  if (movimientos.length === 0) return <EmptyState icon={History} title={vacio} />;

  const encabezados = [
    "Fecha",
    "Movimiento",
    conProducto ? "Producto" : "Sabor",
    ...(conDeposito ? ["Galpón"] : []),
    "Cantidad",
    "Anterior → posterior",
    "Usuario",
    "Motivo",
  ];
  const aLaDerecha = new Set(["Cantidad", "Anterior → posterior"]);
  const nombre = (m: MovimientoListado) =>
    conProducto ? m.nombre : (m.nombre.split(" — ")[1] ?? m.nombre);

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
              <tr
                key={m.id}
                className={cn(
                  "hover:bg-card/60 align-top transition-colors",
                  m.evento === "RETIRO" && "bg-card/40",
                )}
                data-evento={m.evento}
              >
                <td className="text-muted px-4 py-3 whitespace-nowrap">
                  {formatearFechaHora(m.fecha)}
                </td>
                <td className="px-4 py-3">
                  <BadgeTipoMovimiento tipo={m.tipo} evento={m.evento} />
                  <span className="mt-1 block max-w-72 text-sm">
                    <DescripcionMovimiento m={m} />
                  </span>
                </td>
                <td className="px-4 py-3">
                  <Link
                    href={ruta(`/productos/${m.productoId}`)}
                    className="font-medium hover:underline"
                  >
                    {nombre(m)}
                  </Link>
                  <span className="text-muted block font-mono text-xs">{m.sku}</span>
                </td>
                {conDeposito && <td className="px-4 py-3">{m.deposito}</td>}
                <td className="px-4 py-3 text-right">
                  <CantidadMovimiento m={m} />
                </td>
                <td className="text-muted px-4 py-3 text-right whitespace-nowrap tabular-nums">
                  <StockAntesDespues m={m} />
                </td>
                <td className="px-4 py-3">{m.usuario}</td>
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
          <li key={m.id} className="bg-card rounded-card p-4" data-evento={m.evento}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <BadgeTipoMovimiento tipo={m.tipo} evento={m.evento} />
                <p className="mt-2 text-sm">
                  <DescripcionMovimiento m={m} />
                </p>
                <p className="mt-1 font-medium">{nombre(m)}</p>
                <p className="text-muted text-xs">
                  {conDeposito && `${m.deposito} · `}
                  {formatearFechaHora(m.fecha)} · {m.usuario}
                </p>
              </div>
              <div className="text-right">
                <p>
                  <CantidadMovimiento m={m} grande />
                </p>
                <p className="text-muted text-xs tabular-nums">
                  <StockAntesDespues m={m} />
                </p>
              </div>
            </div>
            {m.motivo && (
              <p className="border-border text-muted mt-3 border-t pt-3 text-sm">{m.motivo}</p>
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
          { value: "", label: "Todos los movimientos" },
          ...FAMILIAS.map((f) => ({ value: f, label: FAMILIAS_MOVIMIENTO[f].label })),
        ]}
        value={params.get("mfamilia") ?? ""}
        onChange={(e) =>
          actualizar({
            mfamilia: e.target.value || null,
            mtipo: null,
            mpage: null,
            page: params.get("page"),
          })
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
