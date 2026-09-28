"use client";

import { TipoVenta } from "@prisma/client";

import { usePanel, useRutaPanel } from "@/components/layout/panel-context";
import { ChipLink, ChipRow } from "@/components/ui/chip";
import { controlClass } from "@/components/ui/field";
import { hrefCon } from "@/components/ui/pagination";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { useUrlParams } from "@/hooks/use-url-params";
import { RANGO_LABEL, RANGOS, type Rango } from "@/lib/fechas";
import { formatearIdVenta } from "@/lib/paneles";
import { cn } from "@/lib/utils";
import { ETIQUETA_MEDIO_PAGO, ETIQUETA_TIPO_VENTA, MEDIOS_PAGO } from "@/lib/ventas-ui";

export function FiltrosVentas({
  params,
  rango,
  fechas,
  depositos,
  vendedores,
}: {
  params: Record<string, string>;
  rango: Rango | "todo" | null;
  fechas: { desde: string; hasta: string };
  depositos: { id: string; nombre: string }[];
  vendedores: { id: string; nombre: string }[];
}) {
  const { actualizar } = useUrlParams();
  const ruta = useRutaPanel();
  const { slug } = usePanel();
  const link = (cambios: Record<string, string | null>) =>
    hrefCon(ruta("/ventas"), params, { page: null, ...cambios });
  return (
    <div className="mb-4 flex flex-col gap-3">
      <SearchInput
        placeholder={`ID de venta (${formatearIdVenta(slug, 123)} o 123), cliente o teléfono`}
      />
      <ChipRow ariaLabel="Período">
        {RANGOS.map((r) => (
          <ChipLink
            key={r}
            href={link({ rango: r, desde: null, hasta: null })}
            activo={rango === r}
          >
            {RANGO_LABEL[r]}
          </ChipLink>
        ))}
        <ChipLink
          href={link({ rango: "todo", desde: null, hasta: null })}
          activo={rango === "todo"}
        >
          Todo
        </ChipLink>
      </ChipRow>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
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
          aria-label="Galpón"
          containerClassName="self-end"
          options={[
            { value: "", label: "Todos los galpones" },
            ...depositos.map((d) => ({ value: d.id, label: d.nombre })),
          ]}
          value={params.depositoId ?? ""}
          onChange={(e) => actualizar({ depositoId: e.target.value || null })}
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
        <Select
          aria-label="Medio de pago"
          containerClassName="self-end"
          options={[
            { value: "", label: "Todos los medios" },
            ...MEDIOS_PAGO.map((m) => ({ value: m, label: ETIQUETA_MEDIO_PAGO[m] })),
          ]}
          value={params.medioPago ?? ""}
          onChange={(e) => actualizar({ medioPago: e.target.value || null })}
        />
        <Select
          aria-label="Tipo de venta"
          containerClassName="self-end"
          options={[
            { value: "", label: "Unitarias y mayoristas" },
            ...Object.values(TipoVenta).map((t) => ({ value: t, label: ETIQUETA_TIPO_VENTA[t] })),
          ]}
          value={params.tipo ?? ""}
          onChange={(e) => actualizar({ tipo: e.target.value || null })}
        />
      </div>
    </div>
  );
}
