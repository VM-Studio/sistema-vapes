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
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
      <Select
        aria-label="Proveedor"
        options={[
          { value: "", label: "Todos los proveedores" },
          ...proveedores.map((p) => ({ value: p.id, label: `${p.nombre} (${p.nombreTienda})` })),
        ]}
        value={params.proveedorId ?? ""}
        onChange={(e) => actualizar({ proveedorId: e.target.value || null })}
        containerClassName="col-span-2 self-end md:col-span-2"
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
  );
}
