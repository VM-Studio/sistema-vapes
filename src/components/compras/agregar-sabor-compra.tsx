"use client";

import { Plus, ScanBarcode } from "lucide-react";
import { useRef, useState } from "react";

import { agregarSaborAction } from "@/app/(app)/p/[slug]/productos/actions";
import { soloDecimal } from "@/components/compras/proveedor-form";
import { Button } from "@/components/ui/button";
import { CantidadInput } from "@/components/ui/cantidad-input";
import { controlClass } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { invalidarResoluciones } from "@/features/scanner/resolver-codigo";
import { useBarcodeScanner } from "@/features/scanner/useBarcodeScanner";
import { normalizarCodigoBarras } from "@/lib/barcode";
import { cn } from "@/lib/utils";

export interface SaborCreado {
  varianteId: string;
  sabor: string;
  sku: string;
  /** Unidades a comprar que se tipearon al crearlo (0 = ninguna). */
  cantidad: number;
}

type Errores = Partial<Record<"sabor" | "codigoBarras" | "precioVenta" | "general", string>>;

/**
 * «Agregar sabor» dentro de la hoja del producto en una compra: da de alta
 * el sabor en el producto (misma lógica que Productos → editar: SKU
 * automático, código único, precio propio opcional, stock en 0 en todos los
 * galpones) y lo deja en la lista con la cantidad a comprar. Queda abierto
 * para cargar el siguiente.
 */
