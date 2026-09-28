"use client";

import { TipoMovimiento } from "@prisma/client";
import { History, X } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { VariantePicker, type VarianteBuscada } from "@/components/catalogo/variante-picker";
import { useRutaPanel } from "@/components/layout/panel-context";
import { Badge } from "@/components/ui/badge";
import { ChipLink, ChipRow } from "@/components/ui/chip";
import { controlClass } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { hrefCon, Pagination } from "@/components/ui/pagination";
import { Select } from "@/components/ui/select";
import { useUrlParams } from "@/hooks/use-url-params";
import { RANGO_LABEL, RANGOS, type Rango } from "@/lib/fechas";
import { conSigno, formatearPesos } from "@/lib/format";
import { TIPO_MOVIMIENTO_UI } from "@/lib/movimientos-ui";
import { cn, formatearFechaHora } from "@/lib/utils";
import type { MovimientoListado } from "@/server/services/movimiento.service";

interface Props {
  resultado: { movimientos: MovimientoListado[]; total: number; page: number; pageSize: number };
  params: Record<string, string>;
  rango: Rango | null;
  fechas: { desde: string; hasta: string };
  /** Depósito elegido (null = Global, todos los depósitos). */
  deposito: string | null;
  /** Selector Global / depósito (lo arma el servidor). */
  selector: ReactNode;
  usuarios: { id: string; nombre: string; activo: boolean }[];
  varianteFiltro: VarianteBuscada | null;
  productoFiltro: { id: string; nombre: string } | null;
}

function Referencia({ m }: { m: MovimientoListado }) {
  if (!m.referencia) return <span className="text-muted">—</span>;
  return m.referencia.href ? (
    <Link href={m.referencia.href} className="text-primary hover:underline">
      {m.referencia.etiqueta}
    </Link>
  ) : (
    <span className="text-muted">{m.referencia.etiqueta}</span>
  );
}

