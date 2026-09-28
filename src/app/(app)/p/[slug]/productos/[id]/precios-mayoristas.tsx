"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { formatearPesos } from "@/lib/format";
import type { EscalonGuardado } from "@/server/services/escalon.service";

import { guardarEscalonesProductoAction } from "../../cotizador/actions";
import {
  nuevaFila,
  numeroTipeado,
  TablaEscalones,
  type FilaEscalon,
} from "../../cotizador/tabla-escalones";

/** "Precios mayoristas" de la ficha: escalones de precio por cantidad (valen para todos los sabores). */
export function PreciosMayoristas({
  productoId,
  precioLista,
  escalones,
}: {
  productoId: string;
  precioLista: string;
  escalones: EscalonGuardado[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [filas, setFilas] = useState<FilaEscalon[]>(() =>
    escalones.map((e) =>
      nuevaFila(String(e.cantidadMinima), String(Number(e.precioUnitario)), e.activo),
    ),
  );
  const [guardando, setGuardando] = useState(false);

  const preview = filas
    .filter((f) => f.activo && Number(f.cantidadMinima) > 0 && numeroTipeado(f.valor) > 0)
    .sort((a, b) => Number(a.cantidadMinima) - Number(b.cantidadMinima))
    .map((f) => `${f.cantidadMinima} u. → ${formatearPesos(numeroTipeado(f.valor))}`)
    .join(" · ");

  async function guardar() {
    setGuardando(true);
    const r = await guardarEscalonesProductoAction({
      productoId,
      escalones: filas.map((f) => ({
        cantidadMinima: Number(f.cantidadMinima),
        precioUnitario: numeroTipeado(f.valor),
        activo: f.activo,
      })),
    });
    setGuardando(false);
    if (!r.ok) return toast.error("No se pudieron guardar los precios", r.error.message);
    toast.success("Precios mayoristas guardados");
    router.refresh();
  }

  return (
    <section aria-labelledby="precios-mayoristas" className="mt-6">
      <h2 id="precios-mayoristas" className="mb-1 text-lg font-semibold">
        Precios mayoristas
      </h2>
      <p className="text-muted mb-3 text-sm">
        Precio por unidad desde cierta cantidad (suman todos los sabores). Lista:{" "}
        {formatearPesos(precioLista)}. Sin escalones propios se usan los del panel.
      </p>
      <div className="border-border bg-surface flex flex-col gap-3 rounded-2xl border p-4">
        <TablaEscalones
          filas={filas}
          onCambiar={setFilas}
          etiquetaValor="Precio c/u ($)"
          placeholderValor="9000"
        />
        {preview && (
          <p
            className="text-primary text-sm font-medium tabular-nums"
            data-testid="preview-escalones"
          >
            Con {preview}
          </p>
        )}
        <Button className="self-end" onClick={() => void guardar()} loading={guardando}>
          Guardar precios mayoristas
        </Button>
      </div>
    </section>
  );
}