export function AgregarSaborCompra({
  productoId,
  nombreProducto,
  onCreado,
}: {
  productoId: string;
  nombreProducto: string;
  onCreado: (s: SaborCreado) => void;
}) {
  const toast = useToast();
  const [abierto, setAbierto] = useState(false);
  const [sabor, setSabor] = useState("");
  const [codigo, setCodigo] = useState("");
  const [precio, setPrecio] = useState("");
  const [stockMinimo, setStockMinimo] = useState(0);
  const [cantidad, setCantidad] = useState(0);
  const [errores, setErrores] = useState<Errores>({});
  const [enviando, setEnviando] = useState(false);
  const [ultimo, setUltimo] = useState<string | null>(null);
  const saborRef = useRef<HTMLInputElement>(null);

  // Con el formulario abierto, la pistola completa el código (sin importar el foco).
  useBarcodeScanner({
    onScan: (c) => {
      setCodigo(c);
      setErrores((e) => ({ ...e, codigoBarras: undefined }));
    },
    enabled: abierto,
  });

  function limpiar() {
    setSabor("");
    setCodigo("");
    setPrecio("");
    setStockMinimo(0);
    setCantidad(0);
    setErrores({});
  }

  async function guardar() {
    if (enviando) return;
    if (!sabor.trim()) {
      setErrores({ sabor: "Poné el sabor" });
      saborRef.current?.focus();
      return;
    }
    setEnviando(true);
    setErrores({});
    const r = await agregarSaborAction({
      productoId,
      sabor: sabor.trim(),
      codigoBarras: codigo.trim() || undefined,
      precioVenta: precio.replace(",", ".") || undefined,
      stockMinimo,
    }).catch(() => null);
    setEnviando(false);
    if (!r) {
      setErrores({
        general: "Sin conexión con el servidor: el sabor no se guardó. Probá de nuevo.",
      });
      return;
    }
    if (!r.ok) {
      const f = r.error.fields ?? {};
      const e: Errores = {
        sabor: f.sabor?.[0],
        codigoBarras: f.codigoBarras?.[0],
        precioVenta: f.precioVenta?.[0],
      };
      if (!e.sabor && !e.codigoBarras && !e.precioVenta) e.general = r.error.message;
      setErrores(e);
      return;
    }
    if (r.data.codigoBarras) invalidarResoluciones(r.data.codigoBarras);
    onCreado({ varianteId: r.data.varianteId, sabor: r.data.sabor, sku: r.data.sku, cantidad });
    toast.success(`Sabor ${r.data.sabor} agregado`, nombreProducto);
    setUltimo(r.data.sabor);
    limpiar();
    saborRef.current?.focus();
  }

  if (!abierto) {
    return (
      <Button
        variant="secondary"
        onClick={() => {
          setAbierto(true);
          setUltimo(null);
          setTimeout(() => saborRef.current?.focus(), 0);
        }}
        data-testid="agregar-sabor"
      >
        <Plus strokeWidth={1.75} /> Agregar sabor
      </Button>
    );
  }

  return (
    <form
      className="border-border bg-surface rounded-control flex flex-col gap-3 border p-3"
      aria-label="Agregar sabor"
      data-testid="form-agregar-sabor"
      onSubmit={(e) => {
        e.preventDefault();
        void guardar();
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <h4 className="font-semibold">Nuevo sabor de {nombreProducto}</h4>
      </div>
      {ultimo && (
        <p role="status" className="text-success text-sm font-medium">
          {ultimo} quedó agregado a la lista. Podés cargar el siguiente.
        </p>
      )}
      <Campo etiqueta="Sabor" error={errores.sabor}>
        <input
          ref={saborRef}
          value={sabor}
          onChange={(e) => setSabor(e.target.value)}
          placeholder="Ej: MANGO ICE"
          maxLength={100}
          aria-label="Sabor"
          aria-invalid={errores.sabor ? true : undefined}
          className={cn(controlClass, "h-11 md:h-10")}
        />
      </Campo>
      <Campo
        etiqueta="Código de barras (opcional)"
        error={errores.codigoBarras}
        ayuda="Escaneá la caja con la pistola o tipealo. Si no lo tenés, lo vinculás después."
      >
        <div className="relative">
          <ScanBarcode
            className="text-muted pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
            aria-hidden
          />
          <input
            value={codigo}
            onChange={(e) => setCodigo(normalizarCodigoBarras(e.target.value))}
            onKeyDown={(e) => {
              // La pistola termina con Enter: no guardar el sabor por eso.
              if (e.key === "Enter") e.preventDefault();
            }}
            autoComplete="off"
            spellCheck={false}
            maxLength={64}
            aria-label="Código de barras"
            aria-invalid={errores.codigoBarras ? true : undefined}
            className={cn(controlClass, "h-11 pl-9 md:h-10")}
          />
        </div>
      </Campo>
      <div className="grid grid-cols-2 gap-3">
        <Campo
          etiqueta="Precio de venta propio ($)"
          error={errores.precioVenta}
          ayuda="Vacío = el del producto."
        >
          <input
            inputMode="decimal"
            value={precio}
            onChange={(e) => setPrecio(soloDecimal(e.target.value))}
            aria-label="Precio de venta propio"
            className={cn(controlClass, "h-11 text-right tabular-nums md:h-10")}
          />
        </Campo>
        <Campo etiqueta="Stock mínimo">
          <CantidadInput
            etiqueta="Stock mínimo"
            valor={stockMinimo}
            min={0}
            onCambio={setStockMinimo}
            className="w-full"
          />
        </Campo>
      </div>
      <Campo etiqueta="Cantidad a comprar">
        <CantidadInput
          etiqueta="Cantidad a comprar del sabor nuevo"
          valor={cantidad}
          min={0}
          onCambio={setCantidad}
          className="w-28"
        />
      </Campo>
      {errores.general && (
        <p role="alert" className="text-danger text-sm">
          {errores.general}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            limpiar();
            setAbierto(false);
          }}
          disabled={enviando}
        >
          {ultimo ? "Listo" : "Cancelar"}
        </Button>
        <Button type="submit" loading={enviando} data-testid="guardar-sabor">
          Guardar sabor
        </Button>
      </div>
    </form>
  );
}

function Campo({
  etiqueta,
  error,
  ayuda,
  children,
}: {
  etiqueta: string;
  error?: string;
  ayuda?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-muted text-xs font-medium">{etiqueta}</span>
      {children}
      {error ? (
        <span className="text-danger text-xs" role="alert">
          {error}
        </span>
      ) : (
        ayuda && <span className="text-subtle text-xs">{ayuda}</span>
      )}
    </label>
  );
}
