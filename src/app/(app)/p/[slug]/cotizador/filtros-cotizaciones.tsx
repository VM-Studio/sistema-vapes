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
    <div className="mb-4 flex flex-col gap-3">
      <SearchInput placeholder="Código (VAP-Q-000012 o 12) o cliente" />
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
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
        <label className="text-muted flex flex-col gap-1 text-xs">
          Desde
          <input
            type="date"
            className={cn(controlClass, "h-11")}
            value={params.desde ?? ""}
            onChange={(e) => actualizar({ desde: e.target.value || null })}
          />
        </label>
        <label className="text-muted flex flex-col gap-1 text-xs">
          Hasta
          <input
            type="date"
            className={cn(controlClass, "h-11")}
            value={params.hasta ?? ""}
            onChange={(e) => actualizar({ hasta: e.target.value || null })}
          />
        </label>
      </div>
    </div>
  );
}