export function LedgerView({
  resultado,
  params,
  rango,
  fechas,
  deposito,
  selector,
  usuarios,
  varianteFiltro,
  productoFiltro,
}: Props) {
  const ruta = useRutaPanel();
  const PATH = ruta("/stock/movimientos");
  const { actualizar } = useUrlParams();
  const link = (cambios: Record<string, string | null>) =>
    hrefCon(PATH, params, { page: null, ...cambios });
  const { movimientos } = resultado;

  return (
    <>
      <PageHeader
        title="Movimientos"
        subtitle={`${resultado.total} movimientos ${deposito ? `en ${deposito}` : "de todos los depósitos"} · historial inmutable del stock`}
      />
      <div className="mb-4 flex flex-col gap-3">
        {selector}
        {params.referenciaId && (
          <div
            role="status"
            className="border-primary bg-primary-soft text-primary-soft-foreground flex min-h-11 items-center justify-between gap-2 rounded-lg border px-3 text-sm"
          >
            <span>
              Solo los movimientos de{" "}
              <strong>{movimientos[0]?.referencia?.etiqueta ?? "la referencia elegida"}</strong>
            </span>
            <button
              type="button"
              onClick={() => actualizar({ referenciaTipo: null, referenciaId: null })}
              aria-label="Quitar filtro de referencia"
              className="-mr-1 p-1"
            >
              <X className="size-4" strokeWidth={1.75} />
            </button>
          </div>
        )}
        <ChipRow ariaLabel="Rango de fechas">
          <ChipLink
            href={link({ rango: null, desde: null, hasta: null })}
            activo={!rango && !fechas.desde && !fechas.hasta}
          >
            Todo
          </ChipLink>
          {RANGOS.map((r) => (
            <ChipLink
              key={r}
              href={link({ rango: r, desde: null, hasta: null })}
              activo={rango === r}
            >
              {RANGO_LABEL[r]}
            </ChipLink>
          ))}
        </ChipRow>

        <div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-5">
          <label className="text-muted flex flex-col gap-1 text-xs">
            Desde
            <input
              type="date"
              className={cn(controlClass, "h-11")}
              value={fechas.desde}
              onChange={(e) => actualizar({ desde: e.target.value || null, rango: null })}
            />
          </label>
          <label className="text-muted flex flex-col gap-1 text-xs">
            Hasta
            <input
              type="date"
              className={cn(controlClass, "h-11")}
              value={fechas.hasta}
              onChange={(e) => actualizar({ hasta: e.target.value || null, rango: null })}
            />
          </label>
          <Select
            aria-label="Tipo"
            options={[
              { value: "", label: "Todos los tipos" },
              ...Object.values(TipoMovimiento).map((t) => ({
                value: t,
                label: TIPO_MOVIMIENTO_UI[t].label,
              })),
            ]}
            value={params.tipo ?? ""}
            onChange={(e) => actualizar({ tipo: e.target.value || null })}
            containerClassName="self-end"
          />
          <Select
            aria-label="Usuario"
            options={[
              { value: "", label: "Todos los usuarios" },
              ...usuarios.map((u) => ({
                value: u.id,
                label: u.activo ? u.nombre : `${u.nombre} (baja)`,
              })),
            ]}
            value={params.usuarioId ?? ""}
            onChange={(e) => actualizar({ usuarioId: e.target.value || null })}
            containerClassName="self-end"
          />
          <div className="col-span-2 self-end md:col-span-4 lg:col-span-1">
            {varianteFiltro || productoFiltro ? (
              <span className="border-primary bg-primary-soft text-primary-soft-foreground flex h-11 items-center justify-between gap-2 rounded-lg border px-3 text-sm">
                <span className="truncate">
                  {varianteFiltro?.nombreCompleto ??
                    `${productoFiltro?.nombre} (todas las variantes)`}
                </span>
                <button
                  type="button"
                  onClick={() => actualizar({ varianteId: null, productoId: null })}
                  aria-label="Quitar filtro de producto"
                  className="-mr-1 p-1"
                >
                  <X className="size-4" strokeWidth={1.75} />
                </button>
              </span>
            ) : (
              <VariantePicker
                placeholder="Filtrar por producto…"
                onSelect={(v) => actualizar({ varianteId: v.id })}
              />
            )}
          </div>
        </div>
      </div>

      {movimientos.length === 0 ? (
        <EmptyState icon={History} title="No hay movimientos con esos filtros" />
      ) : (
        <>
          {/* Desktop */}
          <div className="border-border bg-surface hidden overflow-x-auto rounded-2xl border md:block">
            <table className="w-full text-sm">
              <caption className="sr-only">Movimientos de stock</caption>
              <thead className="border-border bg-surface-2/60 text-muted border-b text-xs tracking-wide uppercase">
                <tr>
                  {[
                    "Fecha",
                    "Tipo",
                    "Producto",
                    "Depósito",
                    "Cantidad",
                    "Stock",
                    "Usuario",
                    "Referencia",
                    "Motivo",
                  ].map((h, i) => (
                    <th
                      key={h}
                      scope="col"
                      className={cn(
                        "px-3 py-3 font-medium",
                        i === 4 || i === 5 ? "text-right" : "text-left",
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
                    <td className="px-3 py-2.5">{m.deposito}</td>
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
                    <td className="px-3 py-2.5">
                      <Referencia m={m} />
                    </td>
                    <td className="text-muted max-w-56 px-3 py-2.5">
                      {m.motivo ?? "—"}
                      {m.costoUnitario && (
                        <span className="block text-xs">
                          Costo {formatearPesos(m.costoUnitario)}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile */}
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
                      {m.deposito} · {formatearFechaHora(m.fecha)} · {m.usuario}
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
          <Pagination
            className="mt-4"
            page={resultado.page}
            pageSize={resultado.pageSize}
            total={resultado.total}
            pathname={PATH}
            params={params}
          />
        </>
      )}
    </>
  );
}
