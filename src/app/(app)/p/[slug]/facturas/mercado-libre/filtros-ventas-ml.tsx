"use client";

import { Input } from "@/components/ui/input";
import { SearchInput } from "@/components/ui/search-input";
import { useUrlParams } from "@/hooks/use-url-params";

/** Filtros de Ventas Mercado Libre (en la URL): período de la venta y texto (el estado, con las tarjetas). */
export function FiltrosVentasML({ params }: { params: Record<string, string> }) {
  const { actualizar } = useUrlParams();
  return (
    <section
      aria-label="Filtros"
      className="bg-card rounded-card mb-4 grid gap-3 p-4 md:grid-cols-[minmax(0,2fr)_repeat(2,minmax(0,1fr))]"
    >
      <SearchInput placeholder="ID de venta o cliente" />
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
    </section>
  );
}
