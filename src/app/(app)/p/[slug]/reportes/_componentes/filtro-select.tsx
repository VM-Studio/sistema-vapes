"use client";

import { Select } from "@/components/ui/select";
import { useUrlParams } from "@/hooks/use-url-params";
import { cn } from "@/lib/utils";

/** Select de filtro atado a un parámetro de la URL ("" = todos). Se atenúa mientras carga, como el período. */
export function FiltroSelect({
  param,
  valor,
  etiqueta,
  todos,
  opciones,
  className,
}: {
  param: string;
  valor: string | undefined;
  etiqueta: string;
  todos: string;
  opciones: { value: string; label: string }[];
  className?: string;
}) {
  const { actualizar, pendiente } = useUrlParams();
  return (
    <Select
      aria-label={etiqueta}
      options={[{ value: "", label: todos }, ...opciones]}
      value={valor ?? ""}
      onChange={(e) => actualizar({ [param]: e.target.value || null })}
      containerClassName={cn("min-w-0 transition-opacity", pendiente && "opacity-60", className)}
    />
  );
}
