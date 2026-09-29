"use client";

import { EstadoCotizacion } from "@prisma/client";

import { controlClass } from "@/components/ui/field";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { useUrlParams } from "@/hooks/use-url-params";
import { cn } from "@/lib/utils";

import { ESTADO_COTIZACION_UI } from "./estado-cotizacion";

export function FiltrosCotizaciones({
  params,
  vendedores,
}: {
  params: Record<string, string>;
  vendedores: { id: string; nombre: string }[];
}) {
  const { actualizar } = useUrlParams();
  return (
    <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
      <SearchInput placeholder="Código (VAP-Q-000012 o 12) o cliente" />
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:w-[40rem]">
        <Select
          aria-label="Estado"
          containerClassName="self-end"
          options={[
            { value: "", label: "Todos los estados" },
            ...Object.values(EstadoCotizacion).map((e) => ({
              value: e,
              label: ESTADO_COTIZACION_UI[e].label,
            })),
          ]}
          value={params.estado ?? ""}
          onChange={(e) => actualizar({ estado: e.target.value || null })}
        />
        <Select
          aria-label="Vendedor"
          containerClassName="self-end"
          options={[
            { value: "", label: "Todos los vendedores" },
            ...vendedores.map((u) => ({ value: u.id, label: u.nombre })),
          ]}
          value={params.vendedorId ?? ""}
          onChange={(e) => actualizar({ vendedorId: e.target.value || null })}
        />
        <label className="relative flex flex-col">
          <span className="sr-only">Desde</span>
          <span
            className="text-subtle pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-xs"
            aria-hidden
          >
            Desde
          </span>
          <input
            type="date"
            className={cn(controlClass, "h-11 pl-14 md:h-10")}
            value={params.desde ?? ""}
            onChange={(e) => actualizar({ desde: e.target.value || null })}
          />
        </label>
        <label className="relative flex flex-col">
          <span className="sr-only">Hasta</span>
          <span
            className="text-subtle pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-xs"
            aria-hidden
          >
            Hasta
          </span>
          <input
            type="date"
            className={cn(controlClass, "h-11 pl-14 md:h-10")}
            value={params.hasta ?? ""}
            onChange={(e) => actualizar({ hasta: e.target.value || null })}
          />
        </label>
      </div>
    </div>
  );
}
