"use client";

import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { controlClass } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/** Una fila editable: cantidad mínima + valor (precio o %) + activo. Todo como texto mientras se edita. */
export interface FilaEscalon {
  clave: number;
  cantidadMinima: string;
  valor: string;
  activo: boolean;
}

let siguiente = 0;
export const nuevaFila = (cantidadMinima = "", valor = "", activo = true): FilaEscalon => ({
  clave: ++siguiente,
  cantidadMinima,
  valor,
  activo,
});

/** Tabla editable de escalones (precios mayoristas del producto o % por defecto del panel). */
export function TablaEscalones({
  filas,
  onCambiar,
  etiquetaValor,
  placeholderValor,
}: {
  filas: FilaEscalon[];
  onCambiar: (filas: FilaEscalon[]) => void;
  etiquetaValor: string;
  placeholderValor: string;
}) {
  const cambiar = (clave: number, cambio: Partial<FilaEscalon>) =>
    onCambiar(filas.map((f) => (f.clave === clave ? { ...f, ...cambio } : f)));
  return (
    <div className="flex flex-col gap-2">
      {filas.length > 0 && (
        <div className="text-muted grid grid-cols-[1fr_1fr_auto_auto] gap-2 text-xs font-medium">
          <span>Desde (unidades)</span>
          <span>{etiquetaValor}</span>
          <span className="w-12">Activo</span>
          <span className="w-12" />
        </div>
      )}
      {filas.map((f, n) => (
        <div key={f.clave} className="grid grid-cols-[1fr_1fr_auto_auto] items-center gap-2">
          <input
            inputMode="numeric"
            aria-label={`Cantidad mínima del escalón ${n + 1}`}
            className={cn(controlClass, "h-11 tabular-nums")}
            value={f.cantidadMinima}
            placeholder="10"
            onChange={(e) =>
              cambiar(f.clave, { cantidadMinima: e.target.value.replace(/\D/g, "") })
            }
          />
          <input
            inputMode="decimal"
            aria-label={`${etiquetaValor} del escalón ${n + 1}`}
            className={cn(controlClass, "h-11 tabular-nums")}
            value={f.valor}
            placeholder={placeholderValor}
            onChange={(e) => cambiar(f.clave, { valor: e.target.value })}
          />
          <Switch
            checked={f.activo}
            onCheckedChange={(activo) => cambiar(f.clave, { activo })}
            label={`Escalón ${n + 1} activo`}
            labelOculto
            className="w-12"
          />
          <Button
            variant="ghost"
            size="icon"
            className="text-danger"
            aria-label={`Quitar escalón ${n + 1}`}
            onClick={() => onCambiar(filas.filter((x) => x.clave !== f.clave))}
          >
            <Trash2 strokeWidth={1.75} />
          </Button>
        </div>
      ))}
      <Button
        variant="secondary"
        size="sm"
        className="self-start"
        onClick={() => onCambiar([...filas, nuevaFila()])}
      >
        <Plus strokeWidth={1.75} /> Agregar escalón
      </Button>
    </div>
  );
}

/** "9.000" / "9000,5" → 9000.5; NaN si no es un número. */
export const numeroTipeado = (t: string) => {
  const s = t.trim();
  const normal = s.includes(",")
    ? s.replace(/\./g, "").replace(",", ".")
    : /^\d{1,3}(\.\d{3})+$/.test(s)
      ? s.replace(/\./g, "")
      : s;
  return s === "" ? NaN : Number(normal);
};
