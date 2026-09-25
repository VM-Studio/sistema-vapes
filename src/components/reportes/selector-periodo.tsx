"use client";

import { controlClass } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { useUrlParams } from "@/hooks/use-url-params";
import { cn } from "@/lib/utils";
import { PERIODO_LABEL, type Periodo, type Rango } from "@/lib/zona-horaria";

interface Opcion {
  id: string;
  nombre: string;
}

/**
 * Período + filtros, persistidos en la URL (compartible, sobrevive al refresh).
 * "Personalizado" muestra los dos días.
 */
export function SelectorPeriodo({
  periodos,
  periodo,
  rango,
  depositos,
  depositoId,
  categorias,
  categoriaId,
  vendedores,
  usuarioId,
  conDiferencia,
  mostrarPeriodo = true,
}: {
  periodos: readonly Periodo[];
  periodo: Periodo;
  rango: Rango;
  depositos?: Opcion[];
  depositoId?: string;
  categorias?: Opcion[];
  categoriaId?: string;
  vendedores?: Opcion[];
  usuarioId?: string;
  conDiferencia?: boolean;
  mostrarPeriodo?: boolean;
}) {
  const { actualizar, pendiente } = useUrlParams();
  return (
    <div
      className={cn("flex flex-col gap-3 transition-opacity", pendiente && "opacity-60")}
      aria-busy={pendiente}
    >
      {mostrarPeriodo && (
        <div
          role="group"
          aria-label="Período"
          className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0"
        >
          {periodos.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={periodo === p}
              onClick={() =>
                actualizar(
                  p === "personalizado"
                    ? { periodo: p, desde: rango.desde, hasta: rango.hasta }
                    : { periodo: p, desde: null, hasta: null },
                )
              }
              className={cn(
                "h-9 shrink-0 rounded-full border px-3.5 text-sm font-medium whitespace-nowrap transition-colors",
                periodo === p
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-surface text-foreground hover:bg-surface-2",
              )}
            >
              {PERIODO_LABEL[p]}
            </button>
          ))}
        </div>
      )}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:flex md:flex-wrap md:items-end">
        {mostrarPeriodo && periodo === "personalizado" && (
          <>
            <label className="text-muted flex flex-col gap-1 text-xs">
              Desde
              <input
                type="date"
                className={cn(controlClass, "h-11")}
                value={rango.desde}
                max={rango.hasta}
                onChange={(e) =>
                  e.target.value && actualizar({ periodo: "personalizado", desde: e.target.value })
                }
              />
            </label>
            <label className="text-muted flex flex-col gap-1 text-xs">
              Hasta
              <input
                type="date"
                className={cn(controlClass, "h-11")}
                value={rango.hasta}
                min={rango.desde}
                onChange={(e) =>
                  e.target.value && actualizar({ periodo: "personalizado", hasta: e.target.value })
                }
              />
            </label>
          </>
        )}
        {depositos && (
          <Select
            aria-label="Depósito"
            containerClassName="md:w-48"
            options={[
              { value: "", label: "Todos los depósitos" },
              ...depositos.map((d) => ({ value: d.id, label: d.nombre })),
            ]}
            value={depositoId ?? ""}
            onChange={(e) => actualizar({ deposito: e.target.value || null })}
          />
        )}
        {categorias && (
          <Select
            aria-label="Categoría"
            containerClassName="md:w-48"
            options={[
              { value: "", label: "Todas las categorías" },
              ...categorias.map((c) => ({ value: c.id, label: c.nombre })),
            ]}
            value={categoriaId ?? ""}
            onChange={(e) => actualizar({ categoria: e.target.value || null })}
          />
        )}
        {vendedores && (
          <Select
            aria-label="Vendedor"
            containerClassName="md:w-48"
            options={[
              { value: "", label: "Todos los vendedores" },
              ...vendedores.map((v) => ({ value: v.id, label: v.nombre })),
            ]}
            value={usuarioId ?? ""}
            onChange={(e) => actualizar({ vendedor: e.target.value || null })}
          />
        )}
        {conDiferencia !== undefined && (
          <label className="border-border bg-surface flex h-11 items-center gap-2 rounded-lg border px-3 text-sm md:self-end">
            <input
              type="checkbox"
              className="accent-primary size-4"
              checked={conDiferencia}
              onChange={(e) => actualizar({ diferencia: e.target.checked })}
            />
            Solo con diferencia
          </label>
        )}
      </div>
    </div>
  );
}
