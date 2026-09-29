"use client";

import { X } from "lucide-react";
import type { ReactNode } from "react";

import { VariantePicker } from "@/components/catalogo/variante-picker";
import type { VarianteEncontrada } from "@/features/scanner/tipos";
import { useRutaPanel } from "@/components/layout/panel-context";
import { ChipLink, ChipRow } from "@/components/ui/chip";
import { PageHeader } from "@/components/ui/page-header";
import { hrefCon, Pagination } from "@/components/ui/pagination";
import { Select } from "@/components/ui/select";
import { useUrlParams } from "@/hooks/use-url-params";
import { RANGO_LABEL, RANGOS, type Rango } from "@/lib/fechas";
import { TIPO_MOVIMIENTO_UI, TIPOS_MOVIMIENTO_FILTRO } from "@/lib/movimientos-ui";
import type { MovimientoListado } from "@/server/services/stock.service";

import { CampoFecha, TablaMovimientos } from "../tabla-movimientos";

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
            className="bg-card flex min-h-11 items-center justify-between gap-2 rounded-control pl-3 text-sm"
          >
            <span>
              Solo los movimientos de{" "}
              <strong>{movimientos[0]?.referencia?.etiqueta ?? "la referencia elegida"}</strong>
            </span>
            <button
              type="button"
              onClick={() => actualizar({ referenciaTipo: null, referenciaId: null })}
              aria-label="Quitar filtro de referencia"
              className="text-muted hover:bg-surface-3 hover:text-foreground flex size-11 items-center justify-center rounded-control"
            >
              <X className="size-5" strokeWidth={1.75} />
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

        <div
          role="group"
          aria-label="Filtros"
          className="grid grid-cols-2 gap-2 md:flex md:flex-wrap md:items-center"
        >
          <CampoFecha
            etiqueta="Desde"
            valor={fechas.desde}
            onCambio={(v) => actualizar({ desde: v || null, rango: null })}
          />
          <CampoFecha
            etiqueta="Hasta"
            valor={fechas.hasta}
            onCambio={(v) => actualizar({ hasta: v || null, rango: null })}
          />
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
            containerClassName="md:w-56"
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
            containerClassName="md:w-48"
          />
          <div className="col-span-2 md:min-w-64 md:flex-1">
            {varianteFiltro || productoFiltro ? (
              <span className="bg-card flex h-11 items-center justify-between gap-2 rounded-control pl-3 text-sm md:h-10">
                <span className="truncate">
                  {varianteFiltro?.titulo ?? `${productoFiltro?.nombre} (todas las variantes)`}
                </span>
                <button
                  type="button"
                  onClick={() => actualizar({ varianteId: null, productoId: null })}
                  aria-label="Quitar filtro de producto"
                  className="text-muted hover:bg-surface-3 hover:text-foreground flex size-11 shrink-0 items-center justify-center rounded-control md:size-10"
                >
                  <X className="size-5" strokeWidth={1.75} />
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
