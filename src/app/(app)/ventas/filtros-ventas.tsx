"use client";

import { EstadoPago, EstadoVenta, MedioPago } from "@prisma/client";

import { ChipLink, ChipRow } from "@/components/ui/chip";
import { controlClass } from "@/components/ui/field";
import { hrefCon } from "@/components/ui/pagination";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { useUrlParams } from "@/hooks/use-url-params";
import { RANGO_LABEL, RANGOS, type Rango } from "@/lib/fechas";
import { cn } from "@/lib/utils";
import { ESTADO_PAGO_UI, ESTADO_VENTA_UI } from "@/lib/ventas-ui";

import { ETIQUETA_MEDIO } from "./nueva/tipos";

export function FiltrosVentas({
  params,
  rango,
  fechas,
  depositos,
  vendedores,
}: {
  params: Record<string, string>;
  rango: Rango | null;
  fechas: { desde: string; hasta: string };
  depositos: { id: string; nombre: string }[];
  vendedores: { id: string; nombre: string }[];
}) {
  const { actualizar } = useUrlParams();
  const link = (cambios: Record<string, string | null>) =>
    hrefCon("/ventas", params, { page: null, ...cambios });
  return (
    <div className="mb-4 flex flex-col gap-3">
      <SearchInput placeholder="N.º de venta, cliente o DNI" />
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
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
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
          aria-label="Estado"
          containerClassName="self-end"
          options={[
            { value: "", label: "Todos los estados" },
            ...Object.values(EstadoVenta).map((e) => ({
              value: e,
              label: ESTADO_VENTA_UI[e].label,
            })),
          ]}
          value={params.estado ?? ""}
          onChange={(e) => actualizar({ estado: e.target.value || null })}
        />
        <Select
          aria-label="Pago"
          containerClassName="self-end"
          options={[
            { value: "", label: "Todos los pagos" },
            ...Object.values(EstadoPago).map((e) => ({ value: e, label: ESTADO_PAGO_UI[e].label })),
          ]}
          value={params.estadoPago ?? ""}
          onChange={(e) => actualizar({ estadoPago: e.target.value || null })}
        />
        <Select
          aria-label="Medio de pago"
          containerClassName="self-end"
          options={[
            { value: "", label: "Todos los medios" },
            ...Object.values(MedioPago).map((m) => ({ value: m, label: ETIQUETA_MEDIO[m] })),
          ]}
          value={params.medioPago ?? ""}
          onChange={(e) => actualizar({ medioPago: e.target.value || null })}
        />
        <Select
          aria-label="Vendedor"
          containerClassName="self-end"
          options={[
            { value: "", label: "Todos los vendedores" },
            ...vendedores.map((u) => ({ value: u.id, label: u.nombre })),
          ]}
          value={params.usuarioId ?? ""}
          onChange={(e) => actualizar({ usuarioId: e.target.value || null })}
        />
        <Select
          aria-label="Depósito"
          containerClassName="self-end col-span-2 md:col-span-1"
          options={[
            { value: "", label: "Todos los depósitos" },
            ...depositos.map((d) => ({ value: d.id, label: d.nombre })),
          ]}
          value={params.depositoId ?? ""}
          onChange={(e) => actualizar({ depositoId: e.target.value || null })}
        />
      </div>
    </div>
  );
}
