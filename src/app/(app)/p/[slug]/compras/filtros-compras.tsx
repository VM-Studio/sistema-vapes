"use client";

import { controlClass } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { useUrlParams } from "@/hooks/use-url-params";
import { cn } from "@/lib/utils";

export function FiltrosCompras({
  params,
  proveedores,
}: {
  params: Record<string, string>;
  proveedores: { id: string; nombre: string; nombreTienda: string }[];
}) {
  const { actualizar } = useUrlParams();
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-[minmax(0,16rem)_10rem_10rem] lg:shrink-0">
      <Select
        label="Proveedor"
        aria-label="Proveedor"
        options={[
          { value: "", label: "Todos los proveedores" },
          ...proveedores.map((p) => ({ value: p.id, label: `${p.nombre} (${p.nombreTienda})` })),
        ]}
        value={params.proveedorId ?? ""}
        onChange={(e) => actualizar({ proveedorId: e.target.value || null })}
        containerClassName="col-span-2 md:col-span-1"
      />
      <label className="text-small flex flex-col gap-1.5 font-medium">
        Desde
        <input
          type="date"
          className={cn(controlClass, "h-11 md:h-10")}
          value={params.desde ?? ""}
          onChange={(e) => actualizar({ desde: e.target.value || null })}
        />
      </label>
      <label className="text-small flex flex-col gap-1.5 font-medium">
        Hasta
        <input
          type="date"
          className={cn(controlClass, "h-11 md:h-10")}
          value={params.hasta ?? ""}
          onChange={(e) => actualizar({ hasta: e.target.value || null })}
        />
      </label>
    </div>
  );
}
