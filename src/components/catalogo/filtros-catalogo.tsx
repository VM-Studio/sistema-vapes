"use client";

import { SlidersHorizontal } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { useUrlParams } from "@/hooks/use-url-params";
import { cn } from "@/lib/utils";

export interface OpcionFiltro {
  value: string;
  label: string;
}

export type FiltroExtra =
  | { tipo: "check"; param: string; label: string }
  | {
      tipo: "select";
      param: string;
      label: string;
      opciones: OpcionFiltro[];
      valorPorDefecto?: string;
    };

interface FiltrosCatalogoProps {
  /** Opcional: sin categorías (o vacío) no se muestra ese filtro. */
  categorias?: OpcionFiltro[];
  marcas: OpcionFiltro[];
  extras?: FiltroExtra[];
  placeholder?: string;
  /** Control extra al principio de la barra (ej: un selector de vista). */
  inicio?: ReactNode;
}

/**
 * Buscador + filtros con estado en la URL.
 * Desktop: todo en línea. Mobile: buscador + botón "Filtros" que abre un Sheet.
 */
export function FiltrosCatalogo({
  categorias = [],
  marcas,
  extras = [],
  placeholder,
  inicio,
}: FiltrosCatalogoProps) {
  const { params, actualizar } = useUrlParams();
  const [abierto, setAbierto] = useState(false);

  const controles = (enSheet: boolean) => (
    <>
      {categorias && categorias.length > 0 && (
        <Select
          label={enSheet ? "Categoría" : undefined}
          aria-label="Categoría"
          options={[{ value: "", label: "Todas las categorías" }, ...categorias]}
          value={params.get("categoriaId") ?? ""}
          onChange={(e) => actualizar({ categoriaId: e.target.value || null })}
          containerClassName={cn(!enSheet && "w-48")}
        />
      )}
      <Select
        label={enSheet ? "Marca" : undefined}
        aria-label="Marca"
        options={[{ value: "", label: "Todas las marcas" }, ...marcas]}
        value={params.get("marcaId") ?? ""}
        onChange={(e) => actualizar({ marcaId: e.target.value || null })}
        containerClassName={cn(!enSheet && "w-44")}
      />
      {extras.map((f) =>
        f.tipo === "check" ? (
          <Checkbox
            key={f.param}
            label={f.label}
            checked={params.get(f.param) === "1"}
            onChange={(e) => actualizar({ [f.param]: e.target.checked })}
            className={cn(!enSheet && "shrink-0")}
          />
        ) : (
          <Select
            key={f.param}
            label={enSheet ? f.label : undefined}
            aria-label={f.label}
            options={f.opciones}
            value={params.get(f.param) ?? f.valorPorDefecto ?? ""}
            onChange={(e) =>
              actualizar({
                [f.param]: e.target.value === (f.valorPorDefecto ?? "") ? null : e.target.value,
              })
            }
            containerClassName={cn(!enSheet && "w-40")}
          />
        ),
      )}
    </>
  );

  const activos = ["categoriaId", "marcaId", ...extras.map((e) => e.param)].filter((p) =>
    params.get(p),
  ).length;

  return (
    <div role="search" className="mb-4 flex flex-col gap-2 md:flex-row md:items-center">
      {inicio}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <SearchInput placeholder={placeholder} className="flex-1" />
        <Button
          variant="secondary"
          className="shrink-0 md:hidden"
          onClick={() => setAbierto(true)}
          aria-label={`Filtros${activos ? ` (${activos} activos)` : ""}`}
        >
          <SlidersHorizontal strokeWidth={1.75} />
          {activos > 0 && (
            <span className="bg-foreground text-background rounded-inner px-1.5 text-xs tabular-nums">
              {activos}
            </span>
          )}
        </Button>
        <div className="hidden items-center gap-2 md:flex">{controles(false)}</div>
      </div>
      <Sheet
        open={abierto}
        onOpenChange={setAbierto}
        title="Filtros"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() =>
                actualizar(
                  Object.fromEntries(
                    ["categoriaId", "marcaId", ...extras.map((e) => e.param)].map((p) => [p, null]),
                  ),
                )
              }
            >
              Limpiar
            </Button>
            <Button onClick={() => setAbierto(false)}>Ver resultados</Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">{controles(true)}</div>
      </Sheet>
    </div>
  );
}
