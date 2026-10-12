"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/section-card";
import { useToast } from "@/components/ui/toast";
import { formatearUSD, horaCotizacion } from "@/lib/cambio";
import { formatearPesos } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { EscalonGuardado } from "@/server/services/escalon.service";

import { guardarEscalonesProductoAction } from "../../cotizador/actions";
import {
  nuevaFila,
  numeroTipeado,
  TablaEscalones,
  type FilaEscalon,
} from "../../cotizador/tabla-escalones";

type Moneda = "USD" | "ARS";

/** USD × blue redondeado a 10 pesos (igual que el servidor; solo para mostrar). */
const pesosDe = (usd: number, blue: number) => Math.round((usd * blue) / 10) * 10;

/**
 * "Precios mayoristas" de la ficha: escalones de precio por cantidad (valen
 * para todos los sabores), en dólares (blue venta, el default) con su
 * equivalente en pesos en gris, o en pesos.
 */
export function PreciosMayoristas({
  productoId,
  precioLista,
  escalones,
  blue,
}: {
  productoId: string;
  precioLista: string;
  escalones: EscalonGuardado[];
  blue: { valor: number; obtenidoAt: string } | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [filas, setFilas] = useState<FilaEscalon[]>(() =>
    escalones.map((e) =>
      nuevaFila(String(e.cantidadMinima), String(Number(e.precioUnitario)), e.activo),
    ),
  );
  const [moneda, setMoneda] = useState<Moneda>(escalones[0]?.moneda ?? "USD");
  const [guardando, setGuardando] = useState(false);
  const enPesos = (valor: number) =>
    moneda === "USD"
      ? blue
        ? `${formatearUSD({ usd: valor, aproximado: false })} (${formatearPesos(pesosDe(valor, blue.valor))})`
        : formatearUSD({ usd: valor, aproximado: false })
      : formatearPesos(valor);

  const preview = filas
    .filter((f) => f.activo && Number(f.cantidadMinima) > 0 && numeroTipeado(f.valor) > 0)
    .sort((a, b) => Number(a.cantidadMinima) - Number(b.cantidadMinima))
    .map((f) => `${f.cantidadMinima} u. → ${enPesos(numeroTipeado(f.valor))}`)
    .join(" · ");

  async function guardar() {
    setGuardando(true);
    const r = await guardarEscalonesProductoAction({
      productoId,
      moneda,
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
    <SectionCard
      title="Precios mayoristas"
      description={
        <>
          Precio por unidad desde cierta cantidad (suman todos los sabores). Lista:{" "}
          {formatearPesos(precioLista)}. Sin escalones propios se usan los del panel.
        </>
      }
      contentClassName="flex flex-col gap-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="group"
          aria-label="Moneda de los escalones"
          className="border-input rounded-control flex h-11 overflow-hidden border md:h-10"
        >
          {(
            [
              ["USD", "Dólares (blue)"],
              ["ARS", "Pesos"],
            ] as const
          ).map(([m, etiqueta]) => (
            <button
              key={m}
              type="button"
              aria-pressed={moneda === m}
              onClick={() => setMoneda(m)}
              className={cn(
                "px-4 text-sm font-medium transition-colors",
                moneda === m
                  ? "bg-primary text-primary-foreground"
                  : "bg-surface text-muted hover:text-foreground",
              )}
            >
              {etiqueta}
            </button>
          ))}
        </div>
        {moneda === "USD" && (
          <p className="text-muted text-xs tabular-nums" data-testid="blue-ficha">
            {blue
              ? `Blue venta ${formatearPesos(blue.valor)} (${horaCotizacion(blue.obtenidoAt)})`
              : "Sin cotización del blue"}
          </p>
        )}
      </div>
      <TablaEscalones
        filas={filas}
        onCambiar={setFilas}
        etiquetaValor={moneda === "USD" ? "Precio c/u (U$D)" : "Precio c/u ($)"}
        placeholderValor={moneda === "USD" ? "7.5" : "9000"}
        equivalente={
          moneda === "USD" && blue
            ? (valor) => (valor > 0 ? `≈ ${formatearPesos(pesosDe(valor, blue.valor))}` : null)
            : undefined
        }
      />
      {preview && (
        <p className="text-small font-medium tabular-nums" data-testid="preview-escalones">
          Con {preview}
        </p>
      )}
      <Button
        className="w-full md:w-auto md:self-end"
        onClick={() => void guardar()}
        loading={guardando}
      >
        Guardar precios mayoristas
      </Button>
    </SectionCard>
  );
}
