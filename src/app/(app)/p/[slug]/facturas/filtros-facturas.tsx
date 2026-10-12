"use client";

import { Input } from "@/components/ui/input";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { useUrlParams } from "@/hooks/use-url-params";

/** Filtros del listado de facturas (en la URL). */
export function FiltrosFacturas({
  params,
  tipos,
  estados,
}: {
  params: Record<string, string>;
  tipos: { value: string; label: string }[];
  estados: { value: string; label: string }[];
}) {
  const { actualizar } = useUrlParams();
  return (
    <section
      aria-label="Filtros"
      className="bg-card rounded-card mb-4 grid gap-3 p-4 md:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))]"
    >
      <SearchInput placeholder="Número, número fiscal, venta o cliente" />
      <Input
        type="date"
        aria-label="Desde"
        value={params.desde ?? ""}
        onChange={(e) => actualizar({ desde: e.target.value || null })}
      />
      <Input
        type="date"
        aria-label="Hasta"
        value={params.hasta ?? ""}
        onChange={(e) => actualizar({ hasta: e.target.value || null })}
      />
      <Select
        aria-label="Tipo"
        options={[{ value: "", label: "Todos los tipos" }, ...tipos]}
        value={params.tipo ?? ""}
        onChange={(e) => actualizar({ tipo: e.target.value || null })}
      />
      <Select
        aria-label="Estado"
        options={[{ value: "", label: "Todos los estados" }, ...estados]}
        value={params.estado ?? ""}
        onChange={(e) => actualizar({ estado: e.target.value || null })}
      />
    </section>
  );
}
