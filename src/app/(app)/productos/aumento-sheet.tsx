"use client";

import { Percent } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { formatearPesos } from "@/lib/format";
import type { PreviaAumento } from "@/server/services/producto.service";

import { aplicarAumentoAction, previsualizarAumentoAction } from "./actions";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  categorias: { value: string; label: string }[];
  marcas: { value: string; label: string }[];
  /** Si viene, el aumento se aplica solo a ese producto (desde la ficha). */
  producto?: { id: string; nombre: string };
}

/** Aumento (o rebaja) porcentual masivo con previsualización obligatoria antes de aplicar. */
export function AumentoSheet({ open, onOpenChange, categorias, marcas, producto }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [categoriaId, setCategoriaId] = useState("");
  const [marcaId, setMarcaId] = useState("");
  const [porcentaje, setPorcentaje] = useState("");
  const [aplicarA, setAplicarA] = useState<"venta" | "costo" | "ambos">("venta");
  const [redondeo, setRedondeo] = useState("10");
  const [previa, setPrevia] = useState<PreviaAumento | null>(null);
  const [error, setError] = useState<string>();
  const [cargando, setCargando] = useState(false);

  const datos = () => ({
    filtro: producto ? { productoId: producto.id } : { categoriaId, marcaId },
    porcentaje: porcentaje.replace(",", "."),
    aplicarA,
    redondeo,
  });

  const invalidar =
    <T,>(fn: (v: T) => void) =>
    (v: T) => {
      fn(v);
      setPrevia(null);
    };

  async function previsualizar() {
    setCargando(true);
    setError(undefined);
    const r = await previsualizarAumentoAction(datos());
    setCargando(false);
    if (!r.ok) return setError(r.error.fields?.porcentaje?.[0] ?? r.error.message);
    setPrevia(r.data);
  }

  async function aplicar() {
    setCargando(true);
    const r = await aplicarAumentoAction(datos());
    setCargando(false);
    if (!r.ok) return toast.error("No se pudo aplicar", r.error.message);
    toast.success(
      `Precios actualizados en ${r.data.afectadas} variantes`,
      "Cada cambio quedó en el historial de precios.",
    );
    setPrevia(null);
    setPorcentaje("");
    onOpenChange(false);
    router.refresh();
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={producto ? `Ajustar precios de ${producto.nombre}` : "Aumento masivo de precios"}
      description="Se aplica sobre el precio actual y queda registrado en el historial de precios."
      footer={
        previa ? (
          <>
            <Button variant="secondary" onClick={() => setPrevia(null)} disabled={cargando}>
              Cambiar
            </Button>
            <Button onClick={aplicar} loading={cargando} disabled={previa.cantidad === 0}>
              Aplicar a {previa.cantidad} variantes
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button onClick={previsualizar} loading={cargando}>
              Previsualizar
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-4">
        {!producto && (
          <>
            <Select
              label="Categoría"
              options={[{ value: "", label: "Todas" }, ...categorias]}
              value={categoriaId}
              onChange={(e) => invalidar(setCategoriaId)(e.target.value)}
            />
            <Select
              label="Marca"
              options={[{ value: "", label: "Todas" }, ...marcas]}
              value={marcaId}
              onChange={(e) => invalidar(setMarcaId)(e.target.value)}
            />
          </>
        )}
        <Input
          label="Porcentaje"
          inputMode="decimal"
          placeholder="10 (o -5 para rebajar)"
          value={porcentaje}
          onChange={(e) => invalidar(setPorcentaje)(e.target.value.replace(/[^\d.,-]/g, ""))}
          error={error}
          hint="Positivo aumenta, negativo rebaja."
        />
        <Select
          label="Aplicar a"
          options={[
            { value: "venta", label: "Precio de venta" },
            { value: "costo", label: "Precio de costo" },
            { value: "ambos", label: "Costo y venta" },
          ]}
          value={aplicarA}
          onChange={(e) => invalidar(setAplicarA)(e.target.value as typeof aplicarA)}
        />
        <Select
          label="Redondear a"
          options={[
            { value: "1", label: "$1" },
            { value: "10", label: "$10" },
            { value: "100", label: "$100" },
          ]}
          value={redondeo}
          onChange={(e) => invalidar(setRedondeo)(e.target.value)}
        />
        {previa && (
          <div
            className="border-primary/30 bg-primary-soft/60 rounded-xl border p-3 text-sm"
            role="status"
          >
            <p className="mb-2 flex items-center gap-2 font-medium">
              <Percent className="size-4" aria-hidden /> Afecta a {previa.cantidad} variantes.
              Ejemplos:
            </p>
            <ul className="flex flex-col gap-1">
              {previa.ejemplos.map((e) => (
                <li key={e.nombre} className="flex justify-between gap-3">
                  <span className="truncate">{e.nombre}</span>
                  <span className="shrink-0 tabular-nums">
                    {formatearPesos(e.antes)} → <strong>{formatearPesos(e.despues)}</strong>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Sheet>
  );
}
