"use client";

import { X } from "lucide-react";
import type { ReactNode } from "react";

import { VariantePicker } from "@/components/catalogo/variante-picker";
import type { VarianteEncontrada } from "@/features/scanner/tipos";
import { useRutaPanel } from "@/components/layout/panel-context";
import { ChipLink, ChipRow } from "@/components/ui/chip";
import { controlClass } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { hrefCon, Pagination } from "@/components/ui/pagination";
import { Select } from "@/components/ui/select";
import { useUrlParams } from "@/hooks/use-url-params";
import { RANGO_LABEL, RANGOS, type Rango } from "@/lib/fechas";
import { TIPO_MOVIMIENTO_UI, TIPOS_MOVIMIENTO_FILTRO } from "@/lib/movimientos-ui";
import { cn } from "@/lib/utils";
import type { MovimientoListado } from "@/server/services/stock.service";

import { TablaMovimientos } from "../tabla-movimientos";

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
  varianteFiltro: VarianteEncontrada | null;
  productoFiltro: { id: string; nombre: string } | null;
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
            className="border-primary bg-primary-soft text-primary-soft-foreground flex min-h-11 items-center justify-between gap-2 rounded-control border px-3 text-sm"
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
              ...TIPOS_MOVIMIENTO_FILTRO.map((t) => ({
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
              <span className="border-primary bg-primary-soft text-primary-soft-foreground flex h-11 items-center justify-between gap-2 rounded-control border px-3 text-sm">
                <span className="truncate">
                  {varianteFiltro?.titulo ?? `${productoFiltro?.nombre} (todas las variantes)`}
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
                onSelect={(v) => actualizar({ varianteId: v.varianteId })}
              />
            )}
          </div>
        </div>
      </div>

      <TablaMovimientos movimientos={movimientos} conDeposito={!deposito} />
      <Pagination
        className="mt-4"
        page={resultado.page}
        pageSize={resultado.pageSize}
        total={resultado.total}
        pathname={PATH}
        params={params}
      />
    </>
  );
}
