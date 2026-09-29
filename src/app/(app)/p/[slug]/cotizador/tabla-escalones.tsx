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
  const columnas = "grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_3rem_2.75rem] items-center gap-2";
  return (
    <div className="flex flex-col gap-3">
      {filas.length > 0 && (
        <div className="border-border bg-surface rounded-card overflow-hidden border">
          <div
            className={cn(
              columnas,
              "bg-card border-border text-muted border-b px-3 py-2.5 text-xs font-medium",
            )}
          >
            <span>Desde (unidades)</span>
            <span>{etiquetaValor}</span>
            <span className="text-center">Activo</span>
            <span className="sr-only">Quitar</span>
          </div>
          <div className="divide-border divide-y">
            {filas.map((f, n) => (
              <div key={f.clave} className={cn(columnas, "px-3 py-2")}>
                <input
                  inputMode="numeric"
                  aria-label={`Cantidad mínima del escalón ${n + 1}`}
                  className={cn(controlClass, "h-11 tabular-nums md:h-10")}
                  value={f.cantidadMinima}
                  placeholder="10"
                  onChange={(e) =>
                    cambiar(f.clave, { cantidadMinima: e.target.value.replace(/\D/g, "") })
                  }
                />
                <input
                  inputMode="decimal"
                  aria-label={`${etiquetaValor} del escalón ${n + 1}`}
                  className={cn(controlClass, "h-11 tabular-nums md:h-10")}
                  value={f.valor}
                  placeholder={placeholderValor}
                  onChange={(e) => cambiar(f.clave, { valor: e.target.value })}
                />
                <Switch
                  checked={f.activo}
                  onCheckedChange={(activo) => cambiar(f.clave, { activo })}
                  label={`Escalón ${n + 1} activo`}
                  labelOculto
                  className="justify-self-center"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted hover:text-danger"
                  aria-label={`Quitar escalón ${n + 1}`}
                  onClick={() => onCambiar(filas.filter((x) => x.clave !== f.clave))}
                >
                  <Trash2 strokeWidth={1.75} />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
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
