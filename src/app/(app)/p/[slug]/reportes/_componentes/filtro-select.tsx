"use client";

import { Select } from "@/components/ui/select";
import { useUrlParams } from "@/hooks/use-url-params";

/** Select de filtro atado a un parámetro de la URL ("" = todos). */
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
  const { actualizar } = useUrlParams();
  return (
    <Select
      aria-label={etiqueta}
      options={[{ value: "", label: todos }, ...opciones]}
      value={valor ?? ""}
      onChange={(e) => actualizar({ [param]: e.target.value || null })}
      containerClassName={className}
    />
  );
}
