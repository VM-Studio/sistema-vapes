"use client";

import { controlClass } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { useUrlParams } from "@/hooks/use-url-params";
import { cn } from "@/lib/utils";

export function FiltrosAuditoria({
  params,
  usuarios,
  sistemas,
  entidades,
  acciones,
}: {
  params: Record<string, string>;
  usuarios: { id: string; nombre: string }[];
  sistemas: { id: string; nombre: string }[];
  entidades: string[];
  acciones: string[];
}) {
  const { actualizar } = useUrlParams();
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-6">
      <Select
        aria-label="Sistema"
        options={[
          { value: "", label: "Todos los sistemas" },
          { value: "global", label: "Global (fuera de los sistemas)" },
          ...sistemas.map((p) => ({ value: p.id, label: p.nombre })),
        ]}
        value={params.panelId ?? ""}
        onChange={(e) => actualizar({ panelId: e.target.value || null })}
      />
      <Select
        aria-label="Usuario"
        options={[
          { value: "", label: "Todos los usuarios" },
          ...usuarios.map((u) => ({ value: u.id, label: u.nombre })),
        ]}
        value={params.usuarioId ?? ""}
        onChange={(e) => actualizar({ usuarioId: e.target.value || null })}
      />
      <Select
        aria-label="Entidad"
        options={[
          { value: "", label: "Todas las entidades" },
          ...entidades.map((e) => ({ value: e, label: e })),
        ]}
        value={params.entidad ?? ""}
        onChange={(e) => actualizar({ entidad: e.target.value || null })}
      />
      <Select
        aria-label="Acción"
        options={[
          { value: "", label: "Todas las acciones" },
          ...acciones.map((a) => ({ value: a, label: a })),
        ]}
        value={params.accion ?? ""}
        onChange={(e) => actualizar({ accion: e.target.value || null })}
      />
      <input
        type="date"
        aria-label="Desde"
        className={cn(controlClass, "h-11")}
        value={params.desde ?? ""}
        onChange={(e) => actualizar({ desde: e.target.value || null })}
      />
      <input
        type="date"
        aria-label="Hasta"
        className={cn(controlClass, "h-11")}
        value={params.hasta ?? ""}
        onChange={(e) => actualizar({ hasta: e.target.value || null })}
      />
    </div>
  );
}
